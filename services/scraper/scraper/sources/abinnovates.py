"""Alberta Innovates project ingestion.

Alberta Innovates (https://albertainnovates.ca) is the province's main R&D
funder. Project URLs come from the WordPress sitemap at
``/project-sitemap.xml`` (~621 projects). Each page exposes the metadata via
a ``.project-glance`` block:

  <div class="glance-data">
    <span class="label">Funding Recipient:</span>
    <span class="value">{recipient}</span>
  </div>
  <div class="glance-data">
    <span class="label">Funding Awarded:</span>
    <span class="value">${amount}</span>
  </div>
  <div class="glance-data">
    <span class="label">Project Duration:</span>
    <span class="value">{Mon DD, YYYY} – {Mon DD, YYYY}</span>
  </div>
  …Sector, Program…

Body text is whichever long paragraph isn't the land-acknowledgement footer.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import httpx
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

_SITEMAP_URL = "https://albertainnovates.ca/project-sitemap.xml"
_AMOUNT_RE = re.compile(r"[\$,]")
_LAND_ACK = "respectfully acknowledges"


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
    return [m for m in re.findall(r"<loc>(https://albertainnovates\.ca/projects/[^<]+)</loc>", xml)]


def _parse_amount(text: str) -> float | None:
    cleaned = _AMOUNT_RE.sub("", text or "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_duration(text: str) -> tuple[str | None, str | None]:
    """'Nov 1, 2022 – Feb 1, 2025' → ('2022-11-01', '2025-02-01'). Returns
    (None, None) on any parse failure."""
    parts = re.split(r"\s*[–-]\s*", (text or "").strip())
    if len(parts) != 2:
        return None, None

    def _one(s: str) -> str | None:
        for fmt in ("%b %d, %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(s.strip(), fmt).date().isoformat()
            except ValueError:
                continue
        return None

    return _one(parts[0]), _one(parts[1])


def _extract_project(url: str, html: str) -> dict[str, Any] | None:
    tree = HTMLParser(html)
    h1 = tree.css_first("h1")
    if not h1:
        return None
    title = h1.text(strip=True)
    if not title:
        return None

    # Glance block: label/value spans.
    glance: dict[str, str] = {}
    for row in tree.css(".project-glance .glance-data"):
        label_el = row.css_first(".label")
        val_el = row.css_first(".value")
        if not label_el or not val_el:
            continue
        key = label_el.text(strip=True).rstrip(":").strip()
        val = val_el.text(strip=True)
        if key and val:
            glance[key] = val

    recipient = glance.get("Funding Recipient", "").strip()
    # Recipient sometimes has trailing co-funder list like "X, Prairies Economic
    # Development Canada" — split on first comma to keep the lead org clean.
    if recipient:
        recipient = recipient.split(",")[0].strip()

    duration = glance.get("Project Duration", "")
    start_date, end_date = _parse_duration(duration)
    amount = _parse_amount(glance.get("Funding Awarded", ""))

    # Body: longest paragraph that isn't the land acknowledgement.
    body_candidates = [
        p.text(separator=" ", strip=True)
        for p in tree.css("p")
        if p.text(strip=True) and _LAND_ACK not in p.text() and len(p.text(strip=True)) > 80
    ]
    body = max(body_candidates, key=len, default="")

    return {
        "url": url,
        "title": title,
        "recipient": recipient,
        "sector": glance.get("Sector"),
        "program": glance.get("Program"),
        "amount_cad": amount,
        "start_date": start_date,
        "end_date": end_date,
        "body": body[:3000],
    }


def ingest_all(date_cutoff: str | None = None) -> tuple[int, int]:
    """Ingest all Alberta Innovates projects from sitemap. If ``date_cutoff``
    is set, skip projects whose end_date is before it (i.e., truly stale)."""
    from rich.console import Console
    console = Console()

    program_id = db.get_program_id("PROVINCIAL_OTHER")
    urls = _project_urls()
    console.log(f"AB Innovates: {len(urls)} project URLs from sitemap")

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
        chunk_inputs: list[dict[str, Any]] = []
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
                    "amount_cad": m["amount_cad"],
                    "start_date": m["start_date"],
                    "end_date": m["end_date"],
                    "source_url": m["url"],
                    "award_id": m["url"],
                    "raw": {"source": "alberta_innovates", **m},
                }
            )
            chunk_inputs.append({"_cid": cid, "_aid": m["url"],
                                 "title": m["title"], "body": m["body"]})

        grant_map = db.bulk_upsert_grants(grant_payload)
        chunks: list[dict[str, Any]] = []
        for cp in chunk_inputs:
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
            console.log(f"[yellow]AB fetch failed {url}: {exc}[/]")
            continue
        meta = _extract_project(url, html)
        if not meta or not meta["recipient"]:
            continue
        # Date filter: skip if end_date is before cutoff AND start_date is too
        # (we keep ongoing or recent projects).
        if date_cutoff and meta["end_date"] and meta["end_date"] < date_cutoff:
            if not meta["start_date"] or meta["start_date"] < date_cutoff:
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
        })
        batch_meta.append(meta)
        if len(batch_meta) >= 30:
            grants_inserted += flush()
            batch_companies, batch_meta = [], []
            console.log(f"AB Innovates: {i}/{len(urls)} fetched, {grants_inserted} grants in")

    grants_inserted += flush()
    return len(companies_seen), grants_inserted
