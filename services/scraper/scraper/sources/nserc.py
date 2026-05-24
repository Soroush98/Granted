"""NSERC awards ingestion.

The Government of Canada publishes the NSERC awards dataset on the Open Data
portal: https://open.canada.ca/data/en/dataset/c1b0f627-8c29-427c-ab73-33968ad9176e

Each year is a separate CSV. Download them once locally (or wire up your own
mirror) and pass the path to `ingest_csv`. The schema has been stable since
~2018; the columns we read are:

    Application ID, Competition Year, Fiscal Year, Funding Program,
    Application Title, Award Amount, Application Status,
    Organization, Department, Researcher Name

Many institutional/program names live in French in the bilingual file; we read
the English column where present and fall back to the French one.

Industry-partnered streams (Alliance, CRD, Engage) are the most useful ones for
job-hunter discovery — they imply a real industry collaborator. We tag those
with the right program code; everything else falls under NSERC_OTHER.
"""

from __future__ import annotations

import csv
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from rich.console import Console

from .. import db
from ..normalize import normalize_org_name

console = Console()


# Crude mapping from NSERC "Funding Program" labels we've seen in the open data
# CSVs → our funding_programs.code. Anything unknown falls through to NSERC_OTHER.
_PROGRAM_MAP: dict[str, str] = {
    "Discovery Grants Program": "NSERC_DG",
    "Discovery Grants Program - Individual": "NSERC_DG",
    "Discovery Grants - Individual": "NSERC_DG",
    "Discovery Grants": "NSERC_DG",
    "Discovery Launch Supplement": "NSERC_DG",
    "Discovery Grants Program - Accelerator Supplements": "NSERC_DG",
    "Alliance Grants": "NSERC_ALLIANCE",
    "Alliance International Catalyst Grants": "NSERC_ALLIANCE",
    "Alliance Mission Grants": "NSERC_ALLIANCE",
    "Collaborative Research and Development Grants": "NSERC_CRD",
    "Engage Grants Program": "NSERC_CRD",
    "Engage Plus Grants Program": "NSERC_CRD",
    "Applied Research and Development Grants - Level 1": "NSERC_CRD",
    "Applied Research and Development Grants - Level 2": "NSERC_CRD",
}


def _row_program_code(row: dict[str, str]) -> str:
    label = (row.get("ProgramNameEN") or row.get("ProgramNameFR") or "").strip()
    return _PROGRAM_MAP.get(label, "NSERC_OTHER")


def _row_amount(row: dict[str, str]) -> float | None:
    raw = row.get("AwardAmount") or ""
    raw = raw.replace(",", "").replace("$", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _row_org_name(row: dict[str, str]) -> str:
    return (row.get("Institution-Établissement") or "").strip()


def _row_title(row: dict[str, str]) -> str:
    return (row.get("ApplicationTitle") or "").strip()


def _row_award_id(row: dict[str, str]) -> str | None:
    return (row.get("ApplicationID") or "").strip() or None


def _row_fiscal_year(row: dict[str, str]) -> str | None:
    return (row.get("FiscalYear-Exercice financier") or "").strip() or None


def _row_summary(row: dict[str, str]) -> str:
    return (row.get("ApplicationSummary") or "").strip()


def _detect_encoding(path: Path) -> str:
    # FY2020+ Expenditures files are UTF-8 with BOM; older _award files are
    # Windows-1252 (no BOM, with raw 0x82-style bytes for é/ç/etc.).
    with path.open("rb") as fh:
        return "utf-8-sig" if fh.read(3) == b"\xef\xbb\xbf" else "cp1252"


def ingest_csv(path: Path, *, limit: int | None = None) -> tuple[int, int]:
    """Stream a single NSERC awards CSV into the database.

    Returns (companies_created_or_seen, grants_inserted). Skips rows whose award
    status is anything other than 'Awarded'.
    """
    program_id_cache: dict[str, str] = {}
    seen_company_ids: set[str] = set()
    grants_inserted = 0
    batch: list[dict[str, str]] = []
    total_rows = 0

    def flush(rows: list[dict[str, str]]) -> int:
        # Stage 1: build per-row state and accumulate company payload.
        prepared: list[dict[str, Any]] = []
        company_payload: list[dict[str, Any]] = []
        for row in rows:
            status = (row.get("Application Status") or row.get("État de la demande") or "").strip().lower()
            if status not in {"", "awarded", "ongoing", "financé"}:
                continue
            org_name = _row_org_name(row)
            if not org_name:
                continue
            normalized = normalize_org_name(org_name)
            if not normalized:
                continue
            program_code = _row_program_code(row)
            if program_code not in program_id_cache:
                program_id_cache[program_code] = db.get_program_id(program_code)
            award_id = _row_award_id(row)
            if not award_id:
                continue
            company_payload.append(
                {
                    "display_name": org_name,
                    "normalized_name": normalized,
                    "org_type": "university",
                }
            )
            prepared.append(
                {
                    "row": row,
                    "normalized": normalized,
                    "program_id": program_id_cache[program_code],
                    "award_id": award_id,
                    "title": _row_title(row) or None,
                    "summary": _row_summary(row) or None,
                }
            )
        if not prepared:
            return 0

        # Stage 2: bulk-upsert companies, get id map.
        company_map = db.bulk_upsert_companies(company_payload)
        seen_company_ids.update(company_map.values())

        # Stage 3: bulk-upsert grants.
        grant_payload: list[dict[str, Any]] = []
        for p in prepared:
            cid = company_map.get((p["normalized"], "university"))
            if not cid:
                continue
            p["company_id"] = cid
            grant_payload.append(
                {
                    "program_id": p["program_id"],
                    "recipient_id": cid,
                    "title": p["title"],
                    "description": p["summary"],
                    "amount_cad": _row_amount(p["row"]),
                    "fiscal_year": _row_fiscal_year(p["row"]),
                    "award_id": p["award_id"],
                    "raw": p["row"],
                }
            )
        grant_map = db.bulk_upsert_grants(grant_payload)

        # Stage 4: bulk-insert chunks (title + summary).
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
            if p["summary"]:
                chunk_payload.append(
                    {
                        "grant_id": gid,
                        "company_id": p["company_id"],
                        "kind": "grant_description",
                        "content": p["summary"],
                    }
                )
        # Insert without embeddings — the HNSW index makes per-row embed
        # writes slow enough to trip Supabase's statement timeout. embed-pending
        # backfills these later in small RPC batches.
        db.bulk_insert_chunks(chunk_payload, embed=False)
        return len(grant_payload)

    with path.open(newline="", encoding=_detect_encoding(path)) as fh:
        reader = csv.DictReader(fh)
        for row in _take(reader, limit):
            batch.append(row)
            total_rows += 1
            if len(batch) >= 100:
                grants_inserted += flush(batch)
                batch = []
                console.log(f"NSERC: processed {total_rows} rows, {grants_inserted} grants so far…")
        if batch:
            grants_inserted += flush(batch)

    return len(seen_company_ids), grants_inserted


def _take(it: Iterable[Any], n: int | None) -> Iterable[Any]:
    if n is None:
        yield from it
        return
    for i, x in enumerate(it):
        if i >= n:
            return
        yield x
