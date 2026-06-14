"""GrantConnect (grants.gov.au) ingestion — Australian federal grant awards.

This is the AU counterpart of Canada's federal Proactive Disclosure: every
Australian Government agency publishes its Grant Award (GA) notices here. Crucially
it's the only AU source that funds *companies* — ARC and NHMRC (our existing AU
sources) fund university research only, so without GrantConnect the /jobs finder
has zero Australian company coverage.

Access notes:
  - The site UA-blocks non-browser clients (403), so we send a browser UA.
  - Listing is server-rendered HTML at /Ga/ViewByPublishDate. The `Weekly` param
    is really a publish-date BETWEEN filter that accepts ANY "DD-Mon-YYYY,DD-Mon-YYYY"
    range (not just whole weeks), 15 results/page, paginated with `&page=N`.
  - Each result <article> carries everything we need — title, GA ID, recipient,
    value, grant term, agency, category — so no per-grant detail fetch is needed.

Recipient mix: GrantConnect funds businesses, non-profits, universities, and
individuals across all of government, so it's broad and includes non-R&D grants
(community/arts/health-service). We tag obvious universities as `university` (so
they flow to /supervisors) and everything else as `company`; the spike search
filters to topically-relevant recipients downstream, same as the Canadian
federal source. Country is keyed off the funder code `GRANTCONNECT` → Australia.
Amounts are AUD in `amount_cad` (the column predates multi-currency).
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

import httpx
from rich.console import Console
from selectolax.parser import HTMLParser

from .. import db
from ..normalize import normalize_org_name

console = Console()

_BASE = "https://www.grants.gov.au"
_LIST = f"{_BASE}/Ga/ViewByPublishDate"
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
# A grant going to a university/institute is research, not a job target — tag it
# so it flows to /supervisors instead of /jobs.
_UNIVERSITY_RE = re.compile(r"\buniversit|institute of technology\b", re.IGNORECASE)

# GrantConnect is all-of-government and ~95% social/subsidy grants (Child Care,
# Aged Care, community programs) that aren't R&D employers. The targeted filter
# keeps only grants that look like industry/innovation/R&D — by funding agency
# (the R&D-relevant departments) OR by R&D terms in the category/title. This is
# the AU analog of ingesting only IRAP/SIF on the Canadian side, not every grant.
_RD_AGENCY_RE = re.compile(
    r"industry|science|resources|climate|\benergy\b|renewable|csiro|"
    r"commonwealth scientific|defence|innovation",
    re.IGNORECASE,
)
_RD_TOPIC_RE = re.compile(
    r"research|innovation|\bscience\b|technolog|manufactur|commercial|biotech|"
    r"\benergy\b|renewable|semiconductor|quantum|space|engineering|\br&d\b|"
    r"clean tech|cleantech|startup|medical research",
    re.IGNORECASE,
)


# Consumer/business handout programs that match the R&D terms (e.g. EV-charger
# rebates tagged "Climate Change") but aren't R&D projects — exclude them.
_EXCLUDE_RE = re.compile(r"\brebate|\bvoucher|\bsubsid|cashback|concession", re.IGNORECASE)


def _is_rd(agency: str, category: str, title: str) -> bool:
    """True if the grant looks like industry/innovation/R&D (keep it), per the
    targeted filter. Agency match is the strong signal; category/title catches
    R&D grants run by otherwise-unrelated departments. Handout programs
    (rebates/vouchers/subsidies) are excluded even if they match."""
    blob = f"{category} {title}"
    if _EXCLUDE_RE.search(blob):
        return False
    if _RD_AGENCY_RE.search(agency or ""):
        return True
    return bool(_RD_TOPIC_RE.search(blob))


# Firm per-phase timeouts so a half-open connection can never hang a worker
# thread indefinitely (a single hung request blocks the whole wave's pool.map).
_TIMEOUT = httpx.Timeout(connect=15.0, read=45.0, write=15.0, pool=20.0)
_LIMITS = httpx.Limits(max_connections=12, max_keepalive_connections=4)
# GrantConnect throttles each connection (~13s/page) but allows parallelism, so
# throughput scales with worker count up to its concurrency cap. 8 workers gave
# no 429s in testing; firm timeouts (above) prevent any one hung request from
# blocking a wave.
_WORKERS = 8


def _request(client: httpx.Client, url: str, params: dict[str, Any]) -> httpx.Response | None:
    """Paced GET with backoff. Returns None after exhausting retries."""
    for attempt in range(5):
        try:
            resp = client.get(url, params=params, headers={"user-agent": _UA}, timeout=_TIMEOUT)
        except httpx.HTTPError:
            time.sleep(min(30.0, 2.0 * (2**attempt)))
            continue
        if resp.status_code == 200:
            return resp
        if resp.status_code == 429 or resp.status_code >= 500:
            time.sleep(min(60.0, 2.0 * (2**attempt)))
            continue
        return None
    return None


def _field(article: Any, label: str) -> str:
    """Read a '<div class=list-desc><span>Label:</span><div class=list-desc-inner>
    value</div></div>' pair by its label text."""
    for d in article.css("div.list-desc"):
        span = d.css_first("span")
        if span and span.text(strip=True).rstrip(":").strip().lower() == label.lower():
            inner = d.css_first("div.list-desc-inner")
            if inner:
                return inner.text(separator=" ", strip=True)
    return ""


def _amount(raw: str) -> float | None:
    raw = raw.replace(",", "").replace("$", "").strip()
    m = re.search(r"\d+(?:\.\d+)?", raw)
    return float(m.group(0)) if m else None


_MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def _iso(d: str) -> str | None:
    """'25-Jun-2026' → '2026-06-25'."""
    m = re.match(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})", d.strip())
    if not m:
        return None
    day, mon, year = m.groups()
    try:
        return f"{year}-{_MONTHS.index(mon.title()) + 1:02d}-{int(day):02d}"
    except ValueError:
        return None


def _term(raw: str) -> tuple[str | None, str | None]:
    """'25-Jun-2026 to 30-Jun-2027' → (start_iso, end_iso)."""
    parts = re.split(r"\s+to\s+", raw, maxsplit=1)
    start = _iso(parts[0]) if parts else None
    end = _iso(parts[1]) if len(parts) > 1 else None
    return start, end


def _parse_page(html: str) -> list[dict[str, Any]]:
    tree = HTMLParser(html)
    out: list[dict[str, Any]] = []
    for art in tree.css("article"):
        row = art.css_first("div.row")
        guid = row.attributes.get("id") if row else None
        ga_id = _field(art, "GA ID")
        if not ga_id:
            continue
        title_el = art.css_first("p.font20")
        title = title_el.text(separator=" ", strip=True) if title_el else ""
        recipient = _field(art, "Recipient Name")
        if not recipient:
            continue
        start, end = _term(_field(art, "Grant Term"))
        out.append(
            {
                "award_id": ga_id,
                "guid": guid,
                "title": title or None,
                "recipient": recipient,
                "agency": _field(art, "Agency"),
                "category": _field(art, "Category"),
                "amount": _amount(_field(art, "Value (AUD)")),
                "start_date": start,
                "end_date": end,
                "publish_date": _iso(_field(art, "Publish Date")),
            }
        )
    return out


def ingest_recent(
    *, since: str, until: str | None = None, limit: int | None = None, targeted: bool = True
) -> tuple[int, int]:
    """Ingest GA notices with publish date in ``since``..``until`` (ISO dates;
    ``until`` defaults to today). When ``targeted`` (default), keeps only
    industry/innovation/R&D grants (see _is_rd); pass targeted=False to ingest
    the full all-of-government feed. Returns (recipients_seen, grants_inserted)."""
    program_id = db.ensure_program_id(
        "GRANTCONNECT",
        name="GrantConnect (Australian Government grants)",
        agency="GrantConnect",
    )
    lo = date.fromisoformat(since)
    hi = date.fromisoformat(until) if until else date.today()

    seen_companies: set[str] = set()
    grants_inserted = 0

    def flush(recs: list[dict[str, Any]]) -> int:
        company_payload: list[dict[str, Any]] = []
        prepared: list[dict[str, Any]] = []
        for r in recs:
            normalized = normalize_org_name(r["recipient"])
            if not normalized:
                continue
            org_type = "university" if _UNIVERSITY_RE.search(r["recipient"]) else "company"
            raw = dict(r)
            raw["_funder"] = "GRANTCONNECT"
            # A short description for retrieval: the funded activity plus its
            # category (the activity line is GrantConnect's one-sentence summary).
            desc_parts = [r["title"] or "", f"Category: {r['category']}" if r["category"] else ""]
            description = "\n".join(p for p in desc_parts if p) or None
            company_payload.append(
                {"display_name": r["recipient"], "normalized_name": normalized, "org_type": org_type}
            )
            prepared.append({**r, "normalized": normalized, "org_type": org_type, "raw": raw, "description": description})
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
                    "fiscal_year": (p["start_date"] or p["publish_date"] or "")[:4] or None,
                    "award_id": p["award_id"],
                    "raw": p["raw"],
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
        db.bulk_insert_chunks(chunk_payload, embed=False)
        return len(grant_payload)

    # Fetch is the bottleneck: GrantConnect serves ~4s/page, and a single wide
    # date range forces slow deep offset-pagination (~10s/page). So we split
    # into monthly windows (shallow pagination, ~4s/page) and fetch each
    # window's pages CONCURRENTLY in waves. Kept records (R&D is sparse) are
    # buffered and flushed to the DB in batches to avoid per-page round-trips.
    windows = _month_windows(lo, hi)
    console.log(f"GrantConnect: {len(windows)} monthly windows to scan")
    _FLUSH_AT = 150
    scanned = 0
    buffer: list[dict[str, Any]] = []

    with httpx.Client(http2=False, limits=_LIMITS, timeout=_TIMEOUT) as client:
        pool = ThreadPoolExecutor(max_workers=_WORKERS)
        try:
            for w_start, w_end in windows:
                rng = f"{_fmt(w_start)},{_fmt(w_end)}"
                page = 1
                while True:
                    wave = list(range(page, page + _WORKERS))
                    results = list(pool.map(lambda p: _fetch_records(client, rng, p), wave))
                    # Stop only when an ENTIRE wave is empty — tolerates the
                    # occasional spurious blank page mid-window.
                    if all(r is None for r in results):
                        break
                    # Runaway guard: a month is ~100 pages; if end-detection
                    # ever fails (site clamping), don't loop forever.
                    if page > 400:
                        console.log(f"[yellow]GrantConnect: {rng} hit page cap 400 — moving on.[/]")
                        break
                    for recs in results:
                        if recs is None:
                            continue
                        scanned += len(recs)
                        if targeted:
                            recs = [r for r in recs if _is_rd(r["agency"], r["category"], r["title"] or "")]
                        buffer.extend(recs)
                    if len(buffer) >= _FLUSH_AT:
                        grants_inserted += flush(buffer)
                        buffer = []
                    page += _WORKERS
                console.log(f"GrantConnect: {rng} done, scanned {scanned}, {grants_inserted} kept so far…")
                if limit is not None and grants_inserted + len(buffer) >= limit:
                    break
        finally:
            pool.shutdown(wait=False)
        if buffer:
            grants_inserted += flush(buffer)

    console.log(f"GrantConnect: done — scanned {scanned}, {grants_inserted} kept")
    return len(seen_companies), grants_inserted


def _fmt(d: date) -> str:
    return f"{d.day}-{_MONTHS[d.month - 1]}-{d.year}"


def _month_windows(lo: date, hi: date) -> list[tuple[date, date]]:
    """Split [lo, hi] into calendar-month windows (shallow pagination each)."""
    out: list[tuple[date, date]] = []
    cur = lo
    while cur <= hi:
        # last day of cur's month
        if cur.month == 12:
            nxt = date(cur.year + 1, 1, 1)
        else:
            nxt = date(cur.year, cur.month + 1, 1)
        end = min(nxt - timedelta(days=1), hi)
        out.append((cur, end))
        cur = nxt
    return out


def _fetch_records(client: httpx.Client, rng: str, page: int) -> list[dict[str, Any]] | None:
    """Fetch+parse one page; None signals a blank/end page."""
    resp = _request(client, _LIST, {"Weekly": rng, "page": page})
    if resp is None:
        return None
    recs = _parse_page(resp.text)
    return recs or None
