"""Canada Foundation for Innovation (CFI) funded-projects scraper.

CFI publishes its funded projects through a Drupal dashboard at:
    https://www.innovation.ca/projects-results/funded-projects-dashboard

There is no JSON API — the page renders project cards as inline HTML, 10 per
page, with a `?f[0]=year:{YYYY}` facet for year filtering. Each card carries
the project title, year, institution, fund-type, contribution amount, field of
research, and team members.

Year is the only date granularity (no start/end_date), and "year" appears to
mean "calendar year of award" based on the latest listings (2025 entries are
recent). We synthesize start_date = YYYY-01-01 for window-filterability.
"""

from __future__ import annotations

import re
import time
from typing import Any

import httpx
from rich.console import Console
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

console = Console()

_BASE = "https://www.innovation.ca/projects-results/funded-projects-dashboard"


def _fetch_page(client: httpx.Client, year: int, page: int) -> str:
    """Fetch one results page. ``page`` is 0-indexed (matches the site)."""
    url = f"{_BASE}?f%5B0%5D=year%3A{year}&page={page}"
    r = client.get(url, follow_redirects=True)
    r.raise_for_status()
    return r.text


def _parse_amount(raw: str | None) -> float | None:
    if not raw:
        return None
    # "$1,234,567" → 1234567.0
    s = re.sub(r"[^0-9.]", "", raw)
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_cards(html: str) -> list[dict[str, str | float | None]]:
    """Pull every project card off the page. Returns a list of structured
    dicts. Selectors target the stable Drupal field markup; if the markup
    changes, this is where to look first."""
    tree = HTMLParser(html)
    out: list[dict[str, str | float | None]] = []
    for card in tree.css("div.card.project"):
        cid_attr = card.attributes.get("id") or ""
        m = re.match(r"project-(\d+)", cid_attr)
        if not m:
            continue
        project_id = m.group(1)
        title_node = card.css_first("div.header.title span.field--name-title") or card.css_first("div.header.title span")
        year_node = card.css_first("div.header.year span:last-child")
        inst_node = card.css_first("div.header.institution span:last-child")
        fund_node = card.css_first("div.header.fund-type span:last-child")
        amt_node = card.css_first("div.header.contribution span:last-child")
        for_node = card.css_first("div.content-cell.division div.value")
        leaders_node = card.css_first("div.content-cell.team-leaders div.value")
        members_node = card.css_first("div.content-cell.team-members div.value")

        def _t(n: Any) -> str:
            return n.text(strip=True) if n is not None else ""

        out.append({
            "project_id": project_id,
            "title": _t(title_node),
            "year": _t(year_node),
            "institution": _t(inst_node),
            "fund_type": _t(fund_node),
            "amount_cad": _parse_amount(_t(amt_node)),
            "field_of_research": _t(for_node) or None,
            "team_leaders": _t(leaders_node) or None,
            "team_members": _t(members_node) or None,
        })
    return out


def _row_description(c: dict[str, str | float | None]) -> str | None:
    """No project abstract is exposed — synthesize a chunk from fund-type +
    field of research + team. This is what gets embedded for retrieval."""
    parts: list[str] = []
    for key, label in [
        ("fund_type", "Fund type"),
        ("field_of_research", "Field of research"),
        ("team_leaders", "Team leader(s)"),
        ("team_members", "Team members"),
    ]:
        v = c.get(key)
        if v:
            parts.append(f"{label}: {v}")
    return "; ".join(parts) or None


def ingest_years(years: list[int]) -> tuple[int, int]:
    """Crawl every page for each requested year and ingest the cards.

    Returns (companies_seen, grants_inserted). Stops at a year as soon as it
    sees a page with zero cards (the natural end of pagination)."""
    program_id = db.get_program_id("CFI")
    seen_companies: set[str] = set()
    grants_inserted = 0
    cards_total = 0

    with httpx.Client(
        timeout=30.0,
        headers={"user-agent": settings.scraper_user_agent},
    ) as client:
        for year in years:
            page = 0
            while True:
                try:
                    html = _fetch_page(client, year, page)
                except httpx.HTTPError as exc:
                    console.log(f"[yellow]CFI year={year} page={page}: {exc}[/]")
                    break
                cards = _parse_cards(html)
                if not cards:
                    break
                cards_total += len(cards)
                grants_inserted += _ingest_batch(cards, year=year, program_id=program_id, seen=seen_companies)
                console.log(f"CFI {year}: page {page} ({len(cards)} cards); total so far {grants_inserted}")
                page += 1
                # be polite — Drupal pages aren't cached aggressively for filtered views
                time.sleep(0.4)
    return len(seen_companies), grants_inserted


def _ingest_batch(cards: list[dict[str, Any]], *, year: int, program_id: str, seen: set[str]) -> int:
    company_payload: list[dict[str, Any]] = []
    prepared: list[dict[str, Any]] = []
    for c in cards:
        org_name = (c.get("institution") or "").strip() if isinstance(c.get("institution"), str) else ""
        if not org_name:
            continue
        normalized = normalize_org_name(org_name)
        if not normalized:
            continue
        company_payload.append({
            "display_name": org_name,
            "normalized_name": normalized,
            "org_type": "university",
        })
        prepared.append({
            "card": c,
            "normalized": normalized,
            "award_id": c["project_id"],
        })
    if not prepared:
        return 0

    company_map = db.bulk_upsert_companies(company_payload)
    seen.update(company_map.values())

    grant_payload: list[dict[str, Any]] = []
    for p in prepared:
        cid = company_map.get((p["normalized"], "university"))
        if not cid:
            continue
        p["company_id"] = cid
        card = p["card"]
        # Year is calendar year of award; map to YYYY-01-01 so the existing
        # date-window filters work. Source URL is the dashboard with the
        # project's anchor; CFI doesn't have per-project detail pages.
        yr = (card.get("year") or "").strip() or str(year)
        start_date = f"{yr}-01-01" if yr.isdigit() else None
        grant_payload.append({
            "program_id": program_id,
            "recipient_id": cid,
            "title": card.get("title"),
            "description": _row_description(card),
            "amount_cad": card.get("amount_cad"),
            "start_date": start_date,
            "fiscal_year": yr or None,
            "award_id": card["project_id"],
            "source_url": f"{_BASE}#project-{card['project_id']}",
            "raw": {k: v for k, v in card.items() if v is not None},
        })
    grant_map = db.bulk_upsert_grants(grant_payload)

    chunk_payload: list[dict[str, Any]] = []
    for p in prepared:
        if "company_id" not in p:
            continue
        gid = grant_map.get((program_id, p["award_id"]))
        if not gid:
            continue
        card = p["card"]
        if card.get("title"):
            chunk_payload.append({
                "grant_id": gid,
                "company_id": p["company_id"],
                "kind": "grant_title",
                "content": card["title"],
            })
        desc = _row_description(card)
        if desc:
            chunk_payload.append({
                "grant_id": gid,
                "company_id": p["company_id"],
                "kind": "grant_description",
                "content": desc[:2000],
            })
    db.bulk_insert_chunks(chunk_payload, embed=False)
    return len(grant_payload)
