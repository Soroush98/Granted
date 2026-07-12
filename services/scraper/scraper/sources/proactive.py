"""Proactive Disclosure of Grants & Contributions ingestion.

Treasury Board publishes a single federal-wide CSV of every disclosed grant /
contribution at:

    https://open.canada.ca/data/dataset/432527ab-7aac-45b5-81d6-7597107a7013

The file is ~2.25 GB. It has an ``owner_org`` column we filter on to pull just
the departments we care about. We map each row → ``funding_programs.code``
via a caller-supplied matcher; unmatched rows land under FEDERAL_OTHER.

Tri-council researcher rows (NSERC/SSHRC — ``recipient_type='P'`` with a
``research_organization_name``) name the individual PI or trainee as the
recipient. Those get academic handling: the university becomes the company,
the person goes into the grant title (and stays in ``raw`` for the web app's
holder extraction), and no description chunk is written — their descriptions
are per-program boilerplate repeated across thousands of rows, which would
poison vector search.
"""

from __future__ import annotations

import csv
from collections.abc import Callable, Iterable
from pathlib import Path
from string import capwords
from typing import Any

from rich.console import Console

from .. import db
from ..normalize import normalize_org_name

console = Console()

# Treasury Board's recipient_type codes (G&C disclosure standard).
# https://open.canada.ca/data/recombinant-published-schema/grants.json
# NOTE: some values don't follow the official labels (P is "Individual or sole
# proprietorships", A is "Indigenous recipients", S is "Academia") — but a
# company's identity is (normalized_name, org_type), so remapping a letter
# would mint duplicates of every already-ingested recipient. Frozen until a
# migration re-keys them. Individual 'P' recipients bypass this map anyway:
# with a research_organization_name they get academic handling; without one
# they're skipped (a bare person name makes a useless company row).
_ORG_TYPE_MAP: dict[str, str] = {
    "F": "company",            # For-profit organizations
    "N": "nonprofit",          # Not-for-profit organizations and charities
    "P": "government",         # (official: Individual or sole proprietorships)
    "A": "research_institute", # (official: Indigenous recipients)
    "S": "other",              # (official: Academia)
    "I": "other",              # International (non-government)
    "O": "other",              # Other
    "G": "government",         # Government
}


def _row_org_name(row: dict[str, str]) -> str:
    # Operating name (trade name) is usually more recognizable when present;
    # fall back to legal name otherwise.
    return (row.get("recipient_operating_name") or row.get("recipient_legal_name") or "").strip()


def _is_academic_row(row: dict[str, str]) -> bool:
    """An individual researcher at a named institution (tri-council pattern)."""
    return (
        (row.get("recipient_type") or "").strip() == "P"
        and bool((row.get("research_organization_name") or "").strip())
    )


def _flip_name(name: str) -> str:
    """'Williams-Jones, Anthony' → 'Anthony Williams-Jones' for display."""
    last, sep, first = name.partition(",")
    if not sep or not first.strip():
        return name.strip()
    return f"{first.strip()} {last.strip()}"


def _clean_city(value: str | None) -> str | None:
    # Some departments (NSERC) shout city names ("MONTREAL"); capwords keeps
    # apostrophes intact ("ST. JOHN'S" → "St. John's"). Mixed-case values
    # pass through untouched.
    v = (value or "").strip()
    if not v:
        return None
    return capwords(v) if v.isupper() else v


def _row_amount(row: dict[str, str]) -> float | None:
    raw = (row.get("agreement_value") or "").replace(",", "").replace("$", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _row_date(value: str | None) -> str | None:
    v = (value or "").strip()
    return v or None


def _detect_encoding(path: Path) -> str:
    with path.open("rb") as fh:
        return "utf-8-sig" if fh.read(3) == b"\xef\xbb\xbf" else "cp1252"


def ingest_csv(
    path: Path,
    *,
    owner_org: str | None = None,
    program_matcher: Callable[[dict[str, str]], str | None] | None = None,
    date_cutoff: str | None = None,
    recipient_types: set[str] | None = None,
    skip_owner_orgs: set[str] | None = None,
    limit: int | None = None,
    start_row: int = 0,
) -> tuple[int, int]:
    """Stream the Proactive Disclosure CSV into the DB.

    Filters:
      * ``owner_org`` — if set, keep only rows for that department slug;
        if None, accept any department.
      * ``program_matcher`` — callable(row) -> code or None. If returns
        None we keep the row anyway and bucket it under 'FEDERAL_OTHER'.
        If the param is None, every row maps to 'FEDERAL_OTHER'.
      * ``date_cutoff`` — ISO date string; keep rows whose start or amendment
        date is >= this. Used for "last N years" passes.
      * ``recipient_types`` — set of single-letter recipient_type codes to keep
        (e.g. {'F','A'} for companies + academic). None = keep all.
      * ``skip_owner_orgs`` — department slugs to drop entirely (e.g.
        'cihr-irsc', whose grants come in richer form from the dedicated
        CIHR XLSX ingester).

    Individual recipients (type 'P') with no ``research_organization_name``
    are always skipped — a bare person name makes a useless company row.

    Returns (companies_seen, grants_inserted)."""
    program_id_cache: dict[str, str] = {}
    seen_company_ids: set[str] = set()
    grants_inserted = 0
    batch: list[dict[str, str]] = []
    scanned = 0
    matched = 0

    def flush(rows: list[dict[str, str]]) -> int:
        prepared: list[dict[str, Any]] = []
        company_payload: list[dict[str, Any]] = []
        for row in rows:
            academic = _is_academic_row(row)
            if academic:
                # The recipient is a person; the university is the entity we
                # track. org_type 'university' merges with the institutions
                # already in the corpus from the other academic sources.
                org_name = (row.get("research_organization_name") or "").strip()
                org_type = "university"
            else:
                org_name = _row_org_name(row)
                org_type = _ORG_TYPE_MAP.get((row.get("recipient_type") or "").strip(), "other")
            if not org_name:
                continue
            normalized = normalize_org_name(org_name)
            if not normalized:
                continue
            program_code = program_matcher(row) if program_matcher else None
            if not program_code:
                program_code = "FEDERAL_OTHER"
            if program_code not in program_id_cache:
                program_id_cache[program_code] = db.get_program_id(program_code)
            ref = (row.get("ref_number") or "").strip()
            if not ref:
                continue
            title = (row.get("agreement_title_en") or "").strip() or None
            description = (row.get("description_en") or "").strip() or None
            if academic:
                # Tri-council titles are program labels ("Alliance Grants"),
                # not project titles — fold in the person and institution so
                # each grant's title (and its embedded chunk) is distinct and
                # searchable by researcher name.
                holder = _flip_name((row.get("recipient_legal_name") or "").strip())
                title = f"{title or (row.get('prog_name_en') or '').strip()} — {holder}, {org_name}"
            company_payload.append(
                {
                    "display_name": org_name,
                    "normalized_name": normalized,
                    "org_type": org_type,
                    "province": (row.get("recipient_province") or "").strip() or None,
                    "city": _clean_city(row.get("recipient_city")),
                }
            )
            prepared.append(
                {
                    "row": row,
                    "normalized": normalized,
                    "org_type": org_type,
                    "program_id": program_id_cache[program_code],
                    "award_id": ref,
                    "title": title,
                    "description": description,
                    # Academic descriptions are per-program boilerplate; keep
                    # them on the grant row but don't embed them.
                    "skip_desc_chunk": academic,
                }
            )
        if not prepared:
            return 0

        company_map = db.bulk_upsert_companies(company_payload)
        seen_company_ids.update(company_map.values())

        grant_payload: list[dict[str, Any]] = []
        for p in prepared:
            cid = company_map.get((p["normalized"], p["org_type"]))
            if not cid:
                continue
            p["company_id"] = cid
            grant_payload.append(
                {
                    "program_id": p["program_id"],
                    "recipient_id": cid,
                    "title": p["title"],
                    "description": p["description"],
                    "amount_cad": _row_amount(p["row"]),
                    "start_date": _row_date(p["row"].get("agreement_start_date")),
                    "end_date": _row_date(p["row"].get("agreement_end_date")),
                    "award_id": p["award_id"],
                    "raw": p["row"],
                }
            )
        grant_map = db.bulk_upsert_grants(grant_payload)

        chunk_payload: list[dict[str, Any]] = []
        for p in prepared:
            if "company_id" not in p:
                continue
            gid = grant_map.get((p["program_id"], p["award_id"]))
            if not gid:
                continue
            if p["title"]:
                chunk_payload.append(
                    {
                        "grant_id": gid,
                        "company_id": p["company_id"],
                        "kind": "grant_title",
                        "content": p["title"],
                    }
                )
            if p["description"] and not p["skip_desc_chunk"]:
                chunk_payload.append(
                    {
                        "grant_id": gid,
                        "company_id": p["company_id"],
                        "kind": "grant_description",
                        "content": p["description"][:2000],
                    }
                )
        db.bulk_insert_chunks(chunk_payload)
        return len(grant_payload)

    label = owner_org or "all-federal"
    encoding = _detect_encoding(path)
    with path.open(newline="", encoding=encoding) as fh:
        reader = csv.DictReader(fh)
        # Fast-skip past start_row without doing any filtering work.
        if start_row > 0:
            for skipped, _ in enumerate(reader, 1):
                if skipped >= start_row:
                    break
            scanned = start_row
            console.log(f"{label}: skipped to row {start_row:,}")
        for row in _take(reader, limit):
            scanned += 1
            if owner_org and (row.get("owner_org") or "").strip() != owner_org:
                continue
            if skip_owner_orgs and (row.get("owner_org") or "").strip() in skip_owner_orgs:
                continue
            if recipient_types and (row.get("recipient_type") or "").strip() not in recipient_types:
                continue
            if (row.get("recipient_type") or "").strip() == "P" and not _is_academic_row(row):
                continue
            if date_cutoff:
                # Use start_date primarily; fall back to amendment_date when start is blank.
                row_date = (row.get("agreement_start_date") or row.get("amendment_date") or "").strip()
                if row_date < date_cutoff:
                    continue
            matched += 1
            batch.append(row)
            if len(batch) >= 400:
                grants_inserted += flush(batch)
                batch = []
                console.log(
                    f"{label}: scanned {scanned:,}, matched {matched:,}, "
                    f"{grants_inserted:,} grants in…"
                )
        if batch:
            grants_inserted += flush(batch)

    console.log(f"{label}: scanned {scanned:,} total rows, kept {matched:,}")
    return len(seen_company_ids), grants_inserted


def _take(it: Iterable[Any], n: int | None) -> Iterable[Any]:
    if n is None:
        yield from it
        return
    for i, x in enumerate(it):
        if i >= n:
            return
        yield x
