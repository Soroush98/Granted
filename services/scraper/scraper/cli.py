"""CLI entrypoints — `granted-scraper <command>`."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import typer
from rich.console import Console

from . import db, voyage
from .config import settings
from .sources import abinnovates, arc, cfi, cihr, era, frq, nhmrc, nih, nserc, nsf, proactive, scaleai, ukri

app = typer.Typer(add_completion=False)
console = Console()


@app.command("ingest-nserc")
def ingest_nserc(
    csv_path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    limit: int | None = typer.Option(None, help="Cap rows ingested (useful for smoke tests)."),
) -> None:
    """Ingest a single NSERC awards CSV file. Download yours from
    https://open.canada.ca/data/en/dataset/c1b0f627-8c29-427c-ab73-33968ad9176e first."""
    companies, grants = nserc.ingest_csv(csv_path, limit=limit)
    console.log(f"[bold green]NSERC:[/] {grants} grants, {companies} unique recipients")


@app.command("ingest-scaleai")
def ingest_scaleai(
    urls_file: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
) -> None:
    """Ingest Scale AI projects from a JSON list of project URLs."""
    n = scaleai.ingest_urls(urls_file)
    console.log(f"[bold green]Scale AI:[/] {n} projects ingested")


# Treasury Board's federal-wide Proactive Disclosure of G&C dataset.
# https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013
_PROACTIVE_HELP = (
    "Download the dataset's grants.csv (~2.25 GB) from "
    "https://open.canada.ca/data/dataset/432527ab-7aac-45b5-81d6-7597107a7013"
)


def _sif_matcher(prog: str) -> str | None:
    """Match any ISED program name that's a SIF variant — the dataset has
    >20 spellings: 'SIF Stream 1- R&D', 'SIF - Steel and Aluminum Program',
    'Strategic Innovation Fund', etc."""
    p = prog.strip()
    if p.startswith("SIF") or "Strategic Innovation Fund" in p:
        return "SIF"
    return None


def _irap_matcher(prog: str) -> str | None:
    """Match NRC IRAP variants. The base program name is consistent:
    'Industrial Research Assistance Program – <sub-stream>'. We exclude the
    Youth Employment sub-streams since they're internships, not R&D grants."""
    p = prog.strip()
    if "Industrial Research Assistance Program" not in p:
        return None
    if "Youth Employment" in p:
        return None
    return "IRAP"


@app.command("ingest-sif")
def ingest_sif(
    csv_path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    limit: int | None = typer.Option(None, help="Cap rows scanned (useful for smoke tests)."),
) -> None:
    f"""Ingest ISED Strategic Innovation Fund rows from the Proactive Disclosure CSV.
    {_PROACTIVE_HELP}"""
    companies, grants = proactive.ingest_csv(
        csv_path,
        owner_org="ic",
        program_matcher=_sif_matcher,
        limit=limit,
    )
    console.log(f"[bold green]SIF:[/] {grants} grants, {companies} unique recipients")


@app.command("ingest-irap")
def ingest_irap(
    csv_path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    limit: int | None = typer.Option(None, help="Cap rows scanned (useful for smoke tests)."),
) -> None:
    f"""Ingest NRC IRAP rows from the Proactive Disclosure CSV.
    {_PROACTIVE_HELP}"""
    companies, grants = proactive.ingest_csv(
        csv_path,
        owner_org="nrc-cnrc",
        program_matcher=_irap_matcher,
        limit=limit,
    )
    console.log(f"[bold green]IRAP:[/] {grants} grants, {companies} unique recipients")


def _federal_matcher(prog: str) -> str | None:
    """Map federal program names → our existing program codes, preserving the
    specific buckets we already have. Anything we don't recognize gets bucketed
    into FEDERAL_OTHER by the ingester's default."""
    p = prog.strip()
    code = _sif_matcher(p)
    if code:
        return code
    code = _irap_matcher(p)
    if code:
        return code
    if "CanExport" in p:
        return "FEDERAL_OTHER"  # NRC export-support program, keep but no dedicated bucket
    if p == "Industrial Research Assistance Program – Youth Employment Program":
        return None  # internships, not R&D
    return None  # falls through to FEDERAL_OTHER


@app.command("ingest-era")
def ingest_era() -> None:
    """Ingest all Emissions Reduction Alberta (ERA) projects from their
    WordPress sitemap. ~459 cleantech / emissions-reduction projects,
    tagged under PROVINCIAL_OTHER."""
    companies, grants = era.ingest_all()
    console.log(f"[bold green]ERA Alberta:[/] {grants} grants, {companies} unique recipients")


@app.command("ingest-abinnovates")
def ingest_abinnovates(
    since: str | None = typer.Option("2024-05-23", help="ISO date; skip projects fully ended before this."),
) -> None:
    """Ingest Alberta Innovates projects from their WordPress sitemap (~621
    projects). Tagged under PROVINCIAL_OTHER."""
    companies, grants = abinnovates.ingest_all(date_cutoff=since)
    console.log(f"[bold green]Alberta Innovates:[/] {grants} grants, {companies} unique recipients")


@app.command("ingest-federal-recent")
def ingest_federal_recent(
    csv_path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    since: str = typer.Option("2024-05-23", help="ISO date; keep rows with start_date >= this."),
    limit: int | None = typer.Option(None, help="Cap rows scanned (smoke testing)."),
    start_row: int = typer.Option(0, help="Skip the first N CSV rows. Useful for resuming after a crash without re-processing already-ingested rows."),
) -> None:
    f"""Ingest all recent federal G&C grants going to companies (F) or academic (A)
    recipients, from any department. Programs we already track (SIF, IRAP) get
    their specific codes; everything else lands under FEDERAL_OTHER.
    {_PROACTIVE_HELP}"""
    companies, grants = proactive.ingest_csv(
        csv_path,
        owner_org=None,  # all federal departments
        program_matcher=_federal_matcher,
        date_cutoff=since,
        # Keep most recipient types — they all have a usable institution name
        # in operating_name or legal_name. Skip I (international / individuals
        # with no Canadian-org context) and G (federal-to-federal transfers).
        recipient_types={"F", "A", "N", "S", "P", "O"},
        limit=limit,
        start_row=start_row,
    )
    console.log(f"[bold green]Federal (recent):[/] {grants} grants, {companies} unique recipients")


@app.command("ingest-frq")
def ingest_frq(
    csv_path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    program: str = typer.Option(..., help="One of FRQS, FRQNT, FRQSC — must match the file's sub-agency."),
) -> None:
    """Ingest one FRQ fiscal-year CSV from donneesquebec.ca."""
    companies, grants = frq.ingest_csv(csv_path, program_code=program)
    console.log(f"[bold green]FRQ {program}:[/] {grants} grants, {companies} institutions")


@app.command("ingest-arc")
def ingest_arc(
    since_year: int = typer.Option(2016, help="Keep grants whose funding commences in this year or later."),
    limit: int | None = typer.Option(None, help="Stop after roughly this many grants (smoke testing)."),
) -> None:
    """Ingest Australian Research Council grants from the public Data Portal API
    (https://dataportal.arc.gov.au). Adds Australian (non-medical) research PIs
    to the find-a-PI flow; pairs with ingest-nhmrc for medical research."""
    companies, grants = arc.ingest_api(since_year=since_year, limit=limit)
    console.log(f"[bold green]ARC:[/] {grants} grants, {companies} unique institutions")


@app.command("ingest-nhmrc")
def ingest_nhmrc(
    xlsx_path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    limit: int | None = typer.Option(None, help="Cap rows ingested (useful for smoke tests)."),
) -> None:
    """Ingest an NHMRC Research Funding dataset XLSX (Australian medical research,
    with plain-language descriptions). Download it from
    https://www.nhmrc.gov.au/funding/outcomes-and-data-research/research-funding-statistics-and-data
    The parser auto-detects columns and logs the mapping on start."""
    companies, grants = nhmrc.ingest_xlsx(xlsx_path, limit=limit)
    console.log(f"[bold green]NHMRC:[/] {grants} grants, {companies} unique institutions")


@app.command("ingest-nsf")
def ingest_nsf(
    since: str = typer.Option("2024-06-01", help="ISO date; keep awards dated on/after this."),
    until: str | None = typer.Option(None, help="ISO date; defaults to today."),
    limit: int | None = typer.Option(None, help="Stop after roughly this many grants (smoke testing)."),
) -> None:
    """Ingest US NSF awards from the public Awards API (api.nsf.gov). Brings US
    science/engineering labs (and SBIR companies) into the finder flows; pairs
    with ingest-nih for US medical research."""
    companies, grants = nsf.ingest_api(since=since, until=until, limit=limit)
    console.log(f"[bold green]NSF:[/] {grants} grants, {companies} unique institutions")


@app.command("ingest-nih")
def ingest_nih(
    since: str = typer.Option("2024-06-01", help="ISO date; keep awards noticed on/after this."),
    until: str | None = typer.Option(None, help="ISO date; defaults to today."),
    limit: int | None = typer.Option(None, help="Stop after roughly this many grants (smoke testing)."),
) -> None:
    """Ingest US NIH projects (with scientific abstracts) from the RePORTER v2
    API. US medical research — the CIHR/NHMRC counterpart. Continuations are
    keyed on the core project number so re-runs update, not duplicate."""
    companies, grants = nih.ingest_api(since=since, until=until, limit=limit)
    console.log(f"[bold green]NIH:[/] {grants} grants, {companies} unique institutions")


@app.command("ingest-ukri")
def ingest_ukri(
    since: str = typer.Option("2024-06-01", help="ISO date; keep projects whose funding starts on/after this."),
    limit: int | None = typer.Option(None, help="Stop after roughly this many grants (smoke testing)."),
    start_page: int = typer.Option(1, help="Resume the scan from this GtR page (after a crash)."),
) -> None:
    """Ingest UK grants from UKRI's Gateway to Research API — all seven research
    councils (university PIs) plus Innovate UK (companies) in one source. Scans
    the full project list (~175k records) and keeps the date window, so expect
    a long run."""
    companies, grants = ukri.ingest_api(since=since, limit=limit, start_page=start_page)
    console.log(f"[bold green]UKRI:[/] {grants} grants, {companies} unique organisations")


@app.command("ingest-cihr")
def ingest_cihr(
    xlsx_path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    limit: int | None = typer.Option(None, help="Cap rows ingested (useful for smoke tests)."),
) -> None:
    """Ingest one CIHR Grants & Awards fiscal-year XLSX (with scientific
    abstracts). Download per-year files from
    https://open.canada.ca/data/en/dataset/49edb1d7-5cb4-4fa7-897c-515d1aad5da3
    then run once per file. Re-running later years updates recurring grants."""
    companies, grants = cihr.ingest_xlsx(xlsx_path, limit=limit)
    console.log(f"[bold green]CIHR:[/] {grants} grants, {companies} unique institutions")


@app.command("ingest-cfi")
def ingest_cfi(
    years: list[int] = typer.Option([2024, 2025, 2026], "--year", "-y", help="Calendar years to crawl."),
) -> None:
    """Scrape CFI funded-projects dashboard for the given years."""
    companies, grants = cfi.ingest_years(years)
    console.log(f"[bold green]CFI:[/] {grants} grants, {companies} institutions")


@app.command("embed-pending")
def embed_pending(
    fetch: int = typer.Option(2000, help="Rows fetched from Supabase per query."),
    voyage_batch: int = typer.Option(128, help="Inputs per Voyage embed call (max ~1000)."),
    workers: int = typer.Option(6, help="Parallel Voyage+RPC pipelines per fetch."),
    max_iters: int = typer.Option(10_000, help="Safety cap on outer-loop iterations."),
) -> None:
    """Fill in embedding vectors for any grant_chunks that don't have one yet.

    Each worker thread runs Voyage embed → bulk RPC update for one batch.
    ``workers`` controls how many batches are in flight simultaneously; with
    Voyage at ~2s/batch and the RPC at ~1s/batch, 6 workers saturates ~6
    batches every 3s ≈ 250 chunks/sec, well under Voyage's 2000 RPM limit."""

    def _embed_one(chunk_rows: list[dict]) -> int:
        try:
            vecs = voyage.embed_batch([r["content"] for r in chunk_rows])
        except Exception as exc:  # noqa: BLE001
            console.log(f"[yellow]embed batch failed ({len(chunk_rows)} rows): {exc}[/]")
            return 0
        try:
            return db.bulk_set_chunk_embeddings(
                [(r["id"], v) for r, v in zip(chunk_rows, vecs, strict=True)]
            )
        except Exception as exc:  # noqa: BLE001
            console.log(f"[yellow]bulk update failed ({len(chunk_rows)} rows): {exc}[/]")
            return 0

    total = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for _ in range(max_iters):
            rows = db.grant_chunks_pending_embedding(limit=fetch)
            if not rows:
                break
            batches = [rows[i : i + voyage_batch] for i in range(0, len(rows), voyage_batch)]
            for n in pool.map(_embed_one, batches):
                total += n
            console.log(f"embedded {total} chunks so far…")
    console.log(f"[bold green]embed-pending done:[/] {total} chunks embedded")


@app.command("revalidate")
def revalidate(tags: list[str] = typer.Argument(..., help="Cache tags to bust.")) -> None:
    """POST the web app's /api/revalidate hook to bust `'use cache'` boundaries."""
    with httpx.Client(timeout=10.0) as c:
        r = c.post(
            f"{settings.web_base_url}/api/revalidate",
            headers={"authorization": f"Bearer {settings.revalidate_secret}"},
            json={"tags": tags},
        )
        r.raise_for_status()
    console.log(f"revalidated: {tags}")


if __name__ == "__main__":
    app()
