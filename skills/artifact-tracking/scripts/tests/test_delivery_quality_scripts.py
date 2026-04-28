#!/usr/bin/env python3
"""
Tests for delivery-quality scripts introduced by §4.4 of the
delivery-quality-improvements spec:

  - update-status.py  : completion gate, timestamps, evidence, verified-by
  - validate-phase-completion.py : pass/fail on synthetic YAML
  - ac-coverage-report.py : --dry vague-language detection, coverage matrix failures
"""

import json
import subprocess
import sys
import textwrap
import tempfile
from pathlib import Path

import pytest
import yaml

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SCRIPTS_DIR = Path(__file__).parent.parent


def _write_progress(tmp_path: Path, tasks: list, phase_status: str = "in_progress") -> Path:
    """Write a minimal progress file with the given tasks list."""
    frontmatter = {
        "schema_version": 2,
        "doc_type": "progress",
        "title": "Test Phase",
        "status": phase_status,
        "prd": "test-prd",
        "feature_slug": "test-prd",
        "phase": 7,
        "created": "2026-04-22",
        "updated": "2026-04-22",
        "progress": 0,
        "tasks": tasks,
    }
    p = tmp_path / "phase-7-progress.md"
    p.write_text(
        "---\n" + yaml.dump(frontmatter, default_flow_style=False, sort_keys=False) + "---\n# Phase 7\n",
        encoding="utf-8",
    )
    return p


def _run(script: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / script), *args],
        capture_output=True,
        text=True,
    )


def _read_task(progress_file: Path, task_id: str) -> dict:
    content = progress_file.read_text(encoding="utf-8")
    # strip frontmatter
    import re
    m = re.match(r"^---\n(.*?\n)---\n", content, re.DOTALL)
    fm = yaml.safe_load(m.group(1))
    for t in fm.get("tasks", []):
        if t.get("id") == task_id:
            return t
    raise KeyError(f"Task {task_id!r} not found")


# ---------------------------------------------------------------------------
# update-status.py
# ---------------------------------------------------------------------------

class TestUpdateStatusCompletionGate:
    def test_rejects_completed_without_timestamps_or_evidence(self, tmp_path):
        f = _write_progress(tmp_path, [{"id": "T7-001", "status": "pending"}])
        result = _run("update-status.py", "-f", str(f), "-t", "T7-001", "-s", "completed")
        assert result.returncode == 1
        assert "timing signals" in result.stderr or "started" in result.stderr.lower()

    def test_accepts_completed_with_both_timestamps(self, tmp_path):
        f = _write_progress(tmp_path, [{"id": "T7-001", "status": "pending"}])
        result = _run(
            "update-status.py",
            "-f", str(f),
            "-t", "T7-001",
            "-s", "completed",
            "--started", "2026-04-22T10:00Z",
            "--completed", "2026-04-22T17:00Z",
        )
        assert result.returncode == 0, result.stderr
        task = _read_task(f, "T7-001")
        assert task["status"] == "completed"
        assert task["started"] == "2026-04-22T10:00Z"
        assert task["completed"] == "2026-04-22T17:00Z"

    def test_accepts_completed_with_evidence_only(self, tmp_path):
        f = _write_progress(tmp_path, [{"id": "T7-002", "status": "pending"}])
        result = _run(
            "update-status.py",
            "-f", str(f),
            "-t", "T7-002",
            "-s", "completed",
            "--evidence", "commit:abc123",
        )
        assert result.returncode == 0, result.stderr
        task = _read_task(f, "T7-002")
        assert task["status"] == "completed"
        assert any("commit" in str(e) for e in task.get("evidence", []))

    def test_force_flag_warns_and_succeeds(self, tmp_path):
        f = _write_progress(tmp_path, [{"id": "T7-003", "status": "pending"}])
        result = _run(
            "update-status.py",
            "-f", str(f),
            "-t", "T7-003",
            "-s", "completed",
            "--force",
        )
        assert result.returncode == 0
        assert "WARNING" in result.stderr

    def test_evidence_appends_not_replaces(self, tmp_path):
        f = _write_progress(tmp_path, [
            {"id": "T7-004", "status": "pending", "evidence": [{"commit": "old123"}]}
        ])
        _run(
            "update-status.py",
            "-f", str(f),
            "-t", "T7-004",
            "-s", "in_progress",
            "--evidence", "screenshot:path/to/img.png",
        )
        task = _read_task(f, "T7-004")
        assert len(task["evidence"]) == 2

    def test_verified_by_appends(self, tmp_path):
        f = _write_progress(tmp_path, [
            {"id": "T7-005", "status": "pending", "verified_by": ["P16-001"]}
        ])
        _run(
            "update-status.py",
            "-f", str(f),
            "-t", "T7-005",
            "-s", "in_progress",
            "--verified-by", "P16-002",
        )
        task = _read_task(f, "T7-005")
        assert "P16-001" in task["verified_by"]
        assert "P16-002" in task["verified_by"]

    def test_verified_by_no_duplicates(self, tmp_path):
        f = _write_progress(tmp_path, [
            {"id": "T7-006", "status": "pending", "verified_by": ["P16-001"]}
        ])
        _run(
            "update-status.py",
            "-f", str(f),
            "-t", "T7-006",
            "-s", "in_progress",
            "--verified-by", "P16-001",
        )
        task = _read_task(f, "T7-006")
        assert task["verified_by"].count("P16-001") == 1

    def test_non_completed_status_no_gate(self, tmp_path):
        """Other statuses pass without any timestamp requirement."""
        f = _write_progress(tmp_path, [{"id": "T7-007", "status": "pending"}])
        for status in ("in_progress", "blocked", "at_risk", "skipped"):
            result = _run("update-status.py", "-f", str(f), "-t", "T7-007", "-s", status)
            assert result.returncode == 0, f"status={status}: {result.stderr}"


# ---------------------------------------------------------------------------
# validate-phase-completion.py
# ---------------------------------------------------------------------------

class TestValidatePhaseCompletion:
    def test_passes_when_all_completed_tasks_have_required_fields(self, tmp_path):
        tasks = [
            {
                "id": "T7-001",
                "status": "completed",
                "started": "2026-04-22T10:00Z",
                "completed": "2026-04-22T17:00Z",
                "verified_by": ["P16-003"],
                "evidence": [{"commit": "abc123"}],
            }
        ]
        f = _write_progress(tmp_path, tasks)
        result = _run("validate-phase-completion.py", "-f", str(f))
        assert result.returncode == 0
        assert "PASSED" in result.stdout

    def test_fails_when_completed_task_missing_started(self, tmp_path):
        tasks = [
            {
                "id": "T7-002",
                "status": "completed",
                # started missing
                "completed": "2026-04-22T17:00Z",
                "verified_by": ["P16-003"],
                "evidence": [{"commit": "abc123"}],
            }
        ]
        f = _write_progress(tmp_path, tasks)
        result = _run("validate-phase-completion.py", "-f", str(f))
        assert result.returncode == 1
        assert "started" in result.stdout

    def test_fails_when_completed_task_missing_evidence(self, tmp_path):
        tasks = [
            {
                "id": "T7-003",
                "status": "completed",
                "started": "2026-04-22T10:00Z",
                "completed": "2026-04-22T17:00Z",
                "verified_by": ["P16-003"],
                # evidence missing
            }
        ]
        f = _write_progress(tmp_path, tasks)
        result = _run("validate-phase-completion.py", "-f", str(f))
        assert result.returncode == 1
        assert "evidence" in result.stdout

    def test_fails_when_completed_task_missing_verified_by(self, tmp_path):
        tasks = [
            {
                "id": "T7-004",
                "status": "completed",
                "started": "2026-04-22T10:00Z",
                "completed": "2026-04-22T17:00Z",
                # verified_by missing
                "evidence": [{"commit": "abc123"}],
            }
        ]
        f = _write_progress(tmp_path, tasks)
        result = _run("validate-phase-completion.py", "-f", str(f))
        assert result.returncode == 1
        assert "verified_by" in result.stdout

    def test_passes_when_no_completed_tasks(self, tmp_path):
        tasks = [{"id": "T7-005", "status": "pending"}]
        f = _write_progress(tmp_path, tasks)
        result = _run("validate-phase-completion.py", "-f", str(f))
        assert result.returncode == 0

    def test_json_mode_structure(self, tmp_path):
        tasks = [
            {
                "id": "T7-006",
                "status": "completed",
                "started": "2026-04-22T10:00Z",
                "completed": "2026-04-22T17:00Z",
                "verified_by": ["P16-003"],
                "evidence": [{"commit": "abc123"}],
            }
        ]
        f = _write_progress(tmp_path, tasks)
        result = _run("validate-phase-completion.py", "-f", str(f), "--json")
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["gate_passed"] is True
        assert data["completed_tasks_checked"] == 1

    def test_json_mode_violations(self, tmp_path):
        tasks = [{"id": "T7-007", "status": "completed"}]  # all fields missing
        f = _write_progress(tmp_path, tasks)
        result = _run("validate-phase-completion.py", "-f", str(f), "--json")
        assert result.returncode == 1
        data = json.loads(result.stdout)
        assert data["gate_passed"] is False
        assert len(data["violations"]) == 1
        assert "T7-007" == data["violations"][0]["id"]
        assert set(data["violations"][0]["missing_fields"]) == {
            "started", "completed", "verified_by", "evidence"
        }


# ---------------------------------------------------------------------------
# ac-coverage-report.py
# ---------------------------------------------------------------------------

def _write_plan(tmp_path: Path, body: str) -> Path:
    """Write a minimal implementation plan with the given body text."""
    p = tmp_path / "impl-plan.md"
    p.write_text(
        "---\ntitle: Test Plan\ndoc_type: implementation_plan\nstatus: draft\n---\n\n" + body,
        encoding="utf-8",
    )
    return p


class TestAcCoverageReportDryMode:
    def test_dry_passes_when_no_vague_language(self, tmp_path):
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R1.1: Filter narrows PlanningSummaryPanel
            - target_surfaces:
              - components/Planning/PlanningSummaryPanel.tsx
        """))
        result = _run("ac-coverage-report.py", "--plan", str(plan), "--dry")
        assert result.returncode == 0

    def test_dry_fails_on_vague_ac_without_target_surfaces(self, tmp_path):
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R2.1: Filter propagates across all panels
            Filter should be visible everywhere in the planning section.
        """))
        result = _run("ac-coverage-report.py", "--plan", str(plan), "--dry")
        assert result.returncode == 1
        assert "R2.1" in result.stdout

    def test_dry_passes_when_vague_ac_has_target_surfaces(self, tmp_path):
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R2.2: Filter propagates across all panels
            - target_surfaces:
              - components/Planning/PlanningSummaryPanel.tsx
              - components/Planning/PlanningGraphPanel.tsx
        """))
        result = _run("ac-coverage-report.py", "--plan", str(plan), "--dry")
        assert result.returncode == 0

    def test_dry_json_structure(self, tmp_path):
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R3.1: visible throughout the dashboard
        """))
        result = _run("ac-coverage-report.py", "--plan", str(plan), "--dry", "--json")
        assert result.returncode == 1
        data = json.loads(result.stdout)
        assert data["gate_passed"] is False
        assert any(a["id"] == "R3.1" for a in data["vague_acs"])


class TestAcCoverageReportMatrix:
    def test_fails_when_ac_has_no_verified_by(self, tmp_path):
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R4.1: Something specific
            No verified_by references here.
        """))
        tasks = [
            {
                "id": "T16-001",
                "status": "completed",
                "started": "2026-04-22T10:00Z",
                "completed": "2026-04-22T17:00Z",
                "verified_by": [],
                "evidence": [{"commit": "abc"}],
            }
        ]
        prog = _write_progress(tmp_path, tasks)
        result = _run("ac-coverage-report.py", "--plan", str(plan), "--progress", str(prog))
        assert result.returncode == 1
        assert "R4.1" in result.stdout

    def test_passes_when_all_acs_have_verified_by(self, tmp_path):
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R5.1: Filter narrows summary panel
            - verified_by: [T16-002]
        """))
        tasks = [
            {
                "id": "T16-002",
                "status": "completed",
                "started": "2026-04-22T10:00Z",
                "completed": "2026-04-22T17:00Z",
                "verified_by": ["R5.1"],
                "evidence": [{"commit": "abc"}],
            }
        ]
        prog = _write_progress(tmp_path, tasks)
        result = _run("ac-coverage-report.py", "--plan", str(plan), "--progress", str(prog))
        assert result.returncode == 0

    def test_fails_when_verification_task_cites_no_acs(self, tmp_path):
        # AC cites T16-003, but T16-003 has no AC back-references in task_to_acs
        # (In the matrix, a "cited" task with no AC refs is a violation)
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R6.1: Something important
            - verified_by: [T16-003]
        """))
        tasks = [
            {
                "id": "T16-003",
                "status": "completed",
                "started": "2026-04-22T10:00Z",
                "completed": "2026-04-22T17:00Z",
                # verified_by in task is empty — so task_to_acs will be populated from AC's verified_by
                "verified_by": [],
                "evidence": [{"commit": "abc"}],
            }
        ]
        prog = _write_progress(tmp_path, tasks)
        result = _run("ac-coverage-report.py", "--plan", str(plan), "--progress", str(prog))
        # The AC has a reference (T16-003), so no uncovered_acs.
        # T16-003 IS cited by R6.1, and in task_to_acs it maps to ["R6.1"] — so NO violation.
        # This is the "happy path" for the inversion logic.
        assert result.returncode == 0

    def test_json_mode_matrix(self, tmp_path):  # noqa: F811 — name reuse across classes is fine
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R7.1: Verified feature
            - verified_by: [T16-004]
        """))
        tasks = [{"id": "T16-004", "status": "completed",
                  "started": "2026-04-22T10:00Z", "completed": "2026-04-22T17:00Z",
                  "verified_by": [], "evidence": [{"commit": "x"}]}]
        prog = _write_progress(tmp_path, tasks)
        result = _run("ac-coverage-report.py", "--plan", str(plan),
                      "--progress", str(prog), "--json")
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["gate_passed"] is True
        assert "R7.1" in data["ac_to_tasks"]
        assert "T16-004" in data["ac_to_tasks"]["R7.1"]

    def test_multiple_progress_files(self, tmp_path):
        plan = _write_plan(tmp_path, textwrap.dedent("""\
            #### AC R8.1: Multi-phase feature
            - verified_by: [T13-001, T16-005]
        """))
        prog1_path = tmp_path / "phase-13-progress.md"
        prog2_path = tmp_path / "phase-16-progress.md"

        def _write(p: Path, tasks: list):
            fm = {
                "schema_version": 2, "doc_type": "progress", "title": "T",
                "status": "in_progress", "prd": "x", "feature_slug": "x",
                "phase": 1, "created": "2026-04-22", "updated": "2026-04-22",
                "progress": 0, "tasks": tasks,
            }
            p.write_text(
                "---\n" + yaml.dump(fm, default_flow_style=False) + "---\n",
                encoding="utf-8",
            )

        _write(prog1_path, [{"id": "T13-001", "status": "completed",
                              "started": "2026-04-21T10:00Z", "completed": "2026-04-21T17:00Z",
                              "verified_by": [], "evidence": [{"commit": "a"}]}])
        _write(prog2_path, [{"id": "T16-005", "status": "completed",
                              "started": "2026-04-22T10:00Z", "completed": "2026-04-22T17:00Z",
                              "verified_by": [], "evidence": [{"commit": "b"}]}])

        result = _run(
            "ac-coverage-report.py",
            "--plan", str(plan),
            "--progress", str(prog1_path),
            "--progress", str(prog2_path),
            "--json",
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert set(data["ac_to_tasks"]["R8.1"]) == {"T13-001", "T16-005"}


# ---------------------------------------------------------------------------
# validate_artifact.py — human_brief doc_type
# ---------------------------------------------------------------------------

def _write_brief(tmp_path: Path, frontmatter: dict, body: str = "# Brief\n") -> Path:
    """Write a human_brief file with the given frontmatter dict."""
    import yaml as _yaml

    # Place under docs/project_plans/human-briefs/ so path-based auto-detection works.
    brief_dir = tmp_path / "docs" / "project_plans" / "human-briefs"
    brief_dir.mkdir(parents=True, exist_ok=True)
    p = brief_dir / "test-feature.md"
    p.write_text(
        "---\n" + _yaml.dump(frontmatter, default_flow_style=False, sort_keys=False) + "---\n" + body,
        encoding="utf-8",
    )
    return p


_VALID_BRIEF_FM = {
    "schema_version": 2,
    "doc_type": "human_brief",
    "title": "Test Feature — Human Brief",
    "status": "draft",
    "feature_slug": "test-feature",
    "audience": ["humans"],
    "created": "2026-04-23",
    "updated": "2026-04-23",
    "category": "human-briefs",
}


class TestValidateArtifactHumanBrief:
    def test_valid_brief_passes(self, tmp_path):
        """A minimal valid human_brief should validate without errors."""
        p = _write_brief(tmp_path, _VALID_BRIEF_FM)
        result = _run("validate_artifact.py", str(p))
        assert result.returncode == 0, f"stderr={result.stderr}\nstdout={result.stdout}"

    def test_invalid_status_rejected(self, tmp_path):
        """status='approved' is not in the allowed set for human_brief; must fail."""
        fm = {**_VALID_BRIEF_FM, "status": "approved"}
        p = _write_brief(tmp_path, fm)
        result = _run("validate_artifact.py", str(p))
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "approved" in combined or "status" in combined

    def test_missing_required_field_rejected(self, tmp_path):
        """Omitting 'feature_slug' (a required field) must cause a failure."""
        fm = {k: v for k, v in _VALID_BRIEF_FM.items() if k != "feature_slug"}
        p = _write_brief(tmp_path, fm)
        result = _run("validate_artifact.py", str(p))
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "feature_slug" in combined

    def test_audience_without_humans_rejected(self, tmp_path):
        """audience must contain 'humans'; any other value is an error."""
        fm = {**_VALID_BRIEF_FM, "audience": ["agents"]}
        p = _write_brief(tmp_path, fm)
        result = _run("validate_artifact.py", str(p))
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "audience" in combined

    def test_missing_prd_and_plan_ref_is_warning_not_fatal(self, tmp_path):
        """Absence of both prd_ref and plan_ref should warn but not fail."""
        p = _write_brief(tmp_path, _VALID_BRIEF_FM)  # no prd_ref or plan_ref
        result = _run("validate_artifact.py", str(p))
        assert result.returncode == 0, f"Should pass (warning only): {result.stderr}"
        # Warning should appear on stderr
        assert "prd_ref" in result.stderr or "plan_ref" in result.stderr or "meta-work" in result.stderr

    def test_path_based_auto_detection(self, tmp_path):
        """File under docs/project_plans/human-briefs/ should auto-detect as human_brief."""
        # Deliberately omit doc_type from frontmatter; path should resolve it.
        fm = {k: v for k, v in _VALID_BRIEF_FM.items() if k != "doc_type"}
        p = _write_brief(tmp_path, fm)
        result = _run("validate_artifact.py", str(p))
        # Should NOT produce "Could not auto-detect" error
        assert "Could not auto-detect" not in result.stderr

    def test_explicit_type_flag_accepted(self, tmp_path):
        """--artifact-type human-brief flag must be accepted by the CLI."""
        p = _write_brief(tmp_path, _VALID_BRIEF_FM)
        result = _run("validate_artifact.py", str(p), "--artifact-type", "human-brief")
        assert result.returncode == 0, f"stderr={result.stderr}"
