"""Fonds de recherche du Québec (FRQ) ingestion.

FRQ publishes a per-fiscal-year CSV per sub-agency on donneesquebec.ca:
  * FRQS  — Santé  (health)
  * FRQNT — Nature et technologies
  * FRQSC — Société et culture

Each file has the same column layout. Headers are in French. The CSV has one
row per recipient × programme × fiscal year — the recipient is a researcher
(`Titulaire`) hosted at an institution (`etablissement`). We treat the
institution as the company and ignore the researcher name; the academic name
is what matters for matching to a workplace.

Note: published with a ~1 year lag — the 2023-2024 file (April 2023 → March
2024) is the most recent as of mid-2026.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from rich.console import Console

from .. import db
from ..normalize import normalize_org_name

console = Console()


# Map FRQ Type_de_Recipiendaire → companies.org_type.
# Most rows are "Titulaire" (researcher at a university); a few are
# "Établissement" (institution-led). All treated as university for our purposes
# because FRQ funds are routed through Quebec universities and hospitals.
_DEFAULT_ORG_TYPE = "university"


def _fy_start_date(fy: str) -> str | None:
    """'2023-2024' → '2023-04-01' (Quebec/Canadian fiscal year start).
    Returns None for malformed input rather than raising."""
    fy = (fy or "").strip()
    if len(fy) >= 4 and fy[:4].isdigit():
        return f"{fy[:4]}-04-01"
    return None


def _fy_end_date(fy: str) -> str | None:
    fy = (fy or "").strip()
    if len(fy) >= 4 and fy[:4].isdigit():
        try:
            return f"{int(fy[:4]) + 1}-03-31"
        except ValueError:
            return None
    return None


def _row_amount(row: dict[str, str]) -> float | None:
    raw = (row.get("Montant_total") or row.get("Montant_recherche") or "").replace(",", ".").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _col(row: dict[str, str], *names: str) -> str:
    """Pick the first non-empty value across alternate column names. FRQSC
    capitalizes some headers differently (`Etablissement`, `_Domaines_de_recherche_`)
    than FRQS/FRQNT (`etablissement`, `Domaines_de_recherche`)."""
    for n in names:
        v = (row.get(n) or "").strip()
        if v:
            return v
    return ""


def _row_description(row: dict[str, str]) -> str | None:
    """Synthesize a search-friendly description from the structured columns.
    The CSV has no free-text abstract, so we stitch the topic/keyword fields
    together — that's what'll get embedded for retrieval."""
    parts: list[str] = []
    fields: list[tuple[str, tuple[str, ...]]] = [
        ("Volet", ("Programme_-_volet",)),
        ("Domaine", ("Domaines_de_recherche", "_Domaines_de_recherche_")),
        ("Objet", ("Objet_de_recherche_1",)),
        ("Objet", ("Objet_de_recherche_2",)),
        ("Application", ("Champs_d_application_1",)),
        ("Application", ("Champs_d_application_2",)),
        ("Mots-clés", ("Mots_cles",)),
    ]
    for label, names in fields:
        v = _col(row, *names)
        if v:
            parts.append(f"{label}: {v}")
    return "; ".join(parts) or None


def ingest_csv(path: Path, *, program_code: str) -> tuple[int, int]:
    """Stream a single FRQ fiscal-year CSV into the DB.

    ``program_code`` is one of FRQS / FRQNT / FRQSC and is used to look up the
    funding_programs row. The CSV's ``Fonds`` column is informational only.
    Returns (companies_seen, grants_inserted)."""
    program_id = db.get_program_id(program_code)
    seen_companies: set[str] = set()
    grants_inserted = 0
    batch: list[dict[str, str]] = []

    def flush(rows: list[dict[str, str]]) -> int:
        company_payload: list[dict[str, Any]] = []
        prepared: list[dict[str, Any]] = []
        for row in rows:
            org_name = _col(row, "etablissement", "Etablissement")
            if not org_name:
                continue
            normalized = normalize_org_name(org_name)
            if not normalized:
                continue
            dossier = (row.get("Dossier") or "").strip()
            if not dossier:
                continue
            # Make award_id unique per (dossier, fiscal_year) — a multi-year
            # grant gets one row per FY and we want each to be retained.
            fy = (row.get("Annee_financiere") or "").strip()
            award_id = f"{dossier}-{fy}" if fy else dossier
            company_payload.append({
                "display_name": org_name,
                "normalized_name": normalized,
                "org_type": _DEFAULT_ORG_TYPE,
                "province": (row.get("Province_etablissement") or "").strip() or "Québec",
            })
            prepared.append({
                "row": row,
                "normalized": normalized,
                "award_id": award_id,
                "fy": fy,
                "title": (row.get("Programme") or "").strip() or None,
                "description": _row_description(row),
            })
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
            grant_payload.append({
                "program_id": program_id,
                "recipient_id": cid,
                "title": p["title"],
                "description": p["description"],
                "amount_cad": _row_amount(p["row"]),
                "start_date": _fy_start_date(p["fy"]),
                "end_date": _fy_end_date(p["fy"]),
                "fiscal_year": p["fy"] or None,
                "award_id": p["award_id"],
                "raw": p["row"],
            })
        grant_map = db.bulk_upsert_grants(grant_payload)

        chunk_payload: list[dict[str, Any]] = []
        for p in prepared:
            if "company_id" not in p:
                continue
            gid = grant_map.get((program_id, p["award_id"]))
            if not gid:
                continue
            if p["title"]:
                chunk_payload.append({
                    "grant_id": gid,
                    "company_id": p["company_id"],
                    "kind": "grant_title",
                    "content": p["title"],
                })
            if p["description"]:
                chunk_payload.append({
                    "grant_id": gid,
                    "company_id": p["company_id"],
                    "kind": "grant_description",
                    "content": p["description"][:2000],
                })
        # Match the NSERC pattern — embed-pending handles vectors later in
        # small batches so HNSW maintenance doesn't trip statement timeouts.
        db.bulk_insert_chunks(chunk_payload, embed=False)
        return len(grant_payload)

    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            batch.append(row)
            if len(batch) >= 400:
                grants_inserted += flush(batch)
                batch = []
                console.log(f"FRQ {program_code}: {grants_inserted} grants so far…")
        if batch:
            grants_inserted += flush(batch)

    return len(seen_companies), grants_inserted
