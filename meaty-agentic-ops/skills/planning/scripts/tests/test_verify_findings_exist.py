#!/usr/bin/env python3
"""
Tests for verify-findings-exist.py — the fail-closed gate that checks every
findings_path cited by an explore/spike synthesis actually exists on disk
before verdict sign-off (see explore-spike-workflow-spec.md §6).
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).parent.parent
SCRIPT = SCRIPTS_DIR / "verify-findings-exist.py"


def _run(*args: str, input: str = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        input=input,
    )


def _write(path: Path, size: int) -> Path:
    """Write a file with exactly `size` bytes of content."""
    path.write_bytes(b"x" * size)
    return path


def _synthesis_envelope(entries: list, legs_run: int = None) -> dict:
    """Build a minimal workflow return envelope wrapping investigation_summary.

    `legs_run` is omitted from the envelope unless explicitly given, matching
    the real shape produced by explore.js/spike.js (legs_run is a top-level
    sibling of `synthesis`, not nested inside it).
    """
    envelope = {
        "status": "needs_opus",
        "reason": "verdict_signoff",
        "synthesis": {"investigation_summary": entries},
    }
    if legs_run is not None:
        envelope["legs_run"] = legs_run
    return envelope


# ---------------------------------------------------------------------------
# --paths mode
# ---------------------------------------------------------------------------


class TestExplicitPaths:
    def test_all_ok_passes(self, tmp_path):
        f1 = _write(tmp_path / "a.md", 250)
        f2 = _write(tmp_path / "b.md", 300)
        result = _run("--paths", str(f1), str(f2))
        assert result.returncode == 0, result.stdout + result.stderr
        assert "GATE PASSED" in result.stdout

    def test_one_missing_fails(self, tmp_path):
        f1 = _write(tmp_path / "a.md", 250)
        missing = tmp_path / "does-not-exist.md"
        result = _run("--paths", str(f1), str(missing))
        assert result.returncode == 1, result.stdout + result.stderr
        assert "GATE FAILED" in result.stdout
        assert "MISSING" in result.stdout

    def test_one_empty_fails(self, tmp_path):
        f1 = _write(tmp_path / "a.md", 250)
        empty = _write(tmp_path / "empty.md", 0)
        result = _run("--paths", str(f1), str(empty))
        assert result.returncode == 1, result.stdout + result.stderr
        assert "GATE FAILED" in result.stdout
        assert "EMPTY" in result.stdout

    def test_thin_passes_with_warning(self, tmp_path):
        thin = _write(tmp_path / "thin.md", 42)
        result = _run("--paths", str(thin))
        assert result.returncode == 0, result.stdout + result.stderr
        assert "GATE PASSED" in result.stdout
        assert "WARNING" in result.stdout
        assert "THIN" in result.stdout

    def test_empty_input_list_passes(self):
        result = _run("--paths")
        assert result.returncode == 0, result.stdout + result.stderr
        assert "nothing to verify" in result.stdout
        assert "GATE PASSED" in result.stdout
        assert "nothing was checked" in result.stdout
        # Message must be non-vacuous: never claim paths resolved when 0 were checked.
        assert "every findings_path resolves" not in result.stdout

    def test_directory_is_missing(self, tmp_path):
        d = tmp_path / "a-directory"
        d.mkdir()
        result = _run("--paths", str(d))
        assert result.returncode == 1
        assert "MISSING" in result.stdout

    def test_relative_path_resolved_against_root(self, tmp_path):
        sub = tmp_path / "findings"
        sub.mkdir()
        _write(sub / "leg-a.md", 250)
        result = _run("--root", str(tmp_path), "--paths", "findings/leg-a.md")
        assert result.returncode == 0, result.stdout + result.stderr
        assert "GATE PASSED" in result.stdout

    def test_relative_path_missing_without_correct_root(self, tmp_path):
        sub = tmp_path / "findings"
        sub.mkdir()
        _write(sub / "leg-a.md", 250)
        # No --root given: resolves against cwd, not tmp_path, so it's MISSING.
        result = _run("--paths", "findings/leg-a.md")
        assert result.returncode == 1
        assert "MISSING" in result.stdout

    def test_json_output_structure(self, tmp_path):
        f1 = _write(tmp_path / "a.md", 250)
        missing = tmp_path / "gone.md"
        result = _run("--paths", str(f1), str(missing), "--json")
        assert result.returncode == 1
        data = json.loads(result.stdout)
        assert data["gate_passed"] is False
        assert data["checked"] == 2
        statuses = {e["status"] for e in data["entries"]}
        assert statuses == {"OK", "MISSING"}


# ---------------------------------------------------------------------------
# --synthesis-json mode
# ---------------------------------------------------------------------------


class TestSynthesisJson:
    def test_all_ok_from_envelope(self, tmp_path):
        f1 = _write(tmp_path / "leg-a-findings.md", 250)
        f2 = _write(tmp_path / "leg-b-findings.md", 300)
        envelope = _synthesis_envelope(
            [
                {
                    "leg_id": "tech",
                    "findings_path": str(f1),
                    "conclusion": "x",
                    "confidence": 0.8,
                },
                {
                    "leg_id": "value",
                    "findings_path": str(f2),
                    "conclusion": "y",
                    "confidence": 0.7,
                },
            ]
        )
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 0, result.stdout + result.stderr
        assert "GATE PASSED" in result.stdout

    def test_missing_finding_from_envelope_fails(self, tmp_path):
        f1 = _write(tmp_path / "leg-a-findings.md", 250)
        envelope = _synthesis_envelope(
            [
                {"leg_id": "tech", "findings_path": str(f1)},
                {"leg_id": "risk", "findings_path": str(tmp_path / "never-written.md")},
            ]
        )
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 1, result.stdout + result.stderr
        assert "GATE FAILED" in result.stdout
        assert "risk" in result.stdout

    def test_bare_top_level_investigation_summary_accepted(self, tmp_path):
        f1 = _write(tmp_path / "leg-a-findings.md", 250)
        payload = {
            "investigation_summary": [{"leg_id": "tech", "findings_path": str(f1)}]
        }
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(payload), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 0, result.stdout + result.stderr

    def test_entry_missing_findings_path_field_fails(self, tmp_path):
        envelope = _synthesis_envelope(
            [{"leg_id": "tech", "conclusion": "no path at all"}]
        )
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 1
        assert "MISSING" in result.stdout

    def test_empty_investigation_summary_passes(self, tmp_path):
        envelope = _synthesis_envelope([])
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 0, result.stdout + result.stderr
        assert "nothing to verify" in result.stdout
        assert "nothing was checked" in result.stdout
        assert "every findings_path resolves" not in result.stdout

    def test_stdin_input(self, tmp_path):
        f1 = _write(tmp_path / "leg-a-findings.md", 250)
        envelope = _synthesis_envelope([{"leg_id": "tech", "findings_path": str(f1)}])
        result = _run("--synthesis-json", "-", input=json.dumps(envelope))
        assert result.returncode == 0, result.stdout + result.stderr

    def test_bad_json_exits_2(self, tmp_path):
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text("{not valid json::", encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 2, result.stdout + result.stderr
        assert "invalid JSON" in result.stderr

    def test_missing_investigation_summary_key_exits_2(self, tmp_path):
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(
            json.dumps({"status": "needs_opus"}), encoding="utf-8"
        )

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 2, result.stdout + result.stderr
        assert "investigation_summary" in result.stderr

    def test_synthesis_file_not_found_exits_2(self, tmp_path):
        result = _run("--synthesis-json", str(tmp_path / "nope.json"))
        assert result.returncode == 2
        assert "not found" in result.stderr

    def test_json_output_structure(self, tmp_path):
        f1 = _write(tmp_path / "leg-a-findings.md", 250)
        envelope = _synthesis_envelope([{"leg_id": "tech", "findings_path": str(f1)}])
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file), "--json")
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["gate_passed"] is True
        assert data["entries"][0]["leg_id"] == "tech"


# ---------------------------------------------------------------------------
# legs_run cross-check — closes the vacuous-pass hole: a synthesis asserting
# N legs ran while citing fewer than N findings paths must fail closed, even
# when every cited path is OK (or there are zero cited paths at all).
# ---------------------------------------------------------------------------


class TestLegsRunCrossCheck:
    def test_legs_run_with_zero_entries_fails(self, tmp_path):
        """The exact reported hole: legs_run=4, investigation_summary=[] must NOT pass."""
        envelope = _synthesis_envelope([], legs_run=4)
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 1, result.stdout + result.stderr
        assert "GATE FAILED" in result.stdout
        assert "4 leg(s) ran" in result.stdout
        assert "0 findings" in result.stdout
        # Never print the vacuous pass message alongside a real failure.
        assert "every findings_path resolves" not in result.stdout

    def test_legs_run_undercount_with_ok_entries_fails(self, tmp_path):
        """legs_run=4 but only 2 findings cited (both OK) — still an undercount failure."""
        f1 = _write(tmp_path / "leg-a.md", 250)
        f2 = _write(tmp_path / "leg-b.md", 300)
        envelope = _synthesis_envelope(
            [
                {"leg_id": "tech", "findings_path": str(f1)},
                {"leg_id": "value", "findings_path": str(f2)},
            ],
            legs_run=4,
        )
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 1, result.stdout + result.stderr
        assert "GATE FAILED" in result.stdout
        assert "4 leg(s) ran" in result.stdout
        assert "2 findings" in result.stdout
        assert "2 leg(s) contributed no evidence" in result.stdout

    def test_legs_run_matches_entry_count_passes(self, tmp_path):
        """legs_run=2 with exactly 2 OK entries — counts match, no undercount."""
        f1 = _write(tmp_path / "leg-a.md", 250)
        f2 = _write(tmp_path / "leg-b.md", 300)
        envelope = _synthesis_envelope(
            [
                {"leg_id": "tech", "findings_path": str(f1)},
                {"leg_id": "value", "findings_path": str(f2)},
            ],
            legs_run=2,
        )
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 0, result.stdout + result.stderr
        assert "GATE PASSED" in result.stdout

    def test_legs_run_absent_with_zero_entries_still_passes(self, tmp_path):
        """No legs_run field at all + zero entries — the cross-check does not apply."""
        envelope = _synthesis_envelope([])  # legs_run omitted entirely
        assert "legs_run" not in envelope
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 0, result.stdout + result.stderr
        assert "GATE PASSED" in result.stdout

    def test_legs_run_zero_is_treated_as_absent(self, tmp_path):
        """legs_run=0 explicitly present must not trigger the undercount check."""
        envelope = _synthesis_envelope([], legs_run=0)
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file))
        assert result.returncode == 0, result.stdout + result.stderr

    def test_legs_run_json_output_fields(self, tmp_path):
        envelope = _synthesis_envelope([], legs_run=4)
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(envelope), encoding="utf-8")

        result = _run("--synthesis-json", str(synthesis_file), "--json")
        assert result.returncode == 1
        data = json.loads(result.stdout)
        assert data["legs_run"] == 4
        assert data["legs_undercount"] is True
        assert data["gate_passed"] is False

    def test_paths_mode_has_no_legs_run_concept(self, tmp_path):
        """--paths mode never has a legs_run source; the cross-check never applies."""
        f1 = _write(tmp_path / "a.md", 250)
        result = _run("--paths", str(f1), "--json")
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["legs_run"] is None
        assert data["legs_undercount"] is False


# ---------------------------------------------------------------------------
# Usage errors
# ---------------------------------------------------------------------------


class TestUsageErrors:
    def test_neither_flag_exits_2(self):
        result = _run()
        assert result.returncode == 2

    def test_both_flags_exits_2(self, tmp_path):
        f1 = _write(tmp_path / "a.md", 250)
        synthesis_file = tmp_path / "synthesis.json"
        synthesis_file.write_text(json.dumps(_synthesis_envelope([])), encoding="utf-8")
        result = _run("--synthesis-json", str(synthesis_file), "--paths", str(f1))
        assert result.returncode == 2


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
