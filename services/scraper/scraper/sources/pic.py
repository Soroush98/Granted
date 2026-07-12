"""Protein Industries Canada (PIC) funded-project ingestion.

PIC (https://www.proteinindustriescanada.ca) is one of Canada's Global
Innovation Clusters — it co-funds consortium projects across the plant-protein
value chain. Their funded projects live on a Craft CMS site under a paginated
list:

    /projects, /projects/p2, /projects/p3, … (one card grid per page)

Each card links to a detail page whose body is a clean label/value flow:

  <h1 class="page__heading">{project title}</h1>
  <time datetime="…">{date}</time>            # header <dl class="page__details">
  <a>{category}</a>                            #   "

  .infoMiniBlockWithIcon__content blocks (tagline / boldCopy / bodyCopy):
    PROJECT TIMELINE  → "October 2025 to September 2027"
    PROJECT STATUS    → "Fund II: In progress"
    TOTAL INVESTMENT  → "$1,840,986"   (bodyCopy nests the two contributions)
    Partners          → <p> per partner org

  Consortium / Cluster Contribution live inside the TOTAL INVESTMENT block's
  bodyCopy as <p><strong>Label</strong>…$amount</p>. The markup is grubby —
  the label is sometimes split across several nested <strong> tags
  (<strong>Consortium </strong><strong><strong>Contribution</strong></strong>…)
  — so we identify the field by keyword in the paragraph text and pull the
  "$…" amount with a regex rather than trusting the <strong> boundary.

  <h2>Goal</h2>            <div class="matrix__text">{one-line goal}</div>
  <h2>Project Summary</h2> <div class="matrix__text">{multi-paragraph summary}</div>

The recipient we track is the FIRST partner (the lead consortium member),
org_type "company". ``amount_cad`` is PIC's own contribution (the grant
portion = "Cluster Contribution"), falling back to Total Investment. The Goal +
Project Summary form the retrievable description chunk; we append a line naming
all partners so consortium members are searchable too. Pagination clamps
out-of-range page numbers to the last page (p10 == p9), so we stop when a page
yields no *new* project links rather than when it yields zero.
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

_LIST_BASE = "https://www.proteinindustriescanada.ca/projects"
_MAX_LIST_PAGES = 15  # safety cap; the real list is ~9 pages
_AMOUNT_RE = re.compile(r"[\$,]")
_MONEY_RE = re.compile(r"\$[\d,]+(?:\.\d+)?")
# Real project cards use a.card__mainLink; exclude the /projects/pN pagers.
_PROJECT_HREF_RE = re.compile(r"/projects/[a-z0-9-]+$")
_PAGER_HREF_RE = re.compile(r"/projects/p\d+$")


def _fetch(url: str) -> str:
    """GET with a short retry on transient transport/timeout errors.

    HTTP status errors (404, 5xx) surface immediately as httpx.HTTPStatusError
    so the caller can skip a permanently-broken URL."""
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            with httpx.Client(
                timeout=30.0,
                headers={"user-agent": settings.scraper_user_agent},
                follow_redirects=True,
            ) as c:
                r = c.get(url)
                r.raise_for_status()
                return r.text
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            last_exc = exc
            time.sleep(0.5 * (2 ** attempt))
    assert last_exc is not None
    raise last_exc


def _parse_amount(text: str | None) -> float | None:
    cleaned = _AMOUNT_RE.sub("", text or "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _meta(tree: HTMLParser, prop: str) -> str:
    for m in tree.css("meta"):
        if m.attributes.get("property") == prop or m.attributes.get("name") == prop:
            return (m.attributes.get("content") or "").strip()
    return ""


def _card_links(html: str) -> list[str]:
    """Absolute detail URLs from a list page's project cards, in page order."""
    tree = HTMLParser(html)
    out: list[str] = []
    seen: set[str] = set()
    for a in tree.css("a.card__mainLink"):
        href = (a.attributes.get("href") or "").strip()
        if not href or _PAGER_HREF_RE.search(href) or not _PROJECT_HREF_RE.search(href):
            continue
        if href not in seen:
            seen.add(href)
            out.append(href)
    return out


def _project_urls(limit: int | None = None) -> list[str]:
    """Walk the paginated list, collecting detail URLs until a page adds nothing
    new (the CMS repeats the final page for out-of-range page numbers)."""
    from rich.console import Console
    console = Console()

    urls: list[str] = []
    seen: set[str] = set()
    for page in range(1, _MAX_LIST_PAGES + 1):
        url = _LIST_BASE if page == 1 else f"{_LIST_BASE}/p{page}"
        try:
            html = _fetch(url)
        except httpx.HTTPError as exc:
            console.log(f"[yellow]PIC list page fetch failed {url}: {exc}[/]")
            break
        new = [u for u in _card_links(html) if u not in seen]
        if not new:
            break
        for u in new:
            seen.add(u)
            urls.append(u)
            if limit is not None and len(urls) >= limit:
                return urls
    return urls


def _section(tree: HTMLParser, name: str) -> str | None:
    """Text of the matrix__text block following an <h2> whose label == name."""
    target = name.lower()
    for h in tree.css("h2"):
        if h.text(strip=True).lower() != target:
            continue
        sib = h.next
        while sib is not None:
            if sib.tag != "-text":
                cls = sib.attributes.get("class") or ""
                if "matrix__text" in cls:
                    text = sib.text(strip=True)
                    return text or None
                if sib.tag in ("h1", "h2", "h3"):
                    break
            sib = sib.next
    return None


def _extract_project(url: str, html: str) -> dict[str, Any] | None:
    tree = HTMLParser(html)
    for tag in tree.css("script,style,noscript"):
        tag.decompose()

    h1 = tree.css_first("h1")
    title = _meta(tree, "og:title") or (h1.text(strip=True) if h1 else "")
    if not title:
        return None

    # Header <dl> carries the date (<time>) and category (<a>).
    date = category = None
    dl = tree.css_first("dl.page__details")
    if dl:
        t = dl.css_first("time")
        if t and t.text(strip=True):
            date = t.text(strip=True)
        a = dl.css_first("a")
        if a and a.text(strip=True):
            category = a.text(strip=True)

    timeline = status = total = consortium = cluster = None
    partners: list[str] = []
    for block in tree.css(".infoMiniBlockWithIcon__content"):
        tag = block.css_first(".infoMiniBlockWithIcon__tagline")
        key = (tag.text(strip=True) if tag else "").upper()
        bold = block.css_first(".infoMiniBlockWithIcon__boldCopy")
        bold_val = bold.text(strip=True) if bold else ""
        body = block.css_first(".infoMiniBlockWithIcon__bodyCopy")
        if key == "PROJECT TIMELINE":
            timeline = bold_val or None
        elif key == "PROJECT STATUS":
            status = bold_val or None
        elif key == "TOTAL INVESTMENT":
            total = bold_val or None
            if body:
                # Consortium/Cluster split lives here; nested <strong> tags mean
                # we can't trust one strong node, so key off the paragraph text.
                for p in body.css("p"):
                    full = p.text(strip=True)
                    low = full.lower()
                    m = _MONEY_RE.search(full)
                    amount = m.group(0) if m else None
                    if "consortium" in low:
                        consortium = amount
                    elif "cluster" in low:
                        cluster = amount
        elif key == "PARTNERS":
            if body:
                partners = [p.text(strip=True) for p in body.css("p") if p.text(strip=True)]

    # Doc-wide fallback if the contributions weren't inside the total block.
    if consortium is None or cluster is None:
        for p in tree.css("p"):
            full = p.text(strip=True)
            low = full.lower()
            m = _MONEY_RE.search(full)
            amount = m.group(0) if m else None
            if consortium is None and "consortium contribution" in low:
                consortium = amount
            if cluster is None and "cluster contribution" in low:
                cluster = amount

    goal = _section(tree, "goal")
    summary = _section(tree, "project summary")

    # Description chunk: Goal + Project Summary, falling back to og:description;
    # always name the partners so consortium members are searchable.
    body_parts = [part for part in (goal, summary) if part]
    description = " ".join(body_parts) if body_parts else (_meta(tree, "og:description") or "")
    if partners:
        line = f"Partners: {', '.join(partners)}"
        description = (f"{description}\n\n{line}").strip() if description else line

    recipient = partners[0] if partners else ""
    amount_cad = _parse_amount(cluster)
    if amount_cad is None:
        amount_cad = _parse_amount(total)

    return {
        "url": url,
        "title": title,
        "recipient": recipient,
        "partners": partners,
        "date": date,
        "category": category,
        "timeline": timeline,
        "status": status,
        "total_investment": total,
        "consortium_contribution": consortium,
        "cluster_contribution": cluster,
        "goal": goal,
        "amount_cad": amount_cad,
        "description": description or None,
    }


def ingest_all(limit: int | None = None) -> tuple[int, int]:
    """Pull every PIC funded project and ingest under program code PIC. Returns
    (companies_seen, grants_inserted). ``limit`` caps the number of project URLs
    (smoke-test knob)."""
    from rich.console import Console
    console = Console()

    program_id = db.ensure_program_id(
        "PIC", name="Protein Industries Canada", agency="Protein Industries Canada"
    )
    urls = _project_urls(limit)
    console.log(f"PIC: {len(urls)} project URLs across list pages")

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
                        "source": "protein_industries",
                        "category": m["category"],
                        "date": m["date"],
                        "timeline": m["timeline"],
                        "status": m["status"],
                        "total_investment": m["total_investment"],
                        "consortium_contribution": m["consortium_contribution"],
                        "cluster_contribution": m["cluster_contribution"],
                        "partners": m["partners"],
                        "goal": m["goal"],
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
            console.log(f"[yellow]PIC fetch failed {url}: {exc}[/]")
            continue
        meta = _extract_project(url, html)
        if not meta or not meta["recipient"]:
            continue
        normalized = normalize_org_name(meta["recipient"])
        if not normalized:
            continue
        meta["normalized"] = normalized
        batch_companies.append({
            "display_name": meta["recipient"],
            "normalized_name": normalized,
            "org_type": "company",
        })
        batch_meta.append(meta)
        if len(batch_meta) >= 30:
            grants_inserted += flush()
            batch_companies, batch_meta = [], []
            console.log(f"PIC: {i}/{len(urls)} fetched, {grants_inserted} grants in")

    grants_inserted += flush()
    return len(companies_seen), grants_inserted
