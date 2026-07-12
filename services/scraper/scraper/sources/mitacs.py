"""Mitacs funded-project ingestion.

Mitacs (https://www.mitacs.ca) is Canada's national research-internship funder:
it pays a graduate student / postdoc (the "intern") to work on a project that a
company or nonprofit partner co-funds. Every funded project gets a public page
under ``/our-projects/<slug>/``, enumerated across four WordPress project
sitemaps (~1000 URLs each, ~4000 total).

Each detail page has a predictable structure:

  <h1 class="title">{project title}</h1>
  <p>{project abstract}</p>              # first <p> after the h1
  <div class="project-item">
    <div class="h6">Faculty Supervisor:</div><p>{names; possibly ;-separated}</p>
  </div>
  …one project-item per label: Faculty Supervisor / Student / Partner /
    Discipline / Sector / University / Program…

Because this feeds the /jobs company finder, the **recipient we track is the
partner company** — that's the org a job-seeker would target. When Mitacs
doesn't name a partner we fall back to the host university (org_type
``university``) so the project is still retrievable in the academic cluster.
Mitacs never publishes a per-project dollar amount, so ``amount_cad`` is None.

The faculty supervisor(s), university, discipline and sector are folded into the
description chunk (so they're searchable) and stashed verbatim in ``raw`` under
stable ``_pi`` / ``_org`` / ``_program`` markers the web app reads to surface
the PI. Tagged under program code ``MITACS`` (auto-created if missing).
"""

from __future__ import annotations

import re
import time
from typing import Any

import httpx
from rich.console import Console
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

console = Console()

_SITEMAP_URLS = [
    "https://www.mitacs.ca/project-sitemap.xml",
    "https://www.mitacs.ca/project-sitemap2.xml",
    "https://www.mitacs.ca/project-sitemap3.xml",
    "https://www.mitacs.ca/project-sitemap4.xml",
]

_LOC_RE = re.compile(r"<loc>([^<]+)</loc>")


def _fetch(url: str) -> str:
    with httpx.Client(
        timeout=30.0,
        headers={"user-agent": settings.scraper_user_agent},
        follow_redirects=True,
    ) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.text


def _fetch_retry(url: str, *, attempts: int = 3) -> str:
    """Fetch with short exponential backoff on transient httpx errors.

    Re-raises the last httpx.HTTPError after ``attempts`` tries so the caller can
    log-and-skip a single bad URL instead of crashing the whole run."""
    last_exc: httpx.HTTPError | None = None
    for i in range(attempts):
        try:
            return _fetch(url)
        except httpx.HTTPError as exc:
            last_exc = exc
            time.sleep(0.5 * (2 ** i))
    assert last_exc is not None  # attempts >= 1, so a failure always set this
    raise last_exc


def _project_urls() -> list[str]:
    """Concatenate all four project sitemaps into a deduped, ordered URL list.

    Keeps only real project detail pages (``/our-projects/``), dropping any
    ``<loc>`` that is itself a sitemap or a French (``/fr/``) variant."""
    seen: set[str] = set()
    urls: list[str] = []
    for sm in _SITEMAP_URLS:
        try:
            xml = _fetch_retry(sm)
        except httpx.HTTPError as exc:
            console.log(f"[yellow]Mitacs sitemap fetch failed {sm}: {exc}[/]")
            continue
        for loc in _LOC_RE.findall(xml):
            if "/our-projects/" not in loc:
                continue
            if "/fr/" in loc or "sitemap" in loc:
                continue
            if loc in seen:
                continue
            seen.add(loc)
            urls.append(loc)
    return urls


def _meta_fields(tree: HTMLParser) -> dict[str, str]:
    """Parse the ``project-item`` metadata blocks into a {label: value} map.

    Each block is ``<div class="h6">LABEL:</div><p>VALUE</p>``; the trailing
    colon is stripped from the label so lookups use e.g. "Partner"."""
    meta: dict[str, str] = {}
    for item in tree.css("div.project-item"):
        label_el = item.css_first("div.h6")
        value_el = item.css_first("p")
        if not label_el:
            continue
        label = label_el.text(strip=True).rstrip(":").strip()
        value = value_el.text(strip=True) if value_el else ""
        if label:
            meta[label] = value
    return meta


def _split_dedupe(value: str) -> list[str]:
    """Split a ``;``-separated field (faculty supervisors, partners), trimming
    each entry and deduping while preserving order. Mitacs sometimes packs
    several orgs into one ``Partner:`` value with no space after the semicolon
    (e.g. ``Rock Flow Dynamics Inc;University of Calgary``)."""
    seen: set[str] = set()
    out: list[str] = []
    for part in value.split(";"):
        name = part.strip()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def _first_paragraph(tree: HTMLParser) -> str:
    """The project abstract: first <p> that follows the ``h1.title`` heading."""
    h1 = tree.css_first("h1.title")
    if not h1:
        return ""
    node = h1.next
    while node is not None:
        if node.tag == "p":
            return node.text(strip=True)
        node = node.next
    return ""


def _description_chunk(description: str, faculty: list[str], meta: dict[str, str]) -> str:
    """Project abstract plus a trailing line of faculty/university/discipline/
    sector so those are searchable in the embedded chunk."""
    parts: list[str] = []
    if faculty:
        parts.append(f"Faculty Supervisor: {'; '.join(faculty)}")
    if meta.get("University"):
        parts.append(f"University: {meta['University']}")
    if meta.get("Discipline"):
        parts.append(f"Discipline: {meta['Discipline']}")
    if meta.get("Sector"):
        parts.append(f"Sector: {meta['Sector']}")
    trailer = "; ".join(parts)
    if not trailer:
        return description
    if not description:
        return f"{trailer}."
    return f"{description}\n\n{trailer}."


def _extract_project(url: str, html: str) -> dict[str, Any] | None:
    tree = HTMLParser(html)
    h1 = tree.css_first("h1.title")
    if not h1:
        return None
    title = h1.text(strip=True)
    if not title:
        return None

    description = _first_paragraph(tree)
    meta = _meta_fields(tree)
    faculty = _split_dedupe(meta.get("Faculty Supervisor", ""))

    partner_raw = meta.get("Partner", "").strip()
    partners = _split_dedupe(partner_raw)
    university = meta.get("University", "").strip()

    # Recipient = the partner company (feeds the /jobs finder). A ``Partner:``
    # value can pack several orgs; the first is the industry partner we target.
    # If Mitacs names no partner, fall back to the host university.
    if partners:
        recipient, org_type = partners[0], "company"
    elif university:
        recipient, org_type = university, "university"
    else:
        return None

    normalized = normalize_org_name(recipient)
    if not normalized:
        return None

    return {
        "url": url,
        "title": title,
        "description": description,
        "description_chunk": _description_chunk(description, faculty, meta),
        "faculty": faculty,
        "student": meta.get("Student", "").strip(),
        "partner": partner_raw,
        "partners": partners,
        "discipline": meta.get("Discipline", "").strip(),
        "sector": meta.get("Sector", "").strip(),
        "university": university,
        "program": meta.get("Program", "").strip(),
        "recipient": recipient,
        "org_type": org_type,
        "normalized": normalized,
    }


def ingest_all(limit: int | None = None) -> tuple[int, int]:
    """Pull every Mitacs project from the four project sitemaps and ingest.

    Returns (companies_seen, grants_inserted). Tagged under program code MITACS
    (auto-created if missing). ``limit`` caps the number of project URLs
    processed — handy for smoke tests."""
    program_id = db.ensure_program_id(
        "MITACS",
        name="Mitacs (Accelerate/Elevate/etc.)",
        agency="Mitacs",
    )
    urls = _project_urls()
    if limit is not None:
        urls = urls[:limit]
    console.log(f"Mitacs: {len(urls)} project URLs from sitemaps")

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
            cid = company_map.get((m["normalized"], m["org_type"]))
            if not cid:
                continue
            raw = {
                "source": "mitacs",
                "_funder": "MITACS",
                "_pi": m["faculty"][0] if m["faculty"] else "",
                "_org": m["university"],
                "_program": m["program"],
                "url": m["url"],
                "title": m["title"],
                "description": m["description"],
                "faculty": m["faculty"],
                "student": m["student"],
                "partner": m["partner"],
                "partners": m["partners"],
                "discipline": m["discipline"],
                "sector": m["sector"],
                "university": m["university"],
                "recipient": m["recipient"],
                "org_type": m["org_type"],
            }
            grant_payload.append(
                {
                    "program_id": program_id,
                    "recipient_id": cid,
                    "title": m["title"],
                    "description": m["description_chunk"] or None,
                    "amount_cad": None,  # Mitacs doesn't publish per-project amounts
                    "source_url": m["url"],
                    "award_id": m["url"],  # URL is unique per project
                    "raw": raw,
                }
            )
            chunk_payload.append(
                {
                    "_cid": cid,
                    "_aid": m["url"],
                    "title": m["title"],
                    "body": m["description_chunk"],
                }
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
            if cp["body"]:
                chunks.append({"grant_id": gid, "company_id": cp["_cid"],
                               "kind": "grant_description", "content": cp["body"][:2000]})
        db.bulk_insert_chunks(chunks)
        return len(grant_payload)

    for i, url in enumerate(urls, 1):
        try:
            html = _fetch_retry(url)
        except httpx.HTTPError as exc:
            console.log(f"[yellow]Mitacs fetch failed {url}: {exc}[/]")
            continue
        meta = _extract_project(url, html)
        if not meta:
            continue
        batch_companies.append({
            "display_name": meta["recipient"],
            "normalized_name": meta["normalized"],
            "org_type": meta["org_type"],
        })
        batch_meta.append(meta)
        if len(batch_meta) >= 30:
            grants_inserted += flush()
            batch_companies, batch_meta = [], []
            console.log(f"Mitacs: {i}/{len(urls)} fetched, {grants_inserted} grants in")

    grants_inserted += flush()
    return len(companies_seen), grants_inserted
