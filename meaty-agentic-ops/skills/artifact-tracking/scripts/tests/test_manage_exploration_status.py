#!/usr/bin/env python3
"""
Tests for manage-exploration-status.py.

Covers the invariants from §3.6 of the pre-commitment exploration meta-plan:
  - Happy path: charter draft → in-progress → concluded with verdict + rationale
  - Reject concluded without verdict
  - Reject feasibility finalized missing recommended_next_action
  - Reject illegal verdict value
  - Reject confidence > 1.0
  - Reject go→no-go without --force
  - Dry-run prints diff but does not write
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).parent.parent
SCRIPT = SCRIPTS_DIR / "manage-exploration-status.py"


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
    )


def _make_charter(
    tmp_path: Path,
    *,
    status: str = "draft",
    verdict: str | None = None,
    verdict_rationale: str | None = None,
    name: str = "test-charter",
) -> Path:
    """Write a minimal exploration_charter file."""
    fm: dict = {
        "schema_version": 2,
        "doc_type": "exploration_charter",
        "title": "Test Charter",
        "status": status,
        "feature_slug": name,
        "created": "2026-05-20",
        "updated": "2026-05-20",
        "timebox_days": 3,
        "hypothesis": "We believe X is worth building.",
        "deal_killer": "If Y is true, abandon.",
        "verdict": verdict,
        "verdict_rationale": verdict_rationale,
    }
    p = tmp_path / f"{name}.md"
    p.write_text(
        "---\n" + yaml.safe_dump(fm, default_flow_style=False, sort_keys=False) + "---\n# Charter\n",
        encoding="utf-8",
    )
    return p


def _make_brief(
    tmp_path: Path,
    *,
    status: str = "draft",
    verdict: str | None = None,
    verdict_confidence: float | None = None,
    recommended_next_action: str | None = None,
    name: str = "test-brief",
) -> Path:
    """Write a minimal feasibility_brief file (report with report_category: feasibility)."""
    fm: dict = {
        "schema_version": 2,
        "doc_type": "report",
        "report_category": "feasibility",
        "title": "Test Feasibility Brief",
        "status": status,
        "feature_slug": name,
        "created": "2026-05-20",
        "updated": "2026-05-20",
        "verdict": verdict,
        "verdict_confidence": verdict_confidence,
        "exploration_charter_ref": "path/to/charter.md",
        "proposed_adr_ref": None,
        "recommended_next_action": recommended_next_action,
    }
    p = tmp_path / f"{name}.md"
    p.write_text(
        "---\n" + yaml.safe_dump(fm, default_flow_style=False, sort_keys=False) + "---\n# Brief\n",
        encoding="utf-8",
    )
    return p


def _read_fm(p: Path) -> dict:
    """Read frontmatter from a file back as a dict."""
    content = p.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n?", content, re.DOTALL)
    assert m, f"No frontmatter in {p}"
    return yaml.safe_load(m.group(1)) or {}


# ---------------------------------------------------------------------------
# Happy-path: charter lifecycle
# ---------------------------------------------------------------------------

class TestCharterHappyPath:
    def test_draft_to_in_progress(self, tmp_path):
        charter = _make_charter(tmp_path, status="draft")
        result = _run("--file", str(charter), "--status", "in-progress")
        assert result.returncode == 0, result.stderr
        fm = _read_fm(charter)
        assert fm["status"] == "in-progress"

    def test_in_progress_to_concluded_with_verdict_and_rationale(self, tmp_path):
        charter = _make_charter(tmp_path, status="in-progress")
        result = _run(
            "--file", str(charter),
            "--status", "concluded",
            "--verdict", "go",
            "--verdict-rationale", "All legs passed; no deal-killer triggered.",
        )
        assert result.returncode == 0, result.stderr
        fm = _read_fm(charter)
        assert fm["status"] == "concluded"
        assert fm["verdict"] == "go"
        assert "All legs passed" in str(fm.get("verdict_rationale", ""))

    def test_set_verdict_only_without_status_change(self, tmp_path):
        charter = _make_charter(tmp_path, status="in-progress")
        result = _run("--file", str(charter), "--verdict", "conditional")
        assert result.returncode == 0, result.stderr
        fm = _read_fm(charter)
        assert fm["verdict"] == "conditional"
        assert fm["status"] == "in-progress"  # unchanged

    def test_updated_field_is_touched(self, tmp_path):
        charter = _make_charter(tmp_path, status="draft")
        result = _run("--file", str(charter), "--status", "in-progress")
        assert result.returncode == 0, result.stderr
        fm = _read_fm(charter)
        # updated must be set to today (format YYYY-MM-DD)
        assert re.match(r"\d{4}-\d{2}-\d{2}", str(fm.get("updated", "")))


# ---------------------------------------------------------------------------
# Reject concluded without verdict
# ---------------------------------------------------------------------------

class TestCharterConcludedValidation:
    def test_reject_concluded_without_verdict(self, tmp_path):
        """status: concluded must be rejected if verdict is absent."""
        charter = _make_charter(tmp_path, status="in-progress")
        result = _run(
            "--file", str(charter),
            "--status", "concluded",
            "--verdict-rationale", "Some rationale.",
        )
        assert result.returncode == 1
        assert "verdict" in result.stderr.lower()

    def test_reject_concluded_without_rationale(self, tmp_path):
        """status: concluded must be rejected if verdict_rationale is empty."""
        charter = _make_charter(tmp_path, status="in-progress")
        result = _run(
            "--file", str(charter),
            "--status", "concluded",
            "--verdict", "no-go",
            # no --verdict-rationale
        )
        assert result.returncode == 1
        assert "rationale" in result.stderr.lower()

    def test_accept_concluded_when_rationale_already_in_frontmatter(self, tmp_path):
        """If verdict_rationale already set in file, --status concluded should succeed."""
        charter = _make_charter(
            tmp_path,
            status="in-progress",
            verdict_rationale="Pre-existing rationale from earlier run.",
        )
        result = _run(
            "--file", str(charter),
            "--status", "concluded",
            "--verdict", "go",
        )
        assert result.returncode == 0, result.stderr


# ---------------------------------------------------------------------------
# Feasibility brief finalized validation
# ---------------------------------------------------------------------------

class TestBriefFinalizedValidation:
    def test_reject_finalized_missing_recommended_next_action(self, tmp_path):
        brief = _make_brief(
            tmp_path,
            status="in-progress",
            verdict="go",
            verdict_confidence=0.8,
            # no recommended_next_action
        )
        result = _run(
            "--file", str(brief),
            "--status", "finalized",
        )
        assert result.returncode == 1
        assert "recommended_next_action" in result.stderr

    def test_reject_finalized_missing_verdict(self, tmp_path):
        brief = _make_brief(
            tmp_path,
            status="in-progress",
            verdict_confidence=0.75,
            recommended_next_action="/plan:plan-feature --tier=2",
        )
        result = _run("--file", str(brief), "--status", "finalized")
        assert result.returncode == 1
        assert "verdict" in result.stderr.lower()

    def test_reject_finalized_missing_confidence(self, tmp_path):
        brief = _make_brief(
            tmp_path,
            status="in-progress",
            verdict="go",
            recommended_next_action="/plan:plan-feature --tier=2",
        )
        result = _run("--file", str(brief), "--status", "finalized")
        assert result.returncode == 1
        assert "confidence" in result.stderr.lower()

    def test_accept_finalized_when_all_fields_present(self, tmp_path):
        brief = _make_brief(
            tmp_path,
            status="in-progress",
            verdict="go",
            verdict_confidence=0.85,
            recommended_next_action="/plan:plan-feature --tier=2",
        )
        result = _run("--file", str(brief), "--status", "finalized")
        assert result.returncode == 0, result.stderr
        fm = _read_fm(brief)
        assert fm["status"] == "finalized"


# ---------------------------------------------------------------------------
# Illegal verdict value
# ---------------------------------------------------------------------------

class TestIllegalVerdictValue:
    def test_reject_unknown_verdict_string(self, tmp_path):
        charter = _make_charter(tmp_path)
        result = _run("--file", str(charter), "--verdict", "maybe")
        assert result.returncode != 0

    def test_reject_empty_string_verdict_via_status_only(self, tmp_path):
        """Illegal verdict via --verdict flag is caught by argparse choices."""
        charter = _make_charter(tmp_path)
        result = _run("--file", str(charter), "--verdict", "")
        assert result.returncode != 0


# ---------------------------------------------------------------------------
# Confidence out of range
# ---------------------------------------------------------------------------

class TestConfidenceValidation:
    def test_reject_confidence_above_1(self, tmp_path):
        brief = _make_brief(tmp_path)
        result = _run("--file", str(brief), "--verdict-confidence", "1.5")
        assert result.returncode == 1
        assert "0.0" in result.stderr or "1.0" in result.stderr or "outside" in result.stderr

    def test_reject_confidence_below_0(self, tmp_path):
        brief = _make_brief(tmp_path)
        result = _run("--file", str(brief), "--verdict-confidence", "-0.1")
        assert result.returncode == 1

    def test_accept_confidence_at_boundary_0(self, tmp_path):
        brief = _make_brief(tmp_path)
        result = _run("--file", str(brief), "--verdict-confidence", "0.0")
        assert result.returncode == 0, result.stderr

    def test_accept_confidence_at_boundary_1(self, tmp_path):
        brief = _make_brief(tmp_path)
        result = _run("--file", str(brief), "--verdict-confidence", "1.0")
        assert result.returncode == 0, result.stderr

    def test_reject_confidence_on_charter(self, tmp_path):
        charter = _make_charter(tmp_path)
        result = _run("--file", str(charter), "--verdict-confidence", "0.9")
        assert result.returncode == 1
        assert "brief" in result.stderr.lower() or "charter" in result.stderr.lower()


# ---------------------------------------------------------------------------
# Verdict flip without --force
# ---------------------------------------------------------------------------

class TestVerdictTransition:
    def test_reject_go_to_nogo_without_force(self, tmp_path):
        charter = _make_charter(tmp_path, verdict="go")
        result = _run("--file", str(charter), "--verdict", "no-go")
        assert result.returncode == 1
        assert "force" in result.stderr.lower() or "flip" in result.stderr.lower()

    def test_reject_nogo_to_go_without_force(self, tmp_path):
        charter = _make_charter(tmp_path, verdict="no-go")
        result = _run("--file", str(charter), "--verdict", "go")
        assert result.returncode == 1

    def test_allow_go_to_nogo_with_force(self, tmp_path):
        charter = _make_charter(tmp_path, verdict="go")
        result = _run("--file", str(charter), "--verdict", "no-go", "--force")
        assert result.returncode == 0, result.stderr
        fm = _read_fm(charter)
        assert fm["verdict"] == "no-go"

    def test_allow_null_to_any_verdict(self, tmp_path):
        """No existing verdict → any target is fine."""
        for v in ("go", "no-go", "conditional"):
            charter = _make_charter(tmp_path, name=f"charter-{v}")
            result = _run("--file", str(charter), "--verdict", v)
            assert result.returncode == 0, f"verdict={v}: {result.stderr}"

    def test_allow_conditional_to_go(self, tmp_path):
        """conditional → go is allowed without --force (re-deciding after precondition)."""
        charter = _make_charter(tmp_path, verdict="conditional")
        result = _run("--file", str(charter), "--verdict", "go")
        assert result.returncode == 0, result.stderr

    def test_allow_conditional_to_nogo(self, tmp_path):
        charter = _make_charter(tmp_path, verdict="conditional")
        result = _run("--file", str(charter), "--verdict", "no-go")
        assert result.returncode == 0, result.stderr


# ---------------------------------------------------------------------------
# Dry-run behaviour
# ---------------------------------------------------------------------------

class TestDryRun:
    def test_dry_run_prints_diff_does_not_write(self, tmp_path):
        charter = _make_charter(tmp_path, status="draft")
        original_content = charter.read_text(encoding="utf-8")
        result = _run(
            "--file", str(charter),
            "--status", "in-progress",
            "--dry-run",
        )
        assert result.returncode == 0, result.stderr
        # Content must be unchanged
        assert charter.read_text(encoding="utf-8") == original_content
        # Output must mention the transition
        combined = result.stdout + result.stderr
        assert "draft" in combined or "in-progress" in combined

    def test_dry_run_json_flag(self, tmp_path):
        charter = _make_charter(tmp_path, status="draft")
        result = _run(
            "--file", str(charter),
            "--status", "in-progress",
            "--dry-run",
            "--json",
        )
        assert result.returncode == 0, result.stderr
        data = json.loads(result.stdout)
        assert data["dry_run"] is True
        assert "status" in data["changes"]

    def test_dry_run_still_validates(self, tmp_path):
        """Dry-run should still enforce invariants (reject concluded without verdict)."""
        charter = _make_charter(tmp_path, status="in-progress")
        result = _run(
            "--file", str(charter),
            "--status", "concluded",
            "--dry-run",
            # no --verdict
        )
        assert result.returncode == 1


# ---------------------------------------------------------------------------
# Unknown doc_type rejection
# ---------------------------------------------------------------------------

class TestUnknownDocType:
    def test_reject_prd_doc_type(self, tmp_path):
        fm = {
            "doc_type": "prd",
            "title": "Some PRD",
            "status": "draft",
        }
        p = tmp_path / "some-prd.md"
        p.write_text(
            "---\n" + yaml.safe_dump(fm) + "---\n# PRD\n",
            encoding="utf-8",
        )
        result = _run("--file", str(p), "--status", "in-progress")
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "unsupported" in combined.lower() or "exploration_charter" in combined.lower()

    def test_reject_report_without_feasibility_category(self, tmp_path):
        fm = {
            "doc_type": "report",
            "report_category": "post-mortem",
            "title": "Some Report",
            "status": "draft",
        }
        p = tmp_path / "report.md"
        p.write_text(
            "---\n" + yaml.safe_dump(fm) + "---\n# Report\n",
            encoding="utf-8",
        )
        result = _run("--file", str(p), "--status", "in-progress")
        assert result.returncode == 1


# ---------------------------------------------------------------------------
# JSON output mode
# ---------------------------------------------------------------------------

class TestJsonOutput:
    def test_json_output_on_success(self, tmp_path):
        charter = _make_charter(tmp_path, status="draft")
        result = _run(
            "--file", str(charter),
            "--status", "in-progress",
            "--json",
        )
        assert result.returncode == 0, result.stderr
        data = json.loads(result.stdout)
        assert data["kind"] == "charter"
        assert "status" in data["changes"]

    def test_json_output_on_error(self, tmp_path):
        charter = _make_charter(tmp_path, status="in-progress")
        result = _run(
            "--file", str(charter),
            "--status", "concluded",
            "--json",
            # no verdict → should error
        )
        assert result.returncode == 1
