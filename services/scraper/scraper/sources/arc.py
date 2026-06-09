"""Australian Research Council (ARC) ingestion — via the public Data Portal API.

ARC funds non-medical research (Discovery, Linkage, Fellowships); medical
research is NHMRC's remit. We add it so the "find a PI" flow covers Australia
for the health-adjacent ARC fields (public health, biomedical engineering,
neuroscience, psychology). NHMRC is ingested separately (nhmrc.py).

The Data Portal exposes a clean JSON:API at
    https://dataportal.arc.gov.au/NCGP/API/grants
paginated, newest-first (the grant code embeds the round year, e.g. LP2502…).
Every record carries everything we need in `attributes`:

    code ......................... grant id (our award_id)
    scheme-name .................. e.g. "Discovery Projects", "Linkage Projects"
    grant-summary ................ the project summary / abstract (100% filled)
    lead-investigator ............ the chief investigator (our PI), e.g.
                                   "Prof Jane Smith" — a host who can take a
                                   visiting researcher
    current-admin-organisation ... administering university
    current-funding-amount ....... award value
    funding-commencement-year .... start year
    anticipated-end-date ......... end date (often blank)
    primary-field-of-research .... e.g. "4206 - Public Health"
    national-interest-test-statement  extra plain-language description

Because the corpus has no country column, we lean on the funder: the web app
maps an `ARC` (or `NHMRC`) grant to Australia. We store the host university as a
`university` recipient so it flows through the PI filter, and persist the raw
attributes so the web app's holder extraction reads the PI + scheme + source.
"""

from __future__ import annotations

from typing import Any

import httpx
from rich.console import Console

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

console = Console()

_API = "https://dataportal.arc.gov.au/NCGP/API/grants"
_PAGE_SIZE = 1000
_DEFAULT_ORG_TYPE = "university"


def _attr(rec: dict[str, Any], key: str) -> str:
    v = rec.get("attributes", {}).get(key)
    return "" if v is None else str(v).strip()


def _year(rec: dict[str, Any]) -> int | None:
    raw = _attr(rec, "funding-commencement-year")
    try:
        return int(float(raw)) if raw else None
    except ValueError:
        return None


def _amount(rec: dict[str, Any]) -> float | None:
    raw = _attr(rec, "current-funding-amount") or _attr(rec, "announced-funding-amount")
    raw = raw.replace(",", "").replace("$", "")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _description(rec: dict[str, Any]) -> str | None:
    """Summary + field-of-research + national-interest text, for retrieval."""
    parts = [_attr(rec, "grant-summary")]
    if for_ := _attr(rec, "primary-field-of-research"):
        parts.append(f"Field of research: {for_}")
    if nit := _attr(rec, "national-interest-test-statement"):
        parts.append(nit)
    text = "\n\n".join(p for p in parts if p)
    return text or None


def _fetch_page(client: httpx.Client, page: int) -> tuple[list[dict[str, Any]], int]:
    """Return (records, total_pages) for a 1-based page number."""
    resp = client.get(
        _API,
        params={"page[size]": _PAGE_SIZE, "page[number]": page},
        headers={"user-agent": settings.scraper_user_agent},
        timeout=60.0,
    )
    resp.raise_for_status()
    body = resp.json()
    return body.get("data", []), int(body.get("meta", {}).get("total-pages", 0))


def ingest_api(*, since_year: int = 2016, limit: int | None = None) -> tuple[int, int]:
    """Page through the ARC grants API (newest-first) and ingest grants whose
    funding commences in ``since_year`` or later. Returns (institutions_seen,
    grants_inserted)."""
    program_id = db.ensure_program_id(
        "ARC",
        name="ARC National Competitive Grants",
        agency="ARC",
    )
    seen_companies: set[str] = set()
    grants_inserted = 0
    scanned = 0

    def flush(records: list[dict[str, Any]]) -> int:
        prepared: list[dict[str, Any]] = []
        company_payload: list[dict[str, Any]] = []
        for rec in records:
            org_name = _attr(rec, "current-admin-organisation") or _attr(
                rec, "announcement-admin-organisation"
            )
            if not org_name:
                continue
            normalized = normalize_org_name(org_name)
            if not normalized:
                continue
            code = _attr(rec, "code")
            if not code:
                continue
            company_payload.append(
                {
                    "display_name": org_name,
                    "normalized_name": normalized,
                    "org_type": _DEFAULT_ORG_TYPE,
                }
            )
            year = _year(rec)
            prepared.append(
                {
                    "rec": rec,
                    "normalized": normalized,
                    "award_id": code,
                    "description": _description(rec),
                    "start_date": f"{year}-01-01" if year else None,
                    "end_date": (_attr(rec, "anticipated-end-date") or None),
                    "fiscal_year": str(year) if year else None,
                }
            )
        if not prepared:
            return 0

        company_map = db.bulk_upsert_companies(company_payload)
        seen_companies.update(company_map.values())

        grant_payload: list[dict[str, Any]] = []
        for p in prepared:
            cid = company_map.get((p["normalized"], _DEFAULT_ORG_TYPE))
            if not cid:
                continue
            p["company_id"] = cid
            grant_payload.append(
                {
                    "program_id": program_id,
                    "recipient_id": cid,
                    "title": None,
                    "description": p["description"],
                    "amount_cad": _amount(p["rec"]),
                    "start_date": p["start_date"],
                    "end_date": p["end_date"],
                    "fiscal_year": p["fiscal_year"],
                    "award_id": p["award_id"],
                    # Store the flat attributes so the web app reads PI/scheme.
                    "raw": p["rec"].get("attributes", {}),
                }
            )
        grant_map = db.bulk_upsert_grants(grant_payload)

        chunk_payload: list[dict[str, Any]] = []
        for p in prepared:
            if "company_id" not in p or not p["description"]:
                continue
            gid = grant_map.get((program_id, p["award_id"]))
            if not gid:
                continue
            chunk_payload.append(
                {
                    "grant_id": gid,
                    "company_id": p["company_id"],
                    "kind": "grant_description",
                    "content": p["description"][:2000],
                }
            )
        # Defer embedding — embed-pending vectorizes later in small batches.
        db.bulk_insert_chunks(chunk_payload, embed=False)
        return len(grant_payload)

    with httpx.Client(http2=False) as client:
        _, total_pages = _fetch_page(client, 1)
        page = 1
        while page <= max(total_pages, 1):
            records, _ = _fetch_page(client, page)
            if not records:
                break
            # Newest-first: once an entire page is older than the cutoff, stop.
            in_window = [r for r in records if (_year(r) or 0) >= since_year]
            scanned += len(records)
            if in_window:
                grants_inserted += flush(in_window)
            console.log(
                f"ARC: page {page}/{total_pages}, scanned {scanned}, "
                f"{grants_inserted} grants in…"
            )
            if not in_window and any((_year(r) or 0) < since_year for r in records):
                break
            if limit is not None and grants_inserted >= limit:
                break
            page += 1

    return len(seen_companies), grants_inserted
