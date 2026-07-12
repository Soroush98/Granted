"""DIGITAL Technology Supercluster project ingestion.

DIGITAL (https://digitalsupercluster.ca) is one of Canada's Global Innovation
Clusters — a federally-funded body that co-invests in industry-led digital
technology projects. Their funded projects are listed via a WordPress sitemap;
each project page renders a predictable set of sidebar widgets:

  <h1>{project title}</h1>                          (also og:title, "… - DIGITAL")
  <h4 class="sidebar-widget__title">STATUS: {Completed | In Progress | …}</h4>
  <dl class="sidebar-widget__dl"><dt>$0.9M</dt><dd>Project Budget*</dd></dl>
  <dl class="sidebar-widget__dl"><dt>$0.5M</dt><dd>Partner Co-investment</dd></dl>
  <dl class="sidebar-widget__dl"><dt>$0.4M</dt><dd>Supercluster Co-investment</dd></dl>
  <div class="sidebar-widget__other">          "Partners Receiving Supercluster Funds"
    <strong>TELUS – $0.30M<br>GenXys – $0.08M<br>LifeLabs – $0.04M</strong>
  …narrative description in <main> <p> blocks…

The recipient we surface is the LEAD partner — the first organization listed
under "Partners Receiving Supercluster Funds" (org_type="company", feeds /jobs).
``amount_cad`` is the *Supercluster Co-investment* (the grant portion), parsed
from the "$X.XM"/"$X.XK" millions/thousands shorthand into dollars. The funded
partner list is appended to the description chunk so partners stay searchable,
and the full partner list + status live in ``raw``.

DIGITAL only publishes ~178 projects total, so we ingest all of them in one
pass. ``award_id`` is the project URL (unique and stable per project).
"""

from __future__ import annotations

import re
import time
from typing import Any

import httpx
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

_SITEMAP_URL = "https://digitalsupercluster.ca/project-sitemap.xml"
_PROJECT_URL_RE = re.compile(r"<loc>\s*(https://digitalsupercluster\.ca/projects/[^<]+?)\s*</loc>")
# "$0.9M" / "$0.08M" / "$1.2K" / "$1,234" — capture number + optional M/K suffix.
_AMOUNT_RE = re.compile(r"\$\s*([\d,]+(?:\.\d+)?)\s*([MK]?)", re.IGNORECASE)


def _fetch(url: str, *, retries: int = 3) -> str:
    """GET a page, retrying transient transport errors and 5xx/429 with backoff.
    Permanent failures (4xx, or exhausted retries) raise for the caller to skip."""
    last_exc: httpx.HTTPError | None = None
    for attempt in range(retries):
        try:
            with httpx.Client(
                timeout=30.0,
                headers={"user-agent": settings.scraper_user_agent},
                follow_redirects=True,
            ) as c:
                r = c.get(url)
                r.raise_for_status()
                return r.text
        except httpx.TransportError as exc:  # timeouts, connect/read errors, protocol errors
            last_exc = exc
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code < 500 and code != 429:  # permanent — don't retry
                raise
            last_exc = exc
        time.sleep(0.5 * (2 ** attempt))
    assert last_exc is not None
    raise last_exc


def _project_urls() -> list[str]:
    """Every project URL from the sitemap. selectolax doesn't parse XML, so we
    regex the <loc> entries; nested sitemap references (…-sitemap.xml) are skipped."""
    xml = _fetch(_SITEMAP_URL)
    urls: list[str] = []
    seen: set[str] = set()
    for loc in _PROJECT_URL_RE.findall(xml):
        if loc.endswith(".xml") or "sitemap" in loc.rsplit("/", 2)[-1]:
            continue
        if loc not in seen:
            seen.add(loc)
            urls.append(loc)
    return urls


def _parse_amount(text: str | None) -> float | None:
    """'$0.5M' -> 500000.0, '$0.08M' -> 80000.0, '$1.2K' -> 1200.0,
    '$1,234' -> 1234.0. Returns None if no dollar figure is present."""
    m = _AMOUNT_RE.search(text or "")
    if not m:
        return None
    try:
        val = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    suffix = m.group(2).upper()
    if suffix == "M":
        val *= 1_000_000
    elif suffix == "K":
        val *= 1_000
    return val


def _og(tree: HTMLParser, prop: str) -> str | None:
    node = tree.css_first(f'meta[property="{prop}"]')
    if not node:
        return None
    return (node.attributes.get("content") or "").strip() or None


def _extract_project(url: str, html: str) -> dict[str, Any] | None:
    tree = HTMLParser(html)

    # Title: og:title (strip trailing " - DIGITAL"), fall back to <h1>.
    title = _og(tree, "og:title") or ""
    if title.endswith(" - DIGITAL"):
        title = title[: -len(" - DIGITAL")]
    title = title.strip()
    if not title:
        h1 = tree.css_first("h1")
        title = h1.text(strip=True) if h1 else ""
    if not title:
        return None

    # STATUS lives in an h4 sidebar heading like "STATUS: Completed".
    status: str | None = None
    for h4 in tree.css("h4.sidebar-widget__title"):
        t = h4.text(strip=True)
        if t.upper().startswith("STATUS"):
            status = t.split(":", 1)[1].strip() if ":" in t else None
            break

    # Financial fields are <dl><dt>$amount</dt><dd>label</dd></dl>. Key by label
    # (positions are NOT stable — some projects omit Partner Co-investment). The
    # same widget class is reused for the category tag and download links, so we
    # only accept rows whose <dt> is a dollar figure.
    budget = partner_coinv = supercluster_coinv = None
    for dl in tree.css("dl.sidebar-widget__dl"):
        dt = dl.css_first("dt")
        dd = dl.css_first("dd")
        if not dt or not dd:
            continue
        amt_text = dt.text(strip=True)
        if not amt_text.startswith("$"):
            continue
        label = dd.text(strip=True)
        val = _parse_amount(amt_text)
        if "Project Budget" in label:
            budget = val
        elif "Partner Co-investment" in label:
            partner_coinv = val
        elif "Supercluster Co-investment" in label:
            supercluster_coinv = val

    # "Partners Receiving Supercluster Funds": a <strong> with <br>-separated
    # "Name – $X.XXM" lines. The lead recipient is the first funded partner.
    partners: list[dict[str, Any]] = []
    for div in tree.css("div.sidebar-widget__other__content"):
        strong = div.css_first("strong")
        if not strong:
            continue
        for line in strong.text(separator="\n", strip=True).split("\n"):
            line = line.strip()
            if not line or "$" not in line:
                continue
            # Name is everything before the amount; trim the trailing dash.
            name = line.split("$", 1)[0].strip().rstrip("-–—").strip()
            if name:
                partners.append({"name": name, "amount_cad": _parse_amount(line), "raw": line})
        break

    lead = partners[0]["name"] if partners else None

    # Narrative body from the <main> content (avoids site-wide nav/footer text).
    main = tree.css_first("main") or tree.body
    paragraphs = [p.text(strip=True) for p in main.css("p") if p.text(strip=True)] if main else []
    body = " ".join(paragraphs).strip()
    if len(body) < 120:
        body = _og(tree, "og:description") or body

    # Append the funded-partner list so partners are searchable in the chunk.
    description = body
    if partners:
        partner_line = "Partners receiving Supercluster funds: " + "; ".join(p["raw"] for p in partners)
        description = f"{body}\n\n{partner_line}" if body else partner_line

    # amount_cad = the grant portion (Supercluster Co-investment). If that label
    # is missing but partners are listed, their funded amounts sum to the same.
    amount_cad = supercluster_coinv
    if amount_cad is None and partners:
        amts = [p["amount_cad"] for p in partners if p["amount_cad"] is not None]
        amount_cad = round(sum(amts), 2) if amts else None

    return {
        "url": url,
        "title": title,
        "lead": lead,
        "status": status,
        "budget": budget,
        "partner_coinvestment": partner_coinv,
        "supercluster_coinvestment": supercluster_coinv,
        "partners": partners,
        "amount_cad": amount_cad,
        "description": description[:3000] or None,
    }


def ingest_all(limit: int | None = None) -> tuple[int, int]:
    """Pull every DIGITAL project from the sitemap and ingest. Returns
    (companies_seen, grants_inserted). ``limit`` caps the number of project URLs
    (smoke test). Tagged under program code DIGITAL."""
    from rich.console import Console
    console = Console()

    program_id = db.ensure_program_id(
        "DIGITAL", name="DIGITAL Technology Supercluster", agency="DIGITAL"
    )
    urls = _project_urls()
    if limit is not None:
        urls = urls[:limit]
    console.log(f"DIGITAL: {len(urls)} project URLs from sitemap")

    grants_inserted = 0
    companies_seen: set[str] = set()
    batch_companies: list[dict[str, Any]] = []
    batch_meta: list[dict[str, Any]] = []

    def flush() -> int:
        if not batch_meta:
            return 0
        company_map = db.bulk_upsert_companies(batch_companies)
        companies_seen.update(company_map.values())

        grant_payload: list[dict[str, Any]] = []
        chunk_payload: list[dict[str, Any]] = []
        for m in batch_meta:
            cid = company_map.get((m["normalized"], "company"))
            if not cid:
                continue
            grant_payload.append(
                {
                    "program_id": program_id,
                    "recipient_id": cid,
                    "title": m["title"],
                    "description": m["description"],
                    "amount_cad": m["amount_cad"],
                    "source_url": m["url"],
                    "award_id": m["url"],  # URL is unique per project
                    "raw": {
                        "source": "digital_supercluster",
                        "status": m["status"],
                        "partners": m["partners"],
                        "budget": m["budget"],
                        "supercluster_coinvestment": m["supercluster_coinvestment"],
                        "url": m["url"],
                    },
                }
            )
            chunk_payload.append(
                {"_cid": cid, "_aid": m["url"], "title": m["title"], "body": m["description"]}
            )

        grant_map = db.bulk_upsert_grants(grant_payload)

        chunks: list[dict[str, Any]] = []
        for cp in chunk_payload:
            gid = grant_map.get((program_id, cp["_aid"]))
            if not gid:
                continue
            if cp["title"]:
                chunks.append({"grant_id": gid, "company_id": cp["_cid"],
                               "kind": "grant_title", "content": cp["title"]})
            if cp["body"]:
                chunks.append({"grant_id": gid, "company_id": cp["_cid"],
                               "kind": "grant_description", "content": cp["body"][:2000]})
        db.bulk_insert_chunks(chunks)
        return len(grant_payload)

    for i, url in enumerate(urls, 1):
        try:
            html = _fetch(url)
        except httpx.HTTPError as exc:
            console.log(f"[yellow]DIGITAL fetch failed {url}: {exc}[/]")
            continue
        meta = _extract_project(url, html)
        if not meta or not meta["lead"]:
            continue
        normalized = normalize_org_name(meta["lead"])
        if not normalized:
            continue
        meta["normalized"] = normalized
        batch_companies.append({
            "display_name": meta["lead"],
            "normalized_name": normalized,
            "org_type": "company",
        })
        batch_meta.append(meta)
        if len(batch_meta) >= 30:
            grants_inserted += flush()
            batch_companies, batch_meta = [], []
            console.log(f"DIGITAL: {i}/{len(urls)} fetched, {grants_inserted} grants in")

    grants_inserted += flush()
    return len(companies_seen), grants_inserted
