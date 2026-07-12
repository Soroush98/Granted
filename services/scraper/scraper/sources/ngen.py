"""Next Generation Manufacturing Canada (NGen) funded-project ingestion.

NGen (https://www.ngen.ca) is the industry-led non-profit that runs Canada's
Advanced Manufacturing supercluster. It co-funds collaborative manufacturing
projects and publishes every funded project in a single directory page.

The directory (`/projects`, which redirects to `/funding/projects`) is one big
HubSpot-rendered HTML document: there is NO server-side pagination. Every
project is inlined *twice* —

  1. A **card** ``<div class="… project-box">`` carrying the structured fields
     as data attributes:

        data-id="detail-<ID>"  data-lead="<Lead Org>"
        data-partners="<comma-separated orgs>"  data-funding-stream="<stream>"
        data-lat  data-lng

     …plus visible ``<h4 class="sector">`` (stream), ``<h4 class="title">``
     (title), ``<p>{lead}</p>``, ``<p>Location: {Province}</p>`` and
     ``<p>Budget: ${total}</p>``.

  2. A **detail modal** ``<div id="detail-<ID>" class="details-modal">`` with
     the rich fields: the project status (``<li class="pro-Completed">``), a
     "PROJECT PARTICIPANTS" table (rows ``Lead Organization``/``Partner`` |
     org | city), a "PROJECT DETAILS" block with ``Total Project Value`` and
     ``Value of NGen Support`` dollar amounts, and a "PROJECT BRIEF" narrative
     in ``<div class="data"><p>…</p></div>``.

The card and modal share ``<ID>`` (card ``data-id="detail-<ID>"`` ↔ modal
``id="detail-<ID>"``); we join on it to combine the card's structured fields
with the modal's brief and amounts.

Recipient = the **Lead Organization** (``org_type="company"``) — this feeds
/jobs. ``amount_cad`` is the **Value of NGen Support** (the actual grant),
falling back to Total Project Value. The PROJECT BRIEF becomes the
``grant_description`` chunk for RAG retrieval.

DOM notes (verified against the live page 2026-07): the stream span is
misspelled ``class="funcding-stream"``; amounts can carry cents
(``$711,928.56``); the default ``GrantedBot`` UA is served the full page, but
we fall back to a Chrome UA if HubSpot ever returns a 403 or an empty body.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

# `/projects` 301s to `/funding/projects`; both render the same directory.
_DIRECTORY_URLS = ("https://www.ngen.ca/projects", "https://www.ngen.ca/funding/projects")
_CANONICAL_URL = "https://www.ngen.ca/funding/projects"
# HubSpot occasionally blocks non-browser agents — bake in a Chrome UA fallback.
_CHROME_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

_AMOUNT_RE = re.compile(r"[\$,]")
_TOTAL_RE = re.compile(r"Total Project Value:\s*\$([\d,]+(?:\.\d+)?)")
_NGEN_RE = re.compile(r"Value of NGen Support:\s*\$([\d,]+(?:\.\d+)?)")

# Province name → 2-letter code (matches the codes other sources store). Any
# unmapped value falls through as the raw name string.
_PROVINCES = {
    "alberta": "AB",
    "british columbia": "BC",
    "manitoba": "MB",
    "new brunswick": "NB",
    "newfoundland and labrador": "NL",
    "newfoundland & labrador": "NL",
    "northwest territories": "NT",
    "nova scotia": "NS",
    "nunavut": "NU",
    "ontario": "ON",
    "prince edward island": "PE",
    "quebec": "QC",
    "québec": "QC",
    "saskatchewan": "SK",
    "yukon": "YT",
}


def _fetch(url: str, ua: str) -> str:
    with httpx.Client(
        timeout=30.0,
        headers={"user-agent": ua},
        follow_redirects=True,
    ) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.text


def _fetch_directory() -> str:
    """Fetch the single directory page. Tries the configured UA first, then a
    Chrome UA, across both directory URLs; returns the first body that actually
    contains project cards."""
    last_html = ""
    for ua in (settings.scraper_user_agent, _CHROME_UA):
        for url in _DIRECTORY_URLS:
            try:
                html = _fetch(url, ua)
            except httpx.HTTPError:
                continue
            if html and "project-box" in html:
                return html
            last_html = html or last_html
    if not last_html:
        raise RuntimeError("NGen: could not fetch the project directory")
    return last_html


def _parse_amount(text: str | None) -> float | None:
    cleaned = _AMOUNT_RE.sub("", text or "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _province_code(name: str) -> str | None:
    n = (name or "").strip()
    if not n:
        return None
    return _PROVINCES.get(n.lower(), n)


def _card_location(card: Any) -> str:
    for p in card.css("p"):
        t = p.text(strip=True)
        if t.lower().startswith("location:"):
            return t.split(":", 1)[1].strip()
    return ""


def _modal_status(modal: Any) -> str | None:
    li = modal.css_first("ul.status li")
    return li.text(strip=True) if li else None


def _modal_lead_city(modal: Any) -> str | None:
    """City of the Lead Organization from the PROJECT PARTICIPANTS table."""
    for box in modal.css("div.content-box"):
        h4 = box.css_first("h4")
        if not h4 or h4.text(strip=True) != "PROJECT PARTICIPANTS":
            continue
        for tr in box.css("tr"):
            tds = tr.css("td")
            if len(tds) >= 3 and tds[0].text(strip=True).lower().startswith("lead"):
                return tds[2].text(strip=True) or None
    return None


def _modal_brief(modal: Any) -> str:
    """The PROJECT BRIEF narrative (``div.data`` only — excludes the
    sector/tech ``p.data-info`` footer)."""
    for box in modal.css("div.content-box"):
        h4 = box.css_first("h4")
        if not h4 or h4.text(strip=True) != "PROJECT BRIEF":
            continue
        data = box.css_first("div.data")
        if data:
            return data.text(strip=True)
    return ""


def _extract_project(card: Any, modal: Any | None) -> dict[str, Any] | None:
    detail_id = card.attributes.get("data-id") or ""  # e.g. "detail-43256670628"
    if not detail_id:
        return None
    proj_id = detail_id.replace("detail-", "", 1)

    lead = (card.attributes.get("data-lead") or "").strip()
    partners = (card.attributes.get("data-partners") or "").strip()
    funding_stream = (card.attributes.get("data-funding-stream") or "").strip()
    if not funding_stream:
        sector = card.css_first("h4.sector")
        funding_stream = sector.text(strip=True) if sector else ""

    title_node = card.css_first("h4.title")
    title = title_node.text(strip=True) if title_node else ""
    location = _card_location(card)

    # Card budget is the Total Project Value; used only as an amount fallback.
    card_budget = None
    for p in card.css("p"):
        t = p.text(strip=True)
        if t.lower().startswith("budget:"):
            card_budget = _parse_amount(t.split(":", 1)[1])

    status = brief = lead_city = None
    total_value = ngen_support = None
    if modal is not None:
        mtext = " ".join(modal.text().split())
        tot = _TOTAL_RE.search(mtext)
        ng = _NGEN_RE.search(mtext)
        total_value = _parse_amount(tot.group(1)) if tot else None
        ngen_support = _parse_amount(ng.group(1)) if ng else None
        status = _modal_status(modal)
        lead_city = _modal_lead_city(modal)
        brief = _modal_brief(modal)
        if not title:
            mtitle = modal.css_first("div.title h4")
            title = mtitle.text(strip=True) if mtitle else ""

    if total_value is None:
        total_value = card_budget

    if not title or not lead:
        return None

    # Brief is the narrative chunk; synthesize a stand-in if a project has none
    # so the grant still carries searchable text.
    if not brief:
        pieces = []
        if funding_stream:
            pieces.append(f"{funding_stream} led by {lead}.")
        if partners:
            pieces.append(f"Participants: {partners}.")
        brief = " ".join(pieces).strip()

    return {
        "id": proj_id,
        "award_id": f"ngen-{proj_id}",
        "title": title,
        "funding_stream": funding_stream,
        "lead": lead,
        "lead_city": lead_city,
        "partners": partners,
        "status": status,
        "location": location,
        "province": _province_code(location),
        "total_value": total_value,
        "ngen_support": ngen_support,
        "brief": brief,
        "source_url": f"{_CANONICAL_URL}#{detail_id}",
    }


def _parse_projects(html: str) -> list[dict[str, Any]]:
    """Parse every project out of the single directory page by joining each
    card to its detail modal on the shared ``detail-<ID>`` key."""
    tree = HTMLParser(html)
    modals = {m.attributes.get("id"): m for m in tree.css("div.details-modal")}
    projects: list[dict[str, Any]] = []
    for card in tree.css("div.project-box"):
        detail_id = card.attributes.get("data-id")
        modal = modals.get(detail_id) if detail_id else None
        proj = _extract_project(card, modal)
        if proj:
            projects.append(proj)
    return projects


def ingest_all(limit: int | None = None) -> tuple[int, int]:
    """Fetch the one NGen directory page, parse every project, and ingest.

    Returns (companies_seen, grants_inserted). ``limit`` caps the number of
    projects processed (smoke tests). Tagged under program code NGEN."""
    from rich.console import Console
    console = Console()

    program_id = db.ensure_program_id(
        "NGEN", name="Next Generation Manufacturing Canada", agency="NGen"
    )

    html = _fetch_directory()
    projects = _parse_projects(html)
    if limit is not None:
        projects = projects[:limit]
    console.log(f"NGen: {len(projects)} projects parsed from directory")

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
                    "description": m["brief"] or None,
                    # Grant = NGen's contribution; total value only as a fallback.
                    "amount_cad": m["ngen_support"] or m["total_value"],
                    "source_url": m["source_url"],
                    "award_id": m["award_id"],
                    "raw": {
                        "source": "ngen",
                        "funding_stream": m["funding_stream"],
                        "lead": m["lead"],
                        "partners": m["partners"],
                        "status": m["status"],
                        "total_value": m["total_value"],
                        "ngen_support": m["ngen_support"],
                        "location": m["location"],
                        "id": m["id"],
                    },
                }
            )
            chunk_payload.append(
                {"_cid": cid, "_aid": m["award_id"], "title": m["title"], "brief": m["brief"]}
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
            if cp["brief"]:
                chunks.append({"grant_id": gid, "company_id": cp["_cid"],
                               "kind": "grant_description", "content": cp["brief"][:2000]})
        db.bulk_insert_chunks(chunks)
        return len(grant_payload)

    for i, proj in enumerate(projects, 1):
        normalized = normalize_org_name(proj["lead"])
        if not normalized:
            continue
        proj["normalized"] = normalized
        batch_companies.append({
            "display_name": proj["lead"],
            "normalized_name": normalized,
            "org_type": "company",
            "province": proj["province"],
            "city": proj["lead_city"],
        })
        batch_meta.append(proj)
        if len(batch_meta) >= 30:
            grants_inserted += flush()
            batch_companies, batch_meta = [], []
            console.log(f"NGen: {i}/{len(projects)} processed, {grants_inserted} grants in")

    grants_inserted += flush()
    return len(companies_seen), grants_inserted
