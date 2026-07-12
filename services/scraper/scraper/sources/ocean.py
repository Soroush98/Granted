"""Canada's Ocean Supercluster (OSC) funded-project ingestion.

Canada's Ocean Supercluster (https://oceansupercluster.ca) is one of Canada's
five Global Innovation Clusters — it co-funds industry-led ocean-economy R&D
projects. Its funded projects are published as WordPress posts and enumerated
via the sitemap at ``/wp-sitemap-posts-project-1.xml`` (~109 URLs of the form
``https://oceansupercluster.ca/project/<slug>/``).

Unlike ERA (whose project pages carry a tidy h3/h4 metadata grid), OSC pages
are press releases: the ``<h1>`` is a headline ("Canada's Ocean Supercluster
Announces $4.9M OceanDNA System") and the funded amount and lead organization
are buried in the narrative. We therefore:

  * keep the ``<h1>`` as the grant title;
  * derive the **recipient** = the project *lead* organization. The lead is
    stated in the body ("Led by eDNAtec Inc. …", "SmartICE will lead …",
    "Halifax, NS-based Marine Thinking …") and, when a structured "Project
    Partners" list exists (a ``<ul>`` after a *Project Partners* heading, or a
    partner-logo gallery of ``<h2>`` headings), the first partner is the lead.
    When no organization can be named we fall back to a cleaned project name
    derived from the headline so a real project is never dropped;
  * parse a dollar amount from the headline or body ("$4.9M" → 4_900_000);
  * treat the narrative body as the ``grant_description`` chunk and append a
    line listing the Project Partners so they're searchable.

Some ``/project/`` URLs are ecosystem/announcement posts rather than funded
projects. If such a page has no Project Partners *and* only a thin body we skip
it (``_extract_project`` returns ``None``).

OSC's WAF returns 403 under rapid sequential scraping, so ``_fetch`` treats
403/429/5xx as transient (retry with backoff) and ``ingest_all`` paces itself.
"""

from __future__ import annotations

import re
import time
from typing import Any

import httpx
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name

_SITEMAP_URL = "https://oceansupercluster.ca/wp-sitemap-posts-project-1.xml"
_PROJECT_LOC_RE = re.compile(r"<loc>\s*(https://oceansupercluster\.ca/project/[^<\s]+)\s*</loc>")

# --- amount parsing -------------------------------------------------------
_AMOUNT_RE = re.compile(r"\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion|M\b|B\b|K\b)?", re.I)
_AMOUNT_MULT = {"million": 1e6, "billion": 1e9, "m": 1e6, "b": 1e9, "k": 1e3}

# --- lead-organization extraction ----------------------------------------
# A proper-noun run: Title/ALLCAPS tokens (allowing camelCase leads like
# "eDNAtec") joined by lowercase connectors that legitimately appear inside org
# names ("Energy Research & Innovation Newfoundland and Labrador").
_ORG_TOKEN = r"[A-Za-z]?[A-Z][A-Za-z0-9.&'’/\-]*"
_ORG_CONNECT = r"(?:of|and|de|des|du|la|le|for|the|on|&)"
_ORG_PHRASE = re.compile(rf"{_ORG_TOKEN}(?:\s+(?:{_ORG_TOKEN}|{_ORG_CONNECT})){{0,7}}")
# A leading geographic descriptor in the adjectival "<place>-based <Org>" /
# "<place> based <Org>" form. Kept short and period-free so it can't swallow a
# whole sentence ("… services based upon …"), and it must be followed by an
# uppercase org token. NOT matched for "<Org> based in <place>" (org precedes).
_GEO_BASED = re.compile(r"^[A-Za-z][\w,'’\- ]{0,40}?[\s\-]based\s+(?=[A-Z])")
_ARTICLE = re.compile(r"^(?:the|a|an)\s+", re.I)
_TRAIL_CONNECT = re.compile(r"\s+(?:and|of|for|de|des|the|on|in|&)$", re.I)
# Words that on their own (or in combination) don't name a real organization —
# generic descriptors, the funder, and Canadian place names.
_GENERIC_WORDS = {
    "sme", "smes", "company", "companies", "startup", "startups", "firm", "firms",
    "team", "teams", "consortium", "project", "projects", "partners", "partner",
    "industry", "canadian", "canada", "ocean", "supercluster", "technology",
    "technologies", "solution", "solutions", "atlantic", "pacific", "hub",
    "ontario", "quebec", "scotia", "nova", "brunswick", "newfoundland", "labrador",
    "columbia", "british", "alberta", "manitoba", "saskatchewan", "yukon",
    "edward", "island", "prince", "northern", "group",
}
_UNIVERSITY_RE = re.compile(r"\b(universit(?:y|é|ies)|college|polytechnic)\b", re.I)

# Headline boilerplate stripped when deriving a fallback project name.
_TITLE_BOILER = re.compile(
    r"^Canada['’]s Ocean Supercluster\s*(?:\(OSC\))?\s*"
    r"(?:and\b.*?\bAnnounce[sd]?|Announce[sd]?|Launch(?:es|ed)?|Funds?)?\s*",
    re.I,
)
_TITLE_AMT = re.compile(r"\$\s?[\d.,]+\s?(?:million|billion|[MBK])?\b", re.I)

# HTTP statuses worth retrying — OSC's WAF rate-limits scrapers with 403s.
_TRANSIENT_STATUS = {403, 408, 425, 429, 500, 502, 503, 504}


def _fetch(url: str, *, attempts: int = 4) -> str:
    """GET ``url`` with retry on transient network errors and rate-limit/5xx
    statuses. Permanent 4xx (e.g. 404) raise immediately."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            with httpx.Client(
                timeout=30.0,
                headers={"user-agent": settings.scraper_user_agent},
                follow_redirects=True,
            ) as c:
                r = c.get(url)
                r.raise_for_status()
                return r.text
        except httpx.HTTPError as exc:
            last = exc
            resp = getattr(exc, "response", None)
            status = getattr(resp, "status_code", None)
            if status is not None and status not in _TRANSIENT_STATUS:
                raise
            time.sleep(1.0 * (2 ** i))
    assert last is not None
    raise last


def _project_urls() -> list[str]:
    xml = _fetch(_SITEMAP_URL)
    # De-dupe while preserving sitemap order.
    seen: set[str] = set()
    urls: list[str] = []
    for u in _PROJECT_LOC_RE.findall(xml):
        if u not in seen:
            seen.add(u)
            urls.append(u)
    return urls


def _parse_amount(text: str | None) -> float | None:
    if not text:
        return None
    m = _AMOUNT_RE.search(text)
    if not m:
        return None
    try:
        num = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    num *= _AMOUNT_MULT.get((m.group(2) or "").strip().lower(), 1)
    return round(num, 2)


def _is_generic(name: str) -> bool:
    words = [w for w in re.sub(r"[^\w\s]", " ", name.lower()).split() if len(w) > 1]
    return not words or all(w in _GENERIC_WORDS for w in words)


def _clean_org(cand: str | None) -> str | None:
    if not cand:
        return None
    cand = re.split(r"\.\s", cand)[0]          # stop at a sentence boundary ("Inc. Through")
    cand = _TRAIL_CONNECT.sub("", cand).strip(" .,&-")
    if cand and re.search(r"supercluster", cand, re.I):
        return None                             # never let the funder be the recipient
    return cand or None


def _org_from_start(seg: str) -> str | None:
    """First org phrase at the start of a segment, dropping a leading article
    and a "<place>-based" geographic prefix."""
    seg = _GEO_BASED.sub("", _ARTICLE.sub("", seg.strip()))
    m = _ORG_PHRASE.search(seg[:120])
    return _clean_org(m.group(0)) if m else None


def _org_from_end(seg: str) -> str | None:
    """Last org phrase in a segment (for "<Org> will lead" / the name that
    precedes "based in <place>")."""
    seg = seg.strip().strip(" ,.")
    last = None
    for m in _ORG_PHRASE.finditer(seg):
        last = m
    return _clean_org(last.group(0)) if last else None


def _lead_from_segment(seg: str) -> str | None:
    """Pull the lead org from the text following a "led by"/"between" cue."""
    cand = _org_from_start(seg)
    if cand and not _is_generic(cand):
        return cand
    # "<Org> based in <place>" — the org precedes the location.
    bm = re.search(r"^(.{0,120}?)\s+based\s+in\b", seg)
    if bm:
        cand = _org_from_end(bm.group(1))
        if cand and not _is_generic(cand):
            return cand
    # "<generic descriptor>, <Real Org>, …"
    if "," in seg:
        cand = _org_from_start(seg.split(",", 1)[1])
        if cand and not _is_generic(cand):
            return cand
    return None


def _find_lead(body: str, partners: list[str]) -> tuple[str | None, str | None]:
    """Return (lead_org, how) using narrative cues first, then the partner list.
    ``how`` records which strategy fired (kept in ``raw`` for debugging)."""
    for pat in (r"\bled by\s+(.{0,140})", r"\bspearheaded by\s+(.{0,140})", r"\bheaded by\s+(.{0,140})"):
        m = re.search(pat, body, re.I)
        if m:
            cand = _lead_from_segment(m.group(1))
            if cand:
                return cand, "led-by"
    for pat in (r"([A-Z].{1,70}?)\s+will lead\b", r"([A-Z].{1,70}?)\s+is leading\b"):
        m = re.search(pat, body)
        if m:
            cand = _org_from_end(m.group(1))
            if cand and not _is_generic(cand):
                return cand, "will-lead"
    # "Full Name (ACRONYM) … will/lead/partner" — org introduced with its acronym.
    m = re.search(r"([A-Z][A-Za-z0-9.&'’ \-]{3,60}?)\s*\([A-Z]{2,6}\)[^.]{0,80}(?:will|lead|partner)", body)
    if m:
        cand = _org_from_start(m.group(1))
        if cand and not _is_generic(cand):
            return cand, "acronym"
    m = re.search(r"collaboration between\s+(.{0,90})", body, re.I)
    if m:
        cand = _lead_from_segment(m.group(1))
        if cand:
            return cand, "collab"
    if partners and not _is_generic(partners[0]):
        return partners[0], "partner-list"
    return None, None


def _project_name_from_title(title: str) -> str:
    """Best-effort project name from a press-release headline, for use as the
    recipient when no organization can be named in the body."""
    t = _TITLE_BOILER.sub("", title)
    t = _TITLE_AMT.sub("", t)
    t = re.sub(r"\b(First-of-Its-Kind|New)\b", "", t, flags=re.I)
    t = re.sub(r"[:–].*$", "", t)                          # drop subtitle after a colon/em-dash
    t = re.sub(r"\s+(Project|Projet)s?\b.*$", "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip(" –-:") or title


def _partners(tree: HTMLParser) -> list[str]:
    """Project-partner org names from the structured list (a ``<ul>``) and/or
    the partner-logo gallery (``<h2 class="wpb_gallery_heading">``)."""
    names: list[str] = []
    for ul in tree.css("ul.wp-block-list"):
        for li in ul.css("li"):
            txt = li.text(strip=True)
            if txt and len(txt) < 120:
                names.append(txt)
    for h in tree.css("h2.wpb_gallery_heading"):
        txt = h.text(strip=True)
        if txt and len(txt) < 120:
            names.append(txt)
    seen: set[str] = set()
    ordered: list[str] = []
    for n in names:
        if n.lower() not in seen:
            seen.add(n.lower())
            ordered.append(n)
    return ordered


def _body_text(tree: HTMLParser) -> str:
    # Scope to <main> so we skip the site-wide banner/nav and footer. separator
    # keeps inline elements space-separated ("Led by <b>RBR</b>" → "Led by RBR").
    main = tree.css_first("main") or tree
    paras = [p.text(separator=" ", strip=True) for p in main.css("p")]
    return re.sub(r"\s+", " ", " ".join(p for p in paras if p)).strip()


def _extract_project(url: str, html: str) -> dict[str, Any] | None:
    tree = HTMLParser(html)
    h1 = tree.css_first("h1")
    if not h1:
        return None
    title = h1.text(strip=True)
    if not title:
        return None

    body = _body_text(tree)
    partners = _partners(tree)

    # Ecosystem/announcement posts (no partners AND a thin body) aren't funded
    # projects — skip them.
    if not partners and len(body) < 300:
        return None

    lead, how = _find_lead(body, partners)
    if lead is None:
        # A real project with substantial content but no nameable lead — keep it
        # under a project-name recipient rather than dropping it.
        lead = _project_name_from_title(title)
        how = "title-fallback"

    normalized = normalize_org_name(lead)
    if not normalized:
        return None

    org_type = "university" if _UNIVERSITY_RE.search(lead) else "company"
    amount = _parse_amount(title) or _parse_amount(body)

    description = body[:3000]
    if partners:
        description = f"{description} Project Partners: {', '.join(partners)}."

    return {
        "url": url,
        "title": title,
        "recipient": lead,
        "normalized": normalized,
        "org_type": org_type,
        "partners": partners,
        "amount_cad": amount,
        "description": description,
        "lead_source": how,
    }


def ingest_all(limit: int | None = None) -> tuple[int, int]:
    """Pull every OSC project from the sitemap and ingest. Returns
    (companies_seen, grants_inserted). ``limit`` caps the number of project
    URLs (smoke tests). Tagged under program code OCEAN_SC."""
    from rich.console import Console
    console = Console()

    program_id = db.ensure_program_id(
        "OCEAN_SC",
        name="Canada's Ocean Supercluster",
        agency="Ocean Supercluster",
    )
    urls = _project_urls()
    if limit is not None:
        urls = urls[:limit]
    console.log(f"OSC: {len(urls)} project URLs from sitemap")

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
        chunk_meta: list[dict[str, Any]] = []
        for m in batch_meta:
            cid = company_map.get((m["normalized"], m["org_type"]))
            if not cid:
                continue
            grant_payload.append(
                {
                    "program_id": program_id,
                    "recipient_id": cid,
                    "title": m["title"],
                    "description": m["description"] or None,
                    "amount_cad": m["amount_cad"],
                    "source_url": m["url"],
                    "award_id": m["url"],  # URL is unique per project
                    "raw": {
                        "source": "ocean_supercluster",
                        "url": m["url"],
                        "partners": m["partners"],
                        "amount_cad": m["amount_cad"],
                        "lead": m["recipient"],
                        "lead_source": m["lead_source"],
                    },
                }
            )
            chunk_meta.append(
                {"_cid": cid, "_aid": m["url"], "title": m["title"], "body": m["description"]}
            )

        grant_map = db.bulk_upsert_grants(grant_payload)

        chunks: list[dict[str, Any]] = []
        for cm in chunk_meta:
            gid = grant_map.get((program_id, cm["_aid"]))
            if not gid:
                continue
            if cm["title"]:
                chunks.append({"grant_id": gid, "company_id": cm["_cid"],
                               "kind": "grant_title", "content": cm["title"]})
            if cm["body"]:
                chunks.append({"grant_id": gid, "company_id": cm["_cid"],
                               "kind": "grant_description", "content": cm["body"][:2000]})
        db.bulk_insert_chunks(chunks)
        return len(grant_payload)

    for i, url in enumerate(urls, 1):
        try:
            html = _fetch(url)
        except httpx.HTTPError as exc:
            console.log(f"[yellow]OSC fetch failed {url}: {exc}[/]")
            continue
        meta = _extract_project(url, html)
        if not meta:
            continue
        batch_companies.append(
            {
                "display_name": meta["recipient"],
                "normalized_name": meta["normalized"],
                "org_type": meta["org_type"],
            }
        )
        batch_meta.append(meta)
        if len(batch_meta) >= 30:
            grants_inserted += flush()
            batch_companies, batch_meta = [], []
            console.log(f"OSC: {i}/{len(urls)} fetched, {grants_inserted} grants in")
        # Be polite — OSC's WAF 403s under rapid sequential scraping.
        time.sleep(0.4)

    grants_inserted += flush()
    return len(companies_seen), grants_inserted
