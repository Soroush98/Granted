"""UKRI (UK Research and Innovation) ingestion — via the Gateway to Research API.

One source covers the whole UK: GtR aggregates all seven research councils
(EPSRC, MRC, BBSRC, NERC, ESRC, AHRC, STFC) plus Innovate UK. Research-council
grants land at universities (supervisors / find-a-PI flows); Innovate UK
projects land at companies.

The API is JSON over GET (Accept: application/vnd.rcuk.gtr.json-v7):

    https://gtr.ukri.org/gtr/api/projects?p=<page>&s=100

The project list is NOT date-sorted, so we scan all pages (~175k projects,
~1.8k requests) and keep those whose funding starts inside the window — the
FUND link on each record carries start/end as epoch millis inline, so the date
filter costs nothing. What ISN'T inline for research-council grants:

    PI name ......... rel=PI_PER link → /persons/<id> (firstName/surname)
    org name ........ rel=LEAD_ORG link → /organisations/<id> (heavily repeated
                      across projects, so an id→name cache kills most fetches)
    amount (GBP) .... rel=FUND link → /funds/<id> (valuePounds.amount)

Innovate UK projects instead carry `participantValues` inline (lead participant
name + grantOffer), so they need no extra requests. Detail fetches run on a
small thread pool; a stale id (GtR has some) just degrades that one field.

Studentships (PhD training grants) are skipped: no PI value for the finder
flows and their abstracts are boilerplate. Like ARC/NHMRC/NSF/NIH, country is
keyed off the funder (`UKRI` → United Kingdom); amounts are GBP in `amount_cad`
(the column predates multi-currency). `_funder`/`_pi`/`_program`/`_trainee`
markers go into raw for the web app's holder extraction.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any

import httpx
from rich.console import Console

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

console = Console()

_BASE = "https://gtr.ukri.org/gtr/api"
_PAGE_SIZE = 100
_HEADERS_JSON = {"accept": "application/vnd.rcuk.gtr.json-v7"}
_SKIP_CATEGORIES = {"studentship"}

# GtR rate-limits bursts (429 around a handful of requests/sec sustained), so
# every request — page scans and detail fetches alike, across all worker
# threads — goes through one pacer plus backoff-on-429.
_MIN_INTERVAL = 0.18
_pace_lock = threading.Lock()
_last_request = 0.0


def _pace() -> None:
    global _last_request
    with _pace_lock:
        wait = _last_request + _MIN_INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


def _request(
    client: httpx.Client, url: str, *, params: dict[str, Any] | None = None, attempts: int = 6
) -> httpx.Response | None:
    """Paced GET with 429/5xx backoff. Returns None only for hard 4xx (e.g. a
    stale resource id) or after exhausting retries. GtR's throttle lockouts can
    run minutes, so backoff grows to 5-minute sleeps (capped) on later tries."""
    for attempt in range(attempts):
        _pace()
        try:
            resp = client.get(
                url,
                params=params,
                headers={**_HEADERS_JSON, "user-agent": settings.scraper_user_agent},
                timeout=60.0,
            )
        except httpx.HTTPError:
            time.sleep(min(300.0, 2.0 * (2**attempt)))
            continue
        if resp.status_code == 200:
            return resp
        if resp.status_code == 429 or resp.status_code >= 500:
            retry_after = float(resp.headers.get("retry-after") or 0)
            time.sleep(max(retry_after, min(300.0, 2.0 * (2**attempt))))
            continue
        return None
    return None


def _links(rec: dict[str, Any], rel: str) -> list[dict[str, Any]]:
    return [l for l in (rec.get("links") or {}).get("link", []) if l.get("rel") == rel]


def _fund_start(rec: dict[str, Any]) -> date | None:
    for l in _links(rec, "FUND"):
        if l.get("start"):
            return datetime.fromtimestamp(l["start"] / 1000, tz=timezone.utc).date()
    return None


def _fund_end(rec: dict[str, Any]) -> date | None:
    for l in _links(rec, "FUND"):
        if l.get("end"):
            return datetime.fromtimestamp(l["end"] / 1000, tz=timezone.utc).date()
    return None


def _lead_participant(rec: dict[str, Any]) -> dict[str, Any] | None:
    for p in (rec.get("participantValues") or {}).get("participant") or []:
        if p.get("role") == "LEAD_PARTICIPANT":
            return p
    return None


def _award_id(rec: dict[str, Any]) -> str:
    for ident in (rec.get("identifiers") or {}).get("identifier") or []:
        if ident.get("value"):
            return str(ident["value"])
    return str(rec.get("id") or "")


class _Details:
    """Cached fetchers for the per-project sub-resources."""

    def __init__(self, client: httpx.Client) -> None:
        self.client = client
        self.org_names: dict[str, str | None] = {}

    def _get(self, url: str) -> dict[str, Any] | None:
        # Link hrefs come back as http:// and 301 to https; skip the redirect.
        url = url.replace("http://", "https://", 1)
        resp = _request(self.client, url)
        return resp.json() if resp is not None else None

    def org_name(self, rec: dict[str, Any]) -> str | None:
        links = _links(rec, "LEAD_ORG")
        if not links:
            return None
        url = links[0].get("href") or ""
        if url in self.org_names:
            return self.org_names[url]
        body = self._get(url)
        name = (body or {}).get("name") or None
        self.org_names[url] = name
        return name

    def pi_name(self, rec: dict[str, Any]) -> str | None:
        links = _links(rec, "PI_PER")
        if not links:
            return None
        body = self._get(links[0].get("href") or "")
        if not body:
            return None
        surname = str(body.get("surname") or "").strip().title()
        first = str(body.get("firstName") or "").strip()
        name = ", ".join(p for p in (surname, first) if p)
        return name or None

    def amount(self, rec: dict[str, Any]) -> float | None:
        links = _links(rec, "FUND")
        if not links:
            return None
        body = self._get(links[0].get("href") or "")
        value = ((body or {}).get("valuePounds") or {}).get("amount")
        return float(value) if value is not None else None


def ingest_api(*, since: str, limit: int | None = None, start_page: int = 1) -> tuple[int, int]:
    """Scan the GtR projects list and ingest everything whose funding starts on
    or after `since` (ISO date). `start_page` resumes a crashed scan without
    re-walking already-ingested pages. Returns (orgs_seen, grants_inserted)."""
    program_id = db.ensure_program_id("UKRI", name="UKRI Gateway to Research", agency="UKRI")
    cutoff = date.fromisoformat(since)

    seen_companies: set[str] = set()
    grants_inserted = 0
    scanned = 0

    with httpx.Client(http2=False) as client:
        details = _Details(client)

        def prepare(rec: dict[str, Any]) -> dict[str, Any] | None:
            """Resolve one in-window project's org/PI/amount (network-bound)."""
            category = str(rec.get("grantCategory") or "")
            lead = _lead_participant(rec)
            if lead:  # Innovate UK shape — everything inline
                org_name = str(lead.get("organisationName") or "").strip()
                org_type = "company"
                amount = lead.get("grantOffer")
                pi = details.pi_name(rec)  # usually absent for IUK; fine
            else:
                org_name = details.org_name(rec) or ""
                org_type = "company" if str(rec.get("leadFunder") or "") == "Innovate UK" else "university"
                amount = details.amount(rec)
                pi = details.pi_name(rec)
            if not org_name:
                return None
            normalized = normalize_org_name(org_name)
            award_id = _award_id(rec)
            if not normalized or not award_id:
                return None
            funder = str(rec.get("leadFunder") or "UKRI")
            program = " ".join(p for p in (funder, category) if p)
            start = _fund_start(rec)
            end = _fund_end(rec)
            raw = {k: rec.get(k) for k in ("id", "title", "grantCategory", "leadFunder", "status")}
            raw["_funder"] = "UKRI"
            raw["_pi"] = pi or ""
            raw["_program"] = program
            # Studentships are skipped above and UKRI fellowships are held by
            # independent researchers, so every ingested holder is a PI.
            raw["_trainee"] = False
            return {
                "org_name": org_name,
                "normalized": normalized,
                "org_type": org_type,
                "award_id": award_id,
                "title": str(rec.get("title") or "").strip() or None,
                "description": str(rec.get("abstractText") or "").strip() or None,
                "amount": float(amount) if amount is not None else None,
                "start_date": start.isoformat() if start else None,
                "end_date": end.isoformat() if end else None,
                "raw": raw,
            }

        def flush(prepared: list[dict[str, Any]]) -> int:
            if not prepared:
                return 0
            company_payload = [
                {
                    "display_name": p["org_name"],
                    "normalized_name": p["normalized"],
                    "org_type": p["org_type"],
                }
                for p in prepared
            ]
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

        page = start_page
        total_pages = start_page
        pool = ThreadPoolExecutor(max_workers=settings.scraper_concurrency)
        try:
            while page <= total_pages:
                resp = _request(client, f"{_BASE}/projects", params={"p": page, "s": _PAGE_SIZE}, attempts=10)
                if resp is None:
                    # Skipping a page would silently drop up to 100 projects.
                    raise RuntimeError(f"GtR projects page {page} kept failing")
                body = resp.json()
                total_pages = int(body.get("totalPages") or 1)
                records = body.get("project") or []
                scanned += len(records)

                in_window = [
                    r
                    for r in records
                    if str(r.get("grantCategory") or "").lower() not in _SKIP_CATEGORIES
                    and (s := _fund_start(r)) is not None
                    and s >= cutoff
                ]
                prepared = [p for p in pool.map(prepare, in_window) if p]
                grants_inserted += flush(prepared)
                console.log(
                    f"UKRI: page {page}/{total_pages}, scanned {scanned}, {grants_inserted} grants in…"
                )
                if limit is not None and grants_inserted >= limit:
                    break
                page += 1
        finally:
            pool.shutdown(wait=False)

    return len(seen_companies), grants_inserted
