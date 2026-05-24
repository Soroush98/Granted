"""Emissions Reduction Alberta (ERA) project ingestion.

ERA (https://www.eralberta.ca) is a provincial cleantech / emissions-reduction
funder. Their projects are listed via WordPress sitemap; each project page
uses Gutenberg blocks with a predictable structure:

  <h1>{project title}</h1>
  <h2>{recipient company}</h2>
  <h3>Project Type</h3>  <h4>{type}</h4>
  <h3>Project Value</h3> <h4>{$X,XXX,XXX}</h4>
  <h3>Project Status</h3><h4>{Completed | In Progress | …}</h4>
  <h3>Location</h3>      <h4>{City, AB}</h4>
  <h3>Funding Amount</h3><h4>{$X,XXX,XXX}</h4>
  …narrative description in subsequent <p> blocks…

We treat the project's narrative body as the ``grant_description`` chunk for
RAG retrieval. ERA only publishes ~500 projects total so we ingest all of
them in one pass — they're all cleantech-relevant and dating is unreliable
(some pages don't surface a year).
"""

from __future__ import annotations

import re
from typing import Any

import httpx
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

_SITEMAP_URL = "https://www.eralberta.ca/project-sitemap.xml"
_AMOUNT_RE = re.compile(r"[\$,]")


def _fetch(url: str) -> str:
    with httpx.Client(
        timeout=30.0,
        headers={"user-agent": settings.scraper_user_agent},
        follow_redirects=True,
    ) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.text


def _project_urls() -> list[str]:
    xml = _fetch(_SITEMAP_URL)
    # Sitemap is small enough that we can regex it; selectolax doesn't do XML.
    return [m for m in re.findall(r"<loc>(https://www\.eralberta\.ca/projects/details/[^<]+)</loc>", xml)]


def _parse_amount(text: str) -> float | None:
    cleaned = _AMOUNT_RE.sub("", text or "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _extract_project(url: str, html: str) -> dict[str, Any] | None:
    tree = HTMLParser(html)
    h1 = tree.css_first("h1")
    if not h1:
        return None
    title = h1.text(strip=True)
    if not title:
        return None

    # First h2 inside the main project section is the recipient company.
    h2s = tree.css("h2")
    recipient = h2s[0].text(strip=True) if h2s else ""

    # h3/h4 pairs are project metadata in document order.
    h3s = tree.css("h3")
    h4s = tree.css("h4")
    meta: dict[str, str] = {}
    for k, v in zip(h3s, h4s):
        meta[k.text(strip=True)] = v.text(strip=True)

    # Narrative body — grab visible paragraph text.
    paragraphs = [p.text(strip=True) for p in tree.css("p") if p.text(strip=True)]
    body = " ".join(paragraphs)

    return {
        "url": url,
        "title": title,
        "recipient": recipient,
        "project_type": meta.get("Project Type"),
        "project_value": _parse_amount(meta.get("Project Value", "")),
        "funding_amount": _parse_amount(meta.get("Funding Amount", "")),
        "status": meta.get("Project Status"),
        "location": meta.get("Location"),
        "body": body[:3000],
    }


def ingest_all() -> tuple[int, int]:
    """Pull every ERA project from the sitemap and ingest. Returns
    (companies_seen, grants_inserted). Tagged under program code PROVINCIAL_OTHER."""
    from rich.console import Console
    console = Console()

    program_id = db.get_program_id("PROVINCIAL_OTHER")
    urls = _project_urls()
    console.log(f"ERA: {len(urls)} project URLs from sitemap")

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
                    "description": m["body"] or None,
                    "amount_cad": m["funding_amount"] or m["project_value"],
                    "source_url": m["url"],
                    "award_id": m["url"],  # URL is unique per project
                    "raw": {"source": "era_alberta", **m},
                }
            )
            chunk_payload.append({"_cid": cid, "_aid": m["url"], "title": m["title"], "body": m["body"]})

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
            console.log(f"[yellow]ERA fetch failed {url}: {exc}[/]")
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
            "province": "AB",
            "city": (meta.get("location") or "").split(",")[0].strip() or None,
        })
        batch_meta.append(meta)
        if len(batch_meta) >= 30:
            grants_inserted += flush()
            batch_companies, batch_meta = [], []
            console.log(f"ERA: {i}/{len(urls)} fetched, {grants_inserted} grants in")

    grants_inserted += flush()
    return len(companies_seen), grants_inserted
