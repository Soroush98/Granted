"""NIH (U.S. National Institutes of Health) ingestion — via the RePORTER v2 API.

NIH is the US medical-research funder — CIHR/NHMRC's counterpart and the right
source for a clinician/MD looking at US labs. RePORTER exposes every funded
project with its scientific abstract, contact PI, and grantee organization:

    POST https://api.reporter.nih.gov/v2/projects/search
    {"criteria": {...}, "offset": N, "limit": 500}

Pagination quirks we work around:
  - `limit` caps at 500 and `offset` at 14,999 per criteria set, while a single
    NIH year is ~80k awards — so we window the search by `award_notice_date`
    and recursively split any window that still exceeds the offset cap
    (September, NIH's fiscal year-end, is notoriously dense).
  - Yearly non-competing continuations re-issue the same grant with a new
    support year (5R01...-03, -04). We key award_id on `core_project_num`
    (e.g. R01AI175397) so re-runs update one row instead of duplicating.
  - `exclude_subprojects` drops the per-core/per-project rows of multi-
    component (P01/U54) grants that would otherwise flood the corpus with
    administrative-core abstracts.

Like ARC/NHMRC/NSF, country is keyed off the funder (`NIH` → United States),
and we restrict to US-based orgs. Amounts are USD in `amount_cad` (the column
predates multi-currency). `_funder`/`_pi`/`_program`/`_trainee` markers go into
raw for the web app's holder extraction; activity codes starting with F or T
(fellowships/training) mark the holder as a trainee, not a PI.
"""

from __future__ import annotations

import time
from datetime import date
from typing import Any

import httpx
from rich.console import Console

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

console = Console()

_API = "https://api.reporter.nih.gov/v2/projects/search"
_LIMIT = 500
_MAX_OFFSET = 14_999  # RePORTER hard cap per criteria set

_FIELDS = [
    "ProjectNum",
    "CoreProjectNum",
    "ProjectTitle",
    "AbstractText",
    "Organization",
    "ContactPiName",
    "AwardAmount",
    "ProjectStartDate",
    "ProjectEndDate",
    "FiscalYear",
    "AgencyIcAdmin",
    "ActivityCode",
    "AwardNoticeDate",
]

# SBIR/STTR activity codes — the grantee is a small business, not a university.
_COMPANY_ACTIVITY = {"R43", "R44", "R41", "R42", "U43", "U44", "SB1", "UB1", "UT1", "UT2"}


def _s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _search(client: httpx.Client, criteria: dict[str, Any], offset: int) -> tuple[list[dict[str, Any]], int]:
    """One RePORTER page; returns (results, total). Retries 429/5xx AND transient
    network errors (read timeouts, connection resets) — RePORTER drops slow
    connections, which surface as httpx exceptions, not status codes."""
    body = {"criteria": criteria, "include_fields": _FIELDS, "offset": offset, "limit": _LIMIT}
    for attempt in range(6):
        try:
            resp = client.post(_API, json=body, headers={"user-agent": settings.scraper_user_agent}, timeout=120.0)
        except httpx.HTTPError as exc:
            if attempt == 5:
                raise
            console.log(f"[yellow]NIH: network error at offset {offset} ({type(exc).__name__}); retrying.[/]")
            time.sleep(min(60.0, 2.0 * (2**attempt)))
            continue
        if resp.status_code in (429, 500, 502, 503, 504):
            time.sleep(2.0 * (attempt + 1))
            continue
        resp.raise_for_status()
        data = resp.json()
        return data.get("results", []), int(data.get("meta", {}).get("total", 0))
    raise RuntimeError(f"RePORTER kept erroring at offset {offset}")


def _windows(client: httpx.Client, since: str, until: str) -> list[tuple[str, str]]:
    """Split [since, until] into award_notice_date windows each under the
    offset cap, by recursive bisection on the date range."""
    from datetime import timedelta

    out: list[tuple[str, str]] = []

    def visit(lo: date, hi: date) -> None:
        criteria = _criteria(lo.isoformat(), hi.isoformat())
        _, total = _search(client, criteria, 0)
        if total == 0:
            return
        if total <= _MAX_OFFSET or lo == hi:
            if total > _MAX_OFFSET:
                console.log(f"[yellow]NIH: single day {lo} has {total} rows; tail beyond {_MAX_OFFSET} skipped.[/]")
            out.append((lo.isoformat(), hi.isoformat()))
            return
        mid = lo + timedelta(days=(hi - lo).days // 2)
        visit(lo, mid)
        visit(mid + timedelta(days=1), hi)

    visit(date.fromisoformat(since), date.fromisoformat(until))
    return out


def _criteria(from_date: str, to_date: str) -> dict[str, Any]:
    return {
        "award_notice_date": {"from_date": from_date, "to_date": to_date},
        "exclude_subprojects": True,
        "org_countries": ["United States"],
    }


def ingest_api(*, since: str, until: str | None = None, limit: int | None = None) -> tuple[int, int]:
    """Ingest NIH projects whose award notice falls in `since`..`until` (ISO
    dates; `until` defaults to today). Returns (orgs_seen, grants_inserted)."""
    program_id = db.ensure_program_id("NIH", name="NIH Research Projects", agency="NIH")

    seen_companies: set[str] = set()
    grants_inserted = 0

    def flush(records: list[dict[str, Any]]) -> int:
        prepared: list[dict[str, Any]] = []
        company_payload: list[dict[str, Any]] = []
        for rec in records:
            org = rec.get("organization") or {}
            org_name = _s(org.get("org_name"))
            award_id = _s(rec.get("core_project_num")) or _s(rec.get("project_num"))
            if not org_name or not award_id:
                continue
            normalized = normalize_org_name(org_name)
            if not normalized:
                continue
            activity = _s(rec.get("activity_code"))
            org_type = "company" if activity in _COMPANY_ACTIVITY else "university"
            ic = rec.get("agency_ic_admin") or {}
            program = " ".join(p for p in (_s(ic.get("abbreviation")), activity) if p)
            raw = dict(rec)
            raw["_funder"] = "NIH"
            raw["_pi"] = _s(rec.get("contact_pi_name")).title()
            raw["_program"] = program
            raw["_trainee"] = activity[:1] in ("F", "T")
            company_payload.append(
                {
                    "display_name": org_name.title(),
                    "normalized_name": normalized,
                    "org_type": org_type,
                    "city": _s(org.get("org_city")).title() or None,
                    "province": _s(org.get("org_state")) or None,
                }
            )
            prepared.append(
                {
                    "raw": raw,
                    "normalized": normalized,
                    "org_type": org_type,
                    "award_id": award_id,
                    "title": _s(rec.get("project_title")) or None,
                    "description": _s(rec.get("abstract_text")) or None,
                    "amount": rec.get("award_amount"),
                    "start_date": _s(rec.get("project_start_date"))[:10] or None,
                    "end_date": _s(rec.get("project_end_date"))[:10] or None,
                    "fiscal_year": _s(rec.get("fiscal_year")) or None,
                }
            )
        if not prepared:
            return 0

        company_map = db.bulk_upsert_companies(company_payload)
        seen_companies.update(company_map.values())

        grant_payload: list[dict[str, Any]] = []
        for p in prepared:
            cid = company_map.get((p["normalized"], p["org_type"]))
            if not cid:
                continue
            p["company_id"] = cid
            grant_payload.append(
                {
                    "program_id": program_id,
                    "recipient_id": cid,
                    "title": p["title"],
                    "description": p["description"],
                    "amount_cad": p["amount"],
                    "start_date": p["start_date"],
                    "end_date": p["end_date"],
                    "fiscal_year": p["fiscal_year"],
                    "award_id": p["award_id"],
                    "raw": p["raw"],
                }
            )
        grant_map = db.bulk_upsert_grants(grant_payload)

        chunk_payload: list[dict[str, Any]] = []
        for p in prepared:
            if "company_id" not in p:
                continue
            gid = grant_map.get((program_id, p["award_id"]))
            if not gid:
                continue
            if p["title"]:
                chunk_payload.append(
                    {"grant_id": gid, "company_id": p["company_id"], "kind": "grant_title", "content": p["title"]}
                )
            if p["description"]:
                chunk_payload.append(
                    {"grant_id": gid, "company_id": p["company_id"], "kind": "grant_description", "content": p["description"][:2000]}
                )
        db.bulk_insert_chunks(chunk_payload, embed=False)
        return len(grant_payload)

    until = until or date.today().isoformat()
    with httpx.Client(http2=False) as client:
        windows = _windows(client, since, until)
        console.log(f"NIH: {len(windows)} date windows to fetch")
        for w_from, w_to in windows:
            criteria = _criteria(w_from, w_to)
            offset = 0
            while True:
                records, total = _search(client, criteria, offset)
                if not records:
                    break
                grants_inserted += flush(records)
                console.log(f"NIH: {w_from}..{w_to} offset {offset}/{total}, {grants_inserted} grants in…")
                if limit is not None and grants_inserted >= limit:
                    return len(seen_companies), grants_inserted
                offset += _LIMIT
                if offset > _MAX_OFFSET or offset >= total:
                    break
                time.sleep(0.4)  # stay friendly with RePORTER's rate limit

    return len(seen_companies), grants_inserted
