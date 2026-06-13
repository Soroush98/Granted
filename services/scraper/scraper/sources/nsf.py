"""NSF (U.S. National Science Foundation) ingestion — via the public Awards API.

NSF is the US counterpart of NSERC/ARC: non-medical science and engineering
research grants, plus the SBIR/STTR small-business awards. Adding it brings US
labs into the find-a-PI / supervisors flows; NIH (nih.py) covers US medical
research, mirroring the ARC/NHMRC split for Australia.

The Awards API is a plain JSON GET:
    https://api.nsf.gov/services/v1/awards.json
paginated with `offset` (1-based) and `rpp` (max 25 per page), filterable by
award date (`dateStart`/`dateEnd`, MM/DD/YYYY). Each record carries everything
inline — no follow-up requests needed:

    id ................. award number (our award_id)
    title / abstractText  what the work is
    awardeeName ........ recipient institution (mixed-case variant)
    awardeeCity / awardeeStateCode
    piFirstName / piLastName
    fundProgramName .... e.g. "Algorithmic Foundations", "SBIR Phase II"
    fundsObligatedAmt / estimatedTotalAmt (USD)
    startDate / expDate  MM/DD/YYYY

Like ARC/NHMRC, the corpus keys country off the funder: the web app maps the
`NSF` program code to the United States. Amounts land in `amount_cad` in native
USD (the column predates multi-currency; AUD already does the same). We persist
`_funder`/`_pi`/`_program`/`_trainee` markers in raw so holder extraction never
depends on the source schema.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Any

import httpx
from rich.console import Console

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

console = Console()

_API = "https://api.nsf.gov/services/v1/awards.json"
_RPP = 25  # API max

# The API silently stops serving past ~10k results per query (offset 10000+
# returns empty even when more awards exist in the date range — verified
# 2026-06: a 2-year query died at 9,975 rows mid-2025 while 2026 awards exist).
# So we page within date windows small enough to stay under it, and bisect any
# window that still gets near the cap.
_WINDOW_DAYS = 90
_CAP_GUARD = 9_900

# SBIR/STTR awards go to small businesses; everything else is overwhelmingly
# universities (plus the odd institute, which "university" approximates fine
# for the supervisors/PI flows).
_COMPANY_PROGRAM = ("SBIR", "STTR")
# Awards whose named recipient is a trainee (the fellow), not a lab-leading
# PI — NSF's graduate/postdoc fellowships. Checked against the program name AND
# the title: fellowship programs often hide behind opaque program names
# ("MathSciPDFel") while the title spells it out ("Postdoctoral Fellowship: …").
_TRAINEE_MARKERS = ("GRADUATE RESEARCH FELLOWSHIP", "POSTDOCTORAL FELLOWSHIP")


def _s(rec: dict[str, Any], key: str) -> str:
    v = rec.get(key)
    return "" if v is None else str(v).strip()


def _iso(mdY: str) -> str | None:
    """'01/13/2025' → '2025-01-13'."""
    try:
        return datetime.strptime(mdY, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def _amount(rec: dict[str, Any]) -> float | None:
    raw = _s(rec, "fundsObligatedAmt") or _s(rec, "estimatedTotalAmt")
    raw = raw.replace(",", "").replace("$", "")
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


def _fetch_page(client: httpx.Client, *, offset: int, date_start: str, date_end: str) -> list[dict[str, Any]]:
    """One page of awards, with backoff on the NSF API's frequent read timeouts
    and 5xx blips so a single hiccup doesn't kill a long run."""
    params = {
        "dateStart": date_start,
        "dateEnd": date_end,
        "offset": offset,
        "rpp": _RPP,
        # Ask for the abstract explicitly — the default field set omits it
        # on some deployments; harmless when the API returns everything.
        "printFields": (
            "id,title,abstractText,awardeeName,awardeeCity,awardeeStateCode,"
            "piFirstName,piLastName,fundProgramName,fundsObligatedAmt,"
            "estimatedTotalAmt,startDate,expDate"
        ),
    }
    last_exc: Exception | None = None
    for attempt in range(6):
        try:
            resp = client.get(
                _API, params=params, headers={"user-agent": settings.scraper_user_agent}, timeout=90.0
            )
            if resp.status_code >= 500:
                raise httpx.HTTPStatusError("server error", request=resp.request, response=resp)
            resp.raise_for_status()
            return resp.json().get("response", {}).get("award", [])
        except (httpx.HTTPError, ValueError) as exc:  # ValueError covers bad JSON
            last_exc = exc
            time.sleep(min(60.0, 2.0 * (2**attempt)))
    raise RuntimeError(f"NSF page fetch failed after retries at offset {offset}: {last_exc}")


def ingest_api(*, since: str, until: str | None = None, limit: int | None = None) -> tuple[int, int]:
    """Page through NSF awards dated `since`..`until` (ISO dates; `until`
    defaults to today). Returns (institutions_seen, grants_inserted)."""
    program_id = db.ensure_program_id("NSF", name="NSF Awards", agency="NSF")
    range_start = date.fromisoformat(since)
    range_end = date.fromisoformat(until) if until else date.today()

    seen_companies: set[str] = set()
    grants_inserted = 0

    def flush(records: list[dict[str, Any]]) -> int:
        prepared: list[dict[str, Any]] = []
        company_payload: list[dict[str, Any]] = []
        for rec in records:
            org_name = _s(rec, "awardeeName") or _s(rec, "awardee")
            award_id = _s(rec, "id")
            if not org_name or not award_id:
                continue
            normalized = normalize_org_name(org_name)
            if not normalized:
                continue
            program = _s(rec, "fundProgramName")
            prog_upper = program.upper()
            haystack = f"{prog_upper} {_s(rec, 'title').upper()}"
            org_type = "company" if any(t in prog_upper for t in _COMPANY_PROGRAM) else "university"
            pi = ", ".join(p for p in (_s(rec, "piLastName"), _s(rec, "piFirstName")) if p)
            raw = dict(rec)
            raw["_funder"] = "NSF"
            raw["_pi"] = pi
            raw["_program"] = program
            raw["_trainee"] = any(t in haystack for t in _TRAINEE_MARKERS)
            company_payload.append(
                {
                    "display_name": org_name,
                    "normalized_name": normalized,
                    "org_type": org_type,
                    "city": _s(rec, "awardeeCity").title() or None,
                    "province": _s(rec, "awardeeStateCode") or None,
                }
            )
            prepared.append(
                {
                    "raw": raw,
                    "normalized": normalized,
                    "org_type": org_type,
                    "award_id": award_id,
                    "title": _s(rec, "title") or None,
                    "description": _s(rec, "abstractText") or None,
                    "amount": _amount(rec),
                    "start_date": _iso(_s(rec, "startDate")),
                    "end_date": _iso(_s(rec, "expDate")),
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
                    "fiscal_year": (p["start_date"] or "")[:4] or None,
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

    # Oldest-first stack of date windows; a window that nears the result cap
    # gets split and both halves requeued (re-fetching its first pages is
    # wasteful but harmless — upserts are idempotent).
    windows: list[tuple[date, date]] = []
    w_lo = range_start
    while w_lo <= range_end:
        w_hi = min(w_lo + timedelta(days=_WINDOW_DAYS - 1), range_end)
        windows.append((w_lo, w_hi))
        w_lo = w_hi + timedelta(days=1)
    windows.reverse()

    with httpx.Client(http2=False) as client:
        while windows:
            lo, hi = windows.pop()
            date_start, date_end = lo.strftime("%m/%d/%Y"), hi.strftime("%m/%d/%Y")
            offset = 1
            fetched = 0
            while True:
                records = _fetch_page(client, offset=offset, date_start=date_start, date_end=date_end)
                if not records:
                    break
                fetched += len(records)
                grants_inserted += flush(records)
                console.log(f"NSF: {lo}..{hi} offset {offset}, {grants_inserted} grants in…")
                if limit is not None and grants_inserted >= limit:
                    return len(seen_companies), grants_inserted
                if len(records) < _RPP:
                    break
                if fetched >= _CAP_GUARD and lo < hi:
                    mid = lo + timedelta(days=(hi - lo).days // 2)
                    console.log(f"[yellow]NSF: window {lo}..{hi} near the 10k cap — splitting.[/]")
                    windows += [(mid + timedelta(days=1), hi), (lo, mid)]
                    break
                offset += _RPP

    return len(seen_companies), grants_inserted
