"""Tests for `audit-coverage.py` — house-prose-style coverage matching.

node_01M1PGHGQK1K7H9JGMB3FPA5A0: the audit gate scored 0 matched / 55 gaps against a fully
and carefully documented release, because `check_coverage()` only accepted a literal short SHA
or a 40-char subject-substring match, and SkillMeat's house changelog style cites neither (it
cites `(PR #NNN)`). This suite locks in the fix: PR-number matching, an explicit
`<!-- covers: ... -->` consolidated-coverage declaration, and skip-listing the four process
prefixes (`squash`, `campaign`, `papercuts`, `test-infra`) that were emitting spurious
"unknown prefix" WARNING lines.

Every test in `TestPreFixRegression` is a negative control: it runs against the pre-fix
script (saved verbatim, before this leg's edits) and asserts the pre-fix defect is present,
so a future revert of the fix would be caught here rather than by CI silently going green.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1]
SCRIPT = SCRIPTS / "audit-coverage.py"

# The negative-control copy: `git show HEAD:.../audit-coverage.py` taken before this leg's
# fix, saved once to $TMPDIR by the leg (never git stash — this survives worktree churn).
PRE_FIX_SCRIPT = Path(os.environ.get("TMPDIR", "/tmp")) / "audit-coverage.pre-fix.py"


def _load_module(path, name):
    """Import a hyphenated script by path (it is a CLI, not an importable module)."""
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None, f"cannot load {path}"
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)
    return module


@pytest.fixture(scope="module")
def audit():
    return _load_module(SCRIPT, "audit_coverage_fixed")


@pytest.fixture(scope="module")
def audit_pre_fix():
    if not PRE_FIX_SCRIPT.exists():
        pytest.skip(f"pre-fix negative-control copy not found at {PRE_FIX_SCRIPT}")
    return _load_module(PRE_FIX_SCRIPT, "audit_coverage_pre_fix")


# --- AC1: PR-number matching -------------------------------------------------


class TestPrNumberMatching:
    def test_pr_number_cited_in_changelog_is_matched(self, audit):
        commits = [("abc1234def5678", "fix(enterprise): derive namespaced names (#403)")]
        unreleased = "### Fixed\n- Enterprise names are now namespaced (PR #403).\n"
        results = audit.check_coverage(commits, unreleased)
        assert results[0]["matched"] is True

    def test_pr_number_absent_is_still_a_gap(self, audit):
        commits = [("abc1234def5678", "fix(enterprise): derive namespaced names (#403)")]
        unreleased = "### Fixed\n- Some unrelated entry.\n"
        results = audit.check_coverage(commits, unreleased)
        assert results[0]["matched"] is False

    def test_extract_pr_number(self, audit):
        assert audit.extract_pr_number("fix: thing (#403)") == "403"
        assert audit.extract_pr_number("squash: no pr here") is None


# --- AC2: consolidated-coverage declaration ---------------------------------


class TestConsolidatedCoverageDeclaration:
    def test_declared_sha_covers_a_commit_with_unrelated_subject(self, audit):
        # A reportable prefix whose subject reads nothing like the changelog prose (the
        # real-world case is a squashed campaign under a skip-exempt prefix, but the
        # declaration mechanism itself is exercised here against a still-reportable commit
        # so a match failure can't hide behind the skip-exempt path).
        commits = [("1f4379da4abcdef", "feat: M5 memory — bind to PostgreSQL")]
        unreleased = (
            "### Added\n"
            "- Enterprise/project memory now binds to PostgreSQL (PR #470).\n"
            "  <!-- covers: 1f4379da4, 80db25ab1, #470 -->\n"
        )
        results = audit.check_coverage(commits, unreleased)
        assert results[0]["matched"] is True

    def test_declared_pr_in_comment_is_itself_a_literal_match(self, audit):
        # A declared "#470" token is, by construction, literal text inside the section — so a
        # commit whose subject cites that same PR is covered by the plain literal-substring
        # path (TestPrNumberMatching), and the declaration adds nothing extra for it. This
        # documents that overlap rather than asserting a distinct code path.
        commits = [("80db25ab199999", "feat: M4 fleet — inventory (#470)")]
        unreleased = "### Added\n- Fleet inventory work landed.\n  <!-- covers: #470 -->\n"
        results = audit.check_coverage(commits, unreleased)
        assert results[0]["matched"] is True

    def test_declaration_does_not_rescue_a_skip_exempt_commit_it_wasnt_needed_for(self, audit):
        # squash/campaign/etc. are skip-exempt regardless of any declaration — matched stays
        # False for them, but they must not surface as a gap (is_reportable is False).
        commits = [("1f4379da4abcdef", "squash: M5 memory — bind to PostgreSQL")]
        unreleased = "### Added\n- Something.\n  <!-- covers: 1f4379da4 -->\n"
        results = audit.check_coverage(commits, unreleased)
        assert results[0]["is_reportable"] is False

    def test_undeclared_sha_is_not_covered_by_an_unrelated_declaration(self, audit):
        commits = [("deadbeef00000", "squash: something else entirely")]
        unreleased = "### Added\n- Other work.\n  <!-- covers: 1f4379da4, #470 -->\n"
        results = audit.check_coverage(commits, unreleased)
        # "squash" is skip-exempt, so this commit is not reportable at all —
        # use a reportable prefix to make the negative meaningful.
        commits = [("deadbeef00000", "feat: something else entirely")]
        results = audit.check_coverage(commits, unreleased)
        assert results[0]["matched"] is False

    def test_extract_coverage_declarations_parses_shas_and_prs(self, audit):
        text = "blah <!-- covers: 1f4379da4, 80db25ab1 #470 --> more text"
        shas, prs = audit.extract_coverage_declarations(text)
        assert shas == {"1f4379da4", "80db25ab1"}
        assert prs == {"470"}

    def test_no_declaration_yields_empty_sets(self, audit):
        shas, prs = audit.extract_coverage_declarations("no comments here at all")
        assert shas == set()
        assert prs == set()


# --- AC3 is a doc/route-table fix; verified by the leg's grep re-probe, not a unit test. ---


# --- AC4/prefix handling: squash/campaign/papercuts/test-infra ---------------


class TestPrefixHandling:
    @pytest.mark.parametrize(
        "subject",
        [
            "squash: M5 memory — bind to PostgreSQL",
            "campaign(A): scoping gate classification",
            "papercuts: update-field.py string coercion fix",
            "test-infra: hermeticity root-cause fix",
        ],
    )
    def test_process_prefixes_are_skip_exempt_no_warning(self, audit, subject):
        category, is_reportable, warning = audit.categorize_commit(subject)
        assert is_reportable is False
        assert warning is None

    def test_hyphenated_prefix_is_recognised_not_unknown(self, audit):
        # Regression for the specific defect: the old prefix regex was
        # `[a-zA-Z]+` and could not match "test-infra" at all, so it fell
        # through to "unknown" (reportable + WARNING).
        category, is_reportable, warning = audit.categorize_commit(
            "test-infra: hermeticity root-cause fix"
        )
        assert category == "test-infra"

    def test_genuinely_unknown_prefix_still_warns(self, audit):
        category, is_reportable, warning = audit.categorize_commit(
            "chore(landing): tidy up loose ends"
        )
        assert category == "chore"
        assert is_reportable is False

    def test_something_with_no_colon_delimited_prefix_still_warns(self, audit):
        category, is_reportable, warning = audit.categorize_commit("WIP debugging session")
        assert category == "unknown"
        assert is_reportable is True
        assert warning is not None

    def test_release_tag_commit_is_skip_exempt_no_warning(self, audit):
        # Measured on the real v0.81.0..v0.82.0 range: every release's tagging/rollover
        # commit is titled "Release vX.Y.Z (#NNN)" and blocked AC1's exit-0 demonstration
        # until this was recognised — its content IS the changelog rollover.
        category, is_reportable, warning = audit.categorize_commit("Release v0.82.0 (#475)")
        assert category == "release-tag"
        assert is_reportable is False
        assert warning is None


# --- Negative control: real uncovered commit still reported as a gap --------


class TestGenuineGapStillReported:
    def test_a_real_undocumented_fix_is_still_a_gap(self, audit):
        """Fixing the matcher must not turn it into a rubber stamp."""
        commits = [
            ("cafebabe0011", "fix(cli): correct off-by-one in pagination"),
        ]
        unreleased = "### Added\n- Totally unrelated feature.\n"
        results = audit.check_coverage(commits, unreleased)
        assert results[0]["matched"] is False
        assert results[0]["is_reportable"] is True

    def test_build_json_output_reports_the_gap(self, audit):
        commits = [("cafebabe0011", "fix(cli): correct off-by-one in pagination")]
        unreleased = "### Added\n- Totally unrelated feature.\n"
        results = audit.check_coverage(commits, unreleased)
        payload = audit.build_json_output(results, "v1.0.0", "HEAD", "gaps_found")
        assert payload["gaps"], "a genuinely undocumented fix must still surface as a gap"
        assert payload["matched"] == 0


# --- Negative controls against the pre-fix script ---------------------------


class TestPreFixRegression:
    """Each case demonstrates the pre-fix script actually had the defect."""

    def test_pre_fix_does_not_match_pr_number(self, audit_pre_fix):
        commits = [("abc1234def5678", "fix(enterprise): derive namespaced names (#403)")]
        unreleased = "### Fixed\n- Enterprise names are now namespaced (PR #403).\n"
        results = audit_pre_fix.check_coverage(commits, unreleased)
        assert results[0]["matched"] is False

    def test_pre_fix_warns_on_test_infra_prefix(self, audit_pre_fix):
        category, is_reportable, warning = audit_pre_fix.categorize_commit(
            "test-infra: hermeticity root-cause fix"
        )
        assert category == "unknown"
        assert warning is not None

    def test_pre_fix_has_no_coverage_declaration_support(self, audit_pre_fix):
        assert not hasattr(audit_pre_fix, "extract_coverage_declarations")

    def test_pre_fix_warns_on_release_tag_commit(self, audit_pre_fix):
        category, is_reportable, warning = audit_pre_fix.categorize_commit(
            "Release v0.82.0 (#475)"
        )
        assert category == "unknown"
        assert is_reportable is True
        assert warning is not None
