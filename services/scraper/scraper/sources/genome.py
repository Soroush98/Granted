"""Genome Canada funded-research ingestion.

Genome Canada (https://genomecanada.ca) funds large-scale genomics research
projects at Canadian universities and research institutes. Every funded project
gets a public page under ``/project/<slug>/``, enumerated across two WordPress
project sitemaps (~1000 + ~159 URLs). The site is bilingual (WPML): every
project also has a French ``/fr/project/<slug>/`` twin, which we skip.

Each English detail page is an Elementor layout with a predictable structure:

  <meta property="og:title"       content="{title} - GenomeCanada">
  <meta property="og:description" content="{abstract, truncated with […]}">
  …two-column metadata rows, each a label column + a value column:
    <h4 class="elementor-heading-title">Genome Centre(s)</h4>  | Genome British Columbia
    <h4 class="elementor-heading-title">Project Leader(s)</h4>  | (icon-list per leader)
    <h4 class="elementor-heading-title">Status</h4>            | Past
    <h4 class="elementor-heading-title">Competition</h4>       | {program name | None}
  …the full research abstract lives in a <p> in the body (longer than og:desc).

Because this is *academic* research (not a company cluster), the **recipient we
track is the Project Leader's institution** — the org after the leader name in
the ``Project Leader(s)`` block (e.g. "BC Cancer Agency"). ``org_type`` is
``university`` when the name looks like a university/college, else
``research_institute``. When no institution is published we fall back to the
Genome Centre as a ``research_institute`` recipient.

Genome Canada doesn't publish a per-project dollar amount, so ``amount_cad`` is
None. The research abstract is the description chunk we embed for retrieval. The
Project Leader(s), institution and competition are stashed verbatim in ``raw``
under stable ``_pi`` / ``_org`` / ``_program`` markers the web app reads to
surface the researcher on /supervisors and /research-pi. Tagged under program
code ``GENOME_CANADA`` (auto-created if missing).
"""

from __future__ import annotations

import re
import time
import unicodedata
from typing import Any

import httpx
from rich.console import Console
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

console = Console()

_SITEMAP_URLS = [
    "https://genomecanada.ca/project-sitemap.xml",
    "https://genomecanada.ca/project-sitemap2.xml",
]

_LOC_RE = re.compile(r"<loc>([^<]+)</loc>")
# " - GenomeCanada" (regular or en-dash) trailer on og:title.
_TITLE_SUFFIX_RE = re.compile(r"\s*[-–]\s*GenomeCanada\s*$")
# Labels whose value we surface. Project Leader(s) is parsed separately.
_META_LABELS = {"Genome Centre(s)", "Status", "Competition"}
# Values that mean "no value" on these pages.
_EMPTY_VALUES = {"", "none", "n/a", "-", "–"}


def _fetch(url: str) -> tuple[str, str]:
    """GET ``url`` following redirects; return (final_url, html).

    We need the *final* URL because some English ``/project/`` slugs 301-redirect
    to their French ``/fr/`` twin (the English translation is unpublished) — the
    caller drops those so we don't ingest French content."""
    with httpx.Client(
        timeout=30.0,
        headers={"user-agent": settings.scraper_user_agent},
        follow_redirects=True,
    ) as c:
        r = c.get(url)
        r.raise_for_status()
        return str(r.url), r.text


def _fetch_retry(url: str, *, attempts: int = 3) -> tuple[str, str]:
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
    """Concatenate both project sitemaps into a deduped, ordered URL list.

    Keeps only English project detail pages (``/project/``), dropping any French
    (``/fr/``) variant and any nested-sitemap ``<loc>``."""
    seen: set[str] = set()
    urls: list[str] = []
    for sm in _SITEMAP_URLS:
        try:
            _, xml = _fetch_retry(sm)
        except httpx.HTTPError as exc:
            console.log(f"[yellow]Genome Canada sitemap fetch failed {sm}: {exc}[/]")
            continue
        for loc in _LOC_RE.findall(xml):
            if "/project/" not in loc:
                continue
            if "/fr/" in loc or "sitemap" in loc:
                continue
            if loc in seen:
                continue
            seen.add(loc)
            urls.append(loc)
    return urls


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def _org_type(name: str) -> str:
    """university if the institution reads like a university/college, else
    research_institute. Accent-insensitive so "Université"/"Collège" match."""
    low = _strip_accents(name)
    if "university" in low or "universite" in low or "college" in low:
        return "university"
    return "research_institute"


def _col_text(col: Any) -> str:
    """Text of a metadata *value* column. Values render as one or more anchors
    (Genome Centre links) or a plain heading; join multiple anchors so two
    Genome Centres don't mash together."""
    anchors: list[str] = []
    seen: set[str] = set()
    for a in col.css("a"):
        t = a.text(strip=True)
        if t and t not in seen:
            seen.add(t)
            anchors.append(t)
    if anchors:
        return "; ".join(anchors)
    return col.text(strip=True)


def _clean(value: str) -> str | None:
    v = (value or "").strip()
    return None if v.lower() in _EMPTY_VALUES else v


def _labelled_fields(tree: HTMLParser) -> dict[str, str]:
    """Map each metadata label to its value column's text.

    Rows are two adjacent ``elementor-inner-column`` siblings — a label column
    holding ``<h4 class="elementor-heading-title">{label}</h4>`` followed by a
    value column. In document order the value column is always the next
    inner-column, so we walk the flat list and pair by index."""
    cols = tree.css("div.elementor-inner-column")
    out: dict[str, str] = {}
    for i, col in enumerate(cols):
        h4 = col.css_first("h4.elementor-heading-title")
        if not h4:
            continue
        label = h4.text(strip=True)
        if label in _META_LABELS and i + 1 < len(cols):
            out[label] = _col_text(cols[i + 1])
    return out


def _leaders(tree: HTMLParser) -> list[dict[str, str]]:
    """Parse the Project Leader(s) block into ordered {name, institution} dicts.

    The value column ``div.project-leaders-list`` holds one icon-list widget per
    leader; each widget's list items are [name, institution]. Empty placeholder
    widgets (blank spans) are dropped."""
    col = tree.css_first("div.project-leaders-list")
    if not col:
        return []
    leaders: list[dict[str, str]] = []
    for widget in col.css("div.elementor-widget-icon-list"):
        spans = [s.text(strip=True) for s in widget.css("span.elementor-icon-list-text")]
        name = spans[0] if len(spans) >= 1 else ""
        institution = spans[1] if len(spans) >= 2 else ""
        if name:
            leaders.append({"name": name, "institution": institution})
    return leaders


def _abstract(tree: HTMLParser) -> str:
    """The research abstract. og:description carries it but truncates long ones
    with "[…]"; we recover the full text from the body <p> that starts with the
    same words, falling back to the (de-truncated) og:description."""
    ogd = tree.css_first('meta[property="og:description"]')
    ogdc = (ogd.attributes.get("content") if ogd else "") or ""
    prefix = ogdc.rstrip()
    if prefix.endswith("[…]"):  # trailing "[…]"
        prefix = prefix[:-3].strip()
    key = prefix[:40]
    if key:
        best: str | None = None
        for p in tree.css("p"):
            t = p.text(strip=True)
            if key in t and (best is None or len(t) > len(best)):
                best = t
        if best and len(best) >= len(ogdc):
            return best
    return prefix


def _extract_project(url: str, final_url: str, html: str) -> dict[str, Any] | None:
    """Parse one project page into an ingest-ready dict, or None to skip.

    Skips pages that redirected to a French ``/fr/`` twin, pages with neither an
    abstract nor a project leader, and pages where no recipient (leader
    institution or Genome Centre) can be resolved."""
    if "/fr/" in final_url:
        return None  # English translation missing → redirected to French

    tree = HTMLParser(html)

    ogt = tree.css_first('meta[property="og:title"]')
    title = _TITLE_SUFFIX_RE.sub("", (ogt.attributes.get("content") if ogt else "") or "").strip()
    if not title:
        h1 = tree.css_first("h1")
        title = h1.text(strip=True) if h1 else ""
    if not title:
        return None

    abstract = _abstract(tree)
    leaders = _leaders(tree)
    if not abstract and not leaders:
        return None

    fields = _labelled_fields(tree)
    genome_centre = _clean(fields.get("Genome Centre(s)", ""))
    status = _clean(fields.get("Status", ""))
    competition = _clean(fields.get("Competition", ""))

    # Recipient = the leader's institution (first leader that names one). If no
    # institution is published, fall back to the Genome Centre.
    institution = next((L["institution"] for L in leaders if L["institution"]), "")
    if institution:
        recipient, org_type = institution, _org_type(institution)
    elif genome_centre:
        recipient, org_type = genome_centre, "research_institute"
    else:
        return None

    normalized = normalize_org_name(recipient)
    if not normalized:
        return None

    return {
        "url": url,
        "title": title,
        "abstract": abstract,
        "recipient": recipient,
        "org_type": org_type,
        "normalized": normalized,
        "leaders": leaders,
        "pi": leaders[0]["name"] if leaders else "",
        "genome_centre": genome_centre,
        "status": status,
        "competition": competition,
    }


def ingest_all(limit: int | None = None) -> tuple[int, int]:
    """Pull every Genome Canada project from both sitemaps and ingest.

    Returns (companies_seen, grants_inserted). Tagged under program code
    GENOME_CANADA (auto-created if missing). ``limit`` caps the number of project
    URLs processed — handy for smoke tests."""
    program_id = db.ensure_program_id(
        "GENOME_CANADA",
        name="Genome Canada",
        agency="Genome Canada",
    )
    urls = _project_urls()
    if limit is not None:
        urls = urls[:limit]
    console.log(f"Genome Canada: {len(urls)} English project URLs from sitemaps")

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
                "source": "genome_canada",
                "_funder": "GENOME_CANADA",
                "_pi": m["pi"],
                "_org": m["recipient"],
                "_program": m["competition"] or "",
                "genome_centre": m["genome_centre"],
                "status": m["status"],
                "url": m["url"],
                "leaders": m["leaders"],
                "title": m["title"],
            }
            grant_payload.append(
                {
                    "program_id": program_id,
                    "recipient_id": cid,
                    "title": m["title"],
                    "description": m["abstract"] or None,
                    "amount_cad": None,  # not reliably published per project
                    "source_url": m["url"],
                    "award_id": m["url"],  # URL is unique per project
                    "raw": raw,
                }
            )
            chunk_payload.append(
                {"_cid": cid, "_aid": m["url"], "title": m["title"], "body": m["abstract"]}
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
            final_url, html = _fetch_retry(url)
        except httpx.HTTPError as exc:
            console.log(f"[yellow]Genome Canada fetch failed {url}: {exc}[/]")
            continue
        meta = _extract_project(url, final_url, html)
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
            console.log(f"Genome Canada: {i}/{len(urls)} fetched, {grants_inserted} grants in")

    grants_inserted += flush()
    return len(companies_seen), grants_inserted
