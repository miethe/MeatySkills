"""Tests for `update-field.py` — delta validation and `#`-safe value parsing.

Both behaviours here are PF-3 follow-up fixes (`node_01KZ1RQK3R…`). The observed failure
was that recording a landing pointer (`merge_commit`/`merge_branch`/`pr_refs`) on a plan
that predates `schema_version` was refused outright, so it got hand-edited instead —
friction at exactly the moment a run is trying to close out honestly.

Reproducing it turned up a second, worse defect the follow-up had misdiagnosed: the
value parser let YAML comment syntax eat the value, so `--append "pr_refs=#87"` stored
`None` and `--set "note=PR #87"` stored `'PR'`. Both SILENTLY. The follow-up blamed
"a list containing a null" for a null this parser had just created.

The guard that matters most is `test_an_edit_that_introduces_an_error_still_blocks`: a
looser validator must not become a way to author invalid frontmatter.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

SCRIPTS = Path(__file__).resolve().parents[1]
SCRIPT = SCRIPTS / "update-field.py"


def _load_module():
    """Import a hyphenated script by path (it is a CLI, not an importable module)."""
    spec = importlib.util.spec_from_file_location("update_field", SCRIPT)
    assert spec is not None and spec.loader is not None, f"cannot load {SCRIPT}"
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(SCRIPTS))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)
    return module


uf = _load_module()


# A plan that is valid EXCEPT that it predates `schema_version` — the exact corpus shape
# the papercut fired on.
PLAN_WITHOUT_SCHEMA_VERSION = """\
---
it_schema: 1
feature_slug: delivery-report-hosting-and-linking
title: Delivery-report hosting and linking
description: A plan that predates the schema_version key.
doc_type: implementation_plan
status: completed
tier: 2
priority: P2
points: 6
---

body
"""


def write_plan(tmp_path: Path, text: str = PLAN_WITHOUT_SCHEMA_VERSION) -> Path:
    path = tmp_path / "plan.md"
    path.write_text(text, encoding="utf-8")
    return path


def run_cli(path: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), "-f", str(path), *args],
                          capture_output=True, text=True)


def frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    _, _, rest = text.partition("---\n")
    block, _, _ = rest.partition("\n---")
    return yaml.safe_load(block)


# --------------------------------------------------------------------------- #
# parse_value — `#` must not silently destroy the value
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("raw,expected", [
    ("#87", "#87"),            # was None — a whole value eaten as a comment
    ("PR #87", "PR #87"),      # was 'PR'  — truncated at the `#`
    ("#", "#"),
    ("8555cf0", "8555cf0"),    # unaffected
    ("main", "main"),
    ("87", 87),                # real YAML typing still works
    ("true", True),
    ("[a, b]", ["a", "b"]),
    ("'#87'", "#87"),          # already-quoted stays a string
])
def test_parse_value_preserves_hash_values(raw, expected):
    assert uf.parse_value(raw) == expected


@pytest.mark.parametrize("raw", ["", "~", "null", "Null", "NULL"])
def test_explicitly_spelled_null_is_still_null(raw):
    """An explicit null is intent, not comment damage — it must survive as None."""
    assert uf.parse_value(raw) is None


# --------------------------------------------------------------------------- #
# partition_errors — counted, not set-differenced
# --------------------------------------------------------------------------- #

def test_partition_splits_introduced_from_pre_existing():
    introduced, pre_existing = uf.partition_errors(["old"], ["old", "new"])
    assert introduced == ["new"]
    assert pre_existing == ["old"]


def test_partition_counts_duplicates_so_a_second_bad_entry_is_caught():
    """Appending a second bad entry to an already-bad list must not read as pre-existing.

    The two errors have identical text, so a set difference would hide the new one.
    """
    introduced, pre_existing = uf.partition_errors(["bad"], ["bad", "bad"])
    assert introduced == ["bad"]
    assert pre_existing == ["bad"]


def test_partition_reports_nothing_when_the_edit_is_clean():
    assert uf.partition_errors(["old"], ["old"]) == ([], ["old"])


# --------------------------------------------------------------------------- #
# remediation — an actionable line, not a raw validator dump
# --------------------------------------------------------------------------- #

def test_remediation_names_the_missing_key():
    hint = uf.remediation_for("  [root] 'schema_version' is a required property")
    assert hint is not None
    assert "schema_version" in hint


def test_remediation_is_absent_when_we_have_no_advice():
    assert uf.remediation_for("[title] 'x' is too short") is None


# --------------------------------------------------------------------------- #
# end-to-end: the papercut, and the guard against over-loosening
# --------------------------------------------------------------------------- #

def test_landing_pointer_succeeds_on_a_schema_version_less_plan(tmp_path):
    """The AC: succeed, or print an actionable remediation — never a raw dump."""
    path = write_plan(tmp_path)
    result = run_cli(path, "--set", "merge_commit=8555cf0",
                     "--set", "merge_branch=main", "--append", "pr_refs=#87")

    assert result.returncode == 0, result.stderr
    data = frontmatter(path)
    assert data["merge_commit"] == "8555cf0"
    assert data["merge_branch"] == "main"
    assert data["pr_refs"] == ["#87"]          # not [None]

    # the pre-existing gap is still surfaced, with advice
    assert "schema_version" in result.stdout
    assert "fix:" in result.stdout


def test_an_edit_that_introduces_an_error_still_blocks(tmp_path):
    """The load-bearing guard: this must not become a way to author invalid frontmatter."""
    path = write_plan(tmp_path)
    before = path.read_text(encoding="utf-8")

    result = run_cli(path, "--set", "prd_ref=x")

    assert result.returncode == 1
    assert "introduces validation errors" in result.stderr
    assert path.read_text(encoding="utf-8") == before, "a blocked write must not touch the file"


def test_blocked_write_also_lists_pre_existing_errors_separately(tmp_path):
    """When it does block, it must not conflate the cause with unrelated pre-existing gaps."""
    path = write_plan(tmp_path)
    result = run_cli(path, "--set", "prd_ref=x")

    assert result.returncode == 1
    assert "pre-existing" in result.stderr
    assert "schema_version" in result.stderr


def test_strict_restores_the_old_refuse_everything_behaviour(tmp_path):
    path = write_plan(tmp_path)
    before = path.read_text(encoding="utf-8")

    result = run_cli(path, "--strict", "--set", "merge_commit=8555cf0")

    assert result.returncode == 1
    assert "pre-existing" in result.stderr
    assert "fix:" in result.stderr
    assert path.read_text(encoding="utf-8") == before


def test_a_clean_plan_writes_with_no_pre_existing_note(tmp_path):
    """No false noise on a plan that validates: the note only appears when it should."""
    path = write_plan(tmp_path, PLAN_WITHOUT_SCHEMA_VERSION.replace(
        "it_schema: 1\n", "it_schema: 1\nschema_version: 2\n"))

    result = run_cli(path, "--set", "merge_branch=main")

    assert result.returncode == 0, result.stderr
    assert "pre-existing" not in result.stdout
    assert frontmatter(path)["merge_branch"] == "main"
