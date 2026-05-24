"""Entity-resolution helpers.

We see the same company under many spellings ("Cohere Inc.", "COHERE INC",
"Cohere Technologies"). To dedupe without a heavyweight resolver we normalize
to a stripped, lowercased form and use that as the join key.

This is intentionally crude — good enough for a v0 dataset on the order of
~10K organizations. Swap in dedupe.io or a fuzzy-match layer if precision matters.
"""

from __future__ import annotations

import re
import unicodedata

_SUFFIX_RE = re.compile(
    r"\b("
    r"inc|ltd|llc|llp|corp|corporation|company|co|"
    r"limited|incorporated|"
    r"holdings?|group|enterprises?|technologies|tech|"
    r"the"
    r")\b\.?",
    re.IGNORECASE,
)

_WS_RE = re.compile(r"\s+")
_PUNCT_RE = re.compile(r"[^\w\s]")


def normalize_org_name(name: str) -> str:
    """Lowercased, accent-stripped, suffix-trimmed form for fuzzy matching."""
    if not name:
        return ""
    # Strip accents.
    decomposed = unicodedata.normalize("NFKD", name)
    no_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    lowered = no_accents.lower()
    # Drop common suffixes ("Inc.", "Ltd.", etc.).
    no_suffix = _SUFFIX_RE.sub("", lowered)
    # Drop punctuation.
    no_punct = _PUNCT_RE.sub(" ", no_suffix)
    return _WS_RE.sub(" ", no_punct).strip()
