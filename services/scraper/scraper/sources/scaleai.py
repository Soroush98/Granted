"""Scale AI project ingestion.

Scale AI (Canada's AI-Powered Supply Chains supercluster, https://www.scaleai.ca/)
publishes funded projects as press releases. There is no clean public API, so
we scrape the project listing page and follow each link.

Heuristics that work today (May 2026):
  * Project URLs match ``https://www.scaleai.ca/projects/<slug>/`` or
    ``https://www.scaleai.ca/<lang>/projects/<slug>/``.
  * The detail page exposes the lead company in the page title and partners
    as a comma-separated list under a "Partners" heading.

This is fragile by nature — adapt the selectors below when the site changes.
For v0, we accept a precomputed list of project URLs from a JSON file so this
file doesn't need to know the listing-page DOM at all.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
from selectolax.parser import HTMLParser

from .. import db
from ..config import settings
from ..normalize import normalize_org_name


def _fetch(url: str) -> str:
    with httpx.Client(
        timeout=30.0,
        headers={"user-agent": settings.scraper_user_agent},
        follow_redirects=True,
    ) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.text


def _extract_project(url: str, html: str) -> dict[str, Any] | None:
    """Pull lead company, partners, title, and a short description from a
    Scale AI project page. Returns None if the page doesn't look like a project."""
    tree = HTMLParser(html)

    title_node = tree.css_first("h1")
    title = title_node.text(strip=True) if title_node else ""
    if not title:
        return None

    # Heuristic: lead company often appears as the strong text after a label
    # like "Project lead" or "Lead". Fallback: use the first paragraph's first
    # capitalized phrase. This is intentionally noisy — the LLM step downstream
    # is what cleans it up, not regex.
    body_text = tree.body.text(separator=" ", strip=True) if tree.body else ""

    return {
        "url": url,
        "title": title,
        "body": body_text[:4000],
    }


def ingest_urls(urls_file: Path) -> int:
    """Ingest a list of project URLs from a JSON file (list[str])."""
    program_id = db.get_program_id("SCALE_AI")
    urls = json.loads(urls_file.read_text())
    inserted = 0
    for url in urls:
        try:
            html = _fetch(url)
        except httpx.HTTPError:
            continue
        meta = _extract_project(url, html)
        if not meta:
            continue
        # v0: treat the project title as the recipient + the lead company is
        # the entry we surface. Without LLM extraction we can't reliably split
        # lead from partners, so we record the URL as the canonical artifact
        # and store the body as a chunk.
        display_name = meta["title"]
        normalized = normalize_org_name(display_name)
        if not normalized:
            continue
        company_id = db.upsert_company(
            {
                "display_name": display_name,
                "normalized_name": normalized,
                "org_type": "company",
            }
        )
        grant_id = db.upsert_grant(
            {
                "program_id": program_id,
                "recipient_id": company_id,
                "title": meta["title"],
                "description": meta["body"],
                "source_url": url,
                "award_id": url,  # URL is unique per project
                "raw": {"source": "scaleai", "url": url},
            }
        )
        if grant_id:
            db.insert_chunk(
                {
                    "grant_id": grant_id,
                    "company_id": company_id,
                    "kind": "grant_description",
                    "content": meta["body"][:2000],
                    "source_url": url,
                }
            )
            inserted += 1
    return inserted
