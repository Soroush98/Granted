"""RQ11 — entity-resolution key (QA-STRATEGY.md, cases NM-*).

Techniques: equivalence partitioning over name variants that MUST collide
(spelling/suffix/case/accent variants of one org) and variants that MUST stay
distinct, plus idempotence and the suffix-only degenerate boundary.
"""

import pytest

from scraper.normalize import normalize_org_name


class TestMustCollide:
    """Variants of the same organization must produce one join key."""

    # NM-01 — the docstring's own examples.
    @pytest.mark.parametrize(
        "variant",
        ["Cohere Inc.", "COHERE INC", "Cohere Technologies", "cohere", "Cohere, Inc."],
    )
    def test_nm01_suffix_and_case_variants_collide(self, variant: str) -> None:
        assert normalize_org_name(variant) == "cohere"

    # NM-02 — accent folding.
    def test_nm02_accents_fold(self) -> None:
        assert normalize_org_name("Café Solutions") == normalize_org_name("Cafe Solutions")
        assert normalize_org_name("Métaux Québec") == normalize_org_name("Metaux Quebec")

    # NM-03 — punctuation becomes whitespace, then squashes.
    def test_nm03_punctuation_folds(self) -> None:
        assert normalize_org_name("A&W Food Services") == "a w food services"
        assert normalize_org_name("Coca-Cola Co") == "coca cola"

    # NM-04 — leading articles and multiple suffixes.
    def test_nm04_articles_and_stacked_suffixes(self) -> None:
        assert normalize_org_name("The Hospital for Sick Children") == (
            "hospital for sick children"
        )
        assert normalize_org_name("Acme Holdings Group Inc.") == "acme"


class TestMustStayDistinct:
    """Different organizations must not be merged by normalization."""

    # NM-05
    @pytest.mark.parametrize(
        ("a", "b"),
        [
            ("Cohere", "Coveo"),
            ("Wedge Networks", "Edge Networks"),
            ("University of Alberta", "University of Calgary"),
        ],
    )
    def test_nm05_distinct_orgs_keep_distinct_keys(self, a: str, b: str) -> None:
        assert normalize_org_name(a) != normalize_org_name(b)

    # NM-06 — suffix words inside a real name must not be stripped mid-word.
    def test_nm06_suffix_substrings_survive(self) -> None:
        # "co" must not fire inside "Coca"; "inc" not inside "Vinci".
        assert "coca" in normalize_org_name("Coca-Cola Co")
        assert "vinci" in normalize_org_name("Vinci Construction")


class TestBoundaries:
    # NM-07 — normalization is idempotent (safe to re-run at re-ingest).
    @pytest.mark.parametrize(
        "name",
        ["Cohere Inc.", "The Tech Group Ltd.", "Général Électrique", "A&W Food Services"],
    )
    def test_nm07_idempotent(self, name: str) -> None:
        once = normalize_org_name(name)
        assert normalize_org_name(once) == once

    # NM-08 — degenerate inputs.
    def test_nm08_empty_and_suffix_only_names(self) -> None:
        assert normalize_org_name("") == ""
        # A name made entirely of suffix words normalizes to "" — every such
        # org would share one join key. Documented as OBS-4 in qa/DEFECTS.md;
        # pinned here so a fix flips this test consciously.
        assert normalize_org_name("The Tech Company Inc.") == ""
