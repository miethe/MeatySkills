"""Tests for `_frontmatter_edit.py` and the two writers that use it.

The defect these guard (`node_01KZCBKGQCJCBMZRS4T0SCTT7N`): `update-field.py --set` and
`manage-plan-status.py --status` mutated a parsed dict and re-emitted the WHOLE frontmatter
block through `yaml.safe_dump`. A one-line status change produced a 29-insertion /
16-deletion diff with five classes of regression in keys the caller never named — escaped
em-dash, requoted bare date, flattened list indentation, re-quoted/hard-wrapped list items,
and (found while reproducing, not in the original report) a folded block scalar collapsed
onto one line.

None of those is caught by a validator, because each is valid YAML that parses back to an
equivalent object. The cost is that the diff stops being evidence: a reviewer cannot cheaply
confirm a bookkeeping commit is only bookkeeping.

So the load-bearing assertion here is `assert_only_changed` — untouched lines must be
BYTE-identical, not merely semantically equivalent. Anything weaker passes against the very
bug this file exists to prevent.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Iterable

import pytest
import yaml

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

import _frontmatter_edit as fe  # noqa: E402

UPDATE_FIELD = SCRIPTS / "update-field.py"
MANAGE_STATUS = SCRIPTS / "manage-plan-status.py"


# --------------------------------------------------------------------------- #
# Fixtures — one document carrying every shape that regressed
# --------------------------------------------------------------------------- #

PLAN = """\
---
it_schema: 1
schema_version: 2
feature_slug: claude5-plan-doctrine-v1
title: "Claude-5 Plan Doctrine v1 — rollout"
description: A plan with an em-dash, a bare date, and indented lists.
doc_type: implementation_plan
status: in_progress
tier: 2
priority: P2
points: 6
created: 2026-07-30
updated: 2026-08-01
related_documents:
  - docs/project_plans/PRDs/foo.md
  - docs/project_plans/SPIKEs/bar.md
acceptance_criteria:
  - "demotions land: the doctrine is demoted and the completion report retired"
  - plain item
long_note: >
  a folded scalar
  spanning lines
---

# Body

text
"""


def write_plan(tmp_path: Path, text: str = PLAN, name: str = "plan.md") -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def run(script: Path, path: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(script), "-f", str(path), *args],
                          capture_output=True, text=True)


def assert_only_changed(before: str, after: str, keys: Iterable[str]) -> None:
    """Every changed frontmatter line must belong to one of *keys*.

    Byte-level on purpose. A semantic comparison (parse both, compare dicts) is exactly the
    check that reported the original bug as clean.
    """
    allowed = set(keys)
    before_fm = before.split("\n---\n")[0].split("\n")
    after_fm = after.split("\n---\n")[0].split("\n")

    changed: list[str] = []
    owner: str | None = None
    for line in [ln for ln in after_fm if ln not in before_fm] + \
                [ln for ln in before_fm if ln not in after_fm]:
        changed.append(line)

    # Attribute each changed line to the key whose block it sits in.
    for source in (before_fm, after_fm):
        owner = None
        for line in source:
            match = fe._TOP_KEY_RE.match(line)
            if match:
                owner = match.group("key")
            if line in changed and owner not in allowed:
                raise AssertionError(
                    f"line from an untouched key ({owner!r}) changed: {line!r}\n"
                    f"allowed keys: {sorted(allowed)}")

    assert before.split("\n---\n", 1)[1] == after.split("\n---\n", 1)[1], "body changed"


# --------------------------------------------------------------------------- #
# The five regression classes, end to end through update-field.py
# --------------------------------------------------------------------------- #

def test_set_a_new_key_touches_only_that_key_and_updated(tmp_path):
    """AC1: the exact repro from the finding — a 1-line intent must be a 1-line diff."""
    path = write_plan(tmp_path)
    before = path.read_text(encoding="utf-8")

    result = run(UPDATE_FIELD, path, "--set", "planning_maturity=shipped")

    assert result.returncode == 0, result.stderr
    after = path.read_text(encoding="utf-8")
    assert_only_changed(before, after, {"planning_maturity", "updated"})
    assert "planning_maturity: shipped" in after


def test_em_dash_survives_a_round_trip(tmp_path):
    """AC2: `—` must not become `\\u2014` — valid YAML, but every rendered surface shows it."""
    path = write_plan(tmp_path)
    run(UPDATE_FIELD, path, "--set", "planning_maturity=shipped")

    after = path.read_text(encoding="utf-8")
    assert 'title: "Claude-5 Plan Doctrine v1 — rollout"' in after
    assert "\\u2014" not in after


def test_a_bare_date_is_not_requoted_by_an_unrelated_set(tmp_path):
    """AC3: `created: 2026-07-30` is untouched by a write that never named it."""
    path = write_plan(tmp_path)
    run(UPDATE_FIELD, path, "--set", "planning_maturity=shipped")

    assert "created: 2026-07-30" in path.read_text(encoding="utf-8")


def test_untouched_list_indentation_and_quoting_are_byte_identical(tmp_path):
    """AC4: indentation AND per-item quoting style, not just the parsed values."""
    path = write_plan(tmp_path)
    run(UPDATE_FIELD, path, "--set", "planning_maturity=shipped")

    after = path.read_text(encoding="utf-8")
    assert "  - docs/project_plans/PRDs/foo.md" in after
    assert "\n- docs/project_plans/PRDs/foo.md" not in after      # not flattened
    assert '  - "demotions land: the doctrine is demoted and the completion report retired"' in after


def test_a_folded_block_scalar_is_not_collapsed(tmp_path):
    """The fifth regression, found while reproducing and absent from the original report."""
    path = write_plan(tmp_path)
    run(UPDATE_FIELD, path, "--set", "planning_maturity=shipped")

    after = path.read_text(encoding="utf-8")
    assert "long_note: >\n  a folded scalar\n  spanning lines\n" in after


def test_updated_keeps_the_files_bare_date_style(tmp_path):
    """`updated` is touched by every write, so its STYLE must not flip on the first one."""
    path = write_plan(tmp_path)
    run(UPDATE_FIELD, path, "--set", "planning_maturity=shipped")

    after = path.read_text(encoding="utf-8")
    assert "updated: 2026-08-" in after
    assert "updated: '" not in after


def test_updated_keeps_quotes_when_the_file_already_quoted_it(tmp_path):
    """The converse: a file that quotes its dates must not be un-quoted either."""
    path = write_plan(tmp_path, PLAN.replace("updated: 2026-08-01", "updated: '2026-08-01'"))
    run(UPDATE_FIELD, path, "--set", "planning_maturity=shipped")

    assert "updated: '2026-08-" in path.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# AC5 — manage-plan-status.py shows the same behaviour
# --------------------------------------------------------------------------- #

def test_manage_plan_status_edits_the_status_value_in_place(tmp_path):
    path = write_plan(tmp_path)
    before = path.read_text(encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(MANAGE_STATUS), "-f", str(path), "--status", "completed"],
        capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
    after = path.read_text(encoding="utf-8")
    assert_only_changed(before, after, {"status", "updated"})
    assert "status: completed" in after


def test_manage_plan_status_field_update_is_also_in_place(tmp_path):
    path = write_plan(tmp_path)
    before = path.read_text(encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(MANAGE_STATUS), "-f", str(path),
         "--field", "priority", "--value", "P1"],
        capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
    after = path.read_text(encoding="utf-8")
    assert_only_changed(before, after, {"priority", "updated"})
    assert "priority: P1" in after


def test_manage_plan_status_reports_the_resolved_status_not_the_alias(tmp_path):
    """`shipped` is an alias for `completed`; the printed transition must show what landed."""
    path = write_plan(tmp_path)
    result = subprocess.run(
        [sys.executable, str(MANAGE_STATUS), "-f", str(path), "--status", "shipped"],
        capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
    assert "in_progress -> completed" in result.stdout
    assert "status: completed" in path.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# --append
# --------------------------------------------------------------------------- #

def test_append_lands_at_the_existing_blocks_indentation(tmp_path):
    path = write_plan(tmp_path)
    before = path.read_text(encoding="utf-8")

    result = run(UPDATE_FIELD, path, "--append", "related_documents=docs/x.md")

    assert result.returncode == 0, result.stderr
    after = path.read_text(encoding="utf-8")
    assert_only_changed(before, after, {"related_documents", "updated"})
    assert "  - docs/project_plans/SPIKEs/bar.md\n  - docs/x.md\n" in after


def test_append_to_a_flow_list_stays_flow(tmp_path):
    """`tags: [a, b]` must not be expanded into a block list just to add one entry."""
    path = write_plan(tmp_path, PLAN.replace(
        "points: 6", "points: 6\ntags: [tooling, frontmatter]"))

    result = run(UPDATE_FIELD, path, "--append", "tags=yaml")

    assert result.returncode == 0, result.stderr
    assert "tags: [tooling, frontmatter, yaml]" in path.read_text(encoding="utf-8")


def test_append_creates_a_missing_list_at_the_files_own_indentation(tmp_path):
    path = write_plan(tmp_path)

    result = run(UPDATE_FIELD, path, "--append", "pr_refs=#87")

    assert result.returncode == 0, result.stderr
    after = path.read_text(encoding="utf-8")
    assert "pr_refs:\n  - '#87'\n" in after, after
    assert yaml.safe_load(after.split("\n---\n")[0].lstrip("-\n"))["pr_refs"] == ["#87"]


def test_append_to_a_scalar_field_is_refused(tmp_path):
    path = write_plan(tmp_path)
    before = path.read_text(encoding="utf-8")

    result = run(UPDATE_FIELD, path, "--append", "title=nope")

    assert result.returncode == 1
    assert "not a list" in result.stderr
    assert path.read_text(encoding="utf-8") == before


def test_append_fills_a_key_declared_with_no_items(tmp_path):
    path = write_plan(tmp_path, PLAN.replace("points: 6", "points: 6\npr_refs:"))

    result = run(UPDATE_FIELD, path, "--append", "pr_refs=#87")

    assert result.returncode == 0, result.stderr
    assert "pr_refs:\n  - '#87'\n" in path.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# Module-level behaviour that the CLI paths do not reach
# --------------------------------------------------------------------------- #

def editor(text: str = PLAN) -> fe.FrontmatterEditor:
    ed = fe.FrontmatterEditor.from_text(text)
    assert ed is not None
    return ed


def test_from_text_rejects_a_file_with_no_frontmatter():
    assert fe.FrontmatterEditor.from_text("# just a heading\n") is None
    assert fe.FrontmatterEditor.from_text("---\nunterminated: true\n") is None


def test_render_round_trips_an_unedited_document_byte_for_byte():
    """The strongest form of the guarantee: no edit, no change at all."""
    assert editor().render() == PLAN


def test_set_preserves_the_quote_style_of_the_value_it_replaces():
    ed = editor(PLAN.replace("status: in_progress", 'status: "in_progress"'))
    ed.set("status", "completed")
    assert 'status: "completed"' in ed.render()


def test_set_preserves_a_trailing_comment_on_the_line_it_edits():
    ed = editor(PLAN.replace("status: in_progress", "status: in_progress  # set by the gate"))
    ed.set("status", "completed")
    assert "status: completed  # set by the gate" in ed.render()


def test_a_hash_inside_a_quoted_value_is_not_read_as_a_comment():
    ed = editor(PLAN.replace("status: in_progress", "status: 'in_progress # not a comment'"))
    ed.set("tier", 3)
    assert "status: 'in_progress # not a comment'" in ed.render()


def test_set_replaces_a_whole_multi_line_block_when_it_targets_it():
    ed = editor()
    ed.set("related_documents", ["docs/only.md"])
    rendered = ed.render()
    assert "related_documents:\n  - docs/only.md\n" in rendered
    assert "foo.md" not in rendered
    assert "acceptance_criteria:" in rendered          # the NEXT key survived intact


def test_set_can_replace_a_block_scalar_the_caller_names():
    ed = editor()
    ed.set("long_note", "now a plain scalar")
    rendered = ed.render()
    assert "long_note: now a plain scalar\n" in rendered
    assert "a folded scalar" not in rendered
    assert rendered.endswith("---\n\n# Body\n\ntext\n")  # block end not swallowed


def test_a_new_key_lands_above_a_trailing_comment_not_below_it():
    ed = editor(PLAN.replace("---\n\n# Body", "# trailing note\n---\n\n# Body"))
    ed.set("planning_maturity", "shipped")
    assert "planning_maturity: shipped\n# trailing note\n---" in ed.render()


def test_a_column_zero_comment_between_items_stays_inside_its_block():
    text = PLAN.replace(
        "  - docs/project_plans/SPIKEs/bar.md\n",
        "# why this one\n  - docs/project_plans/SPIKEs/bar.md\n")
    ed = editor(text)
    ed.set("related_documents", ["docs/only.md"])
    rendered = ed.render()
    assert "# why this one" not in rendered      # it belonged to the replaced block
    assert "acceptance_criteria:" in rendered


def test_an_indentless_list_keeps_its_column_zero_style_on_append():
    text = PLAN.replace(
        "related_documents:\n  - docs/project_plans/PRDs/foo.md\n"
        "  - docs/project_plans/SPIKEs/bar.md\n",
        "related_documents:\n- docs/project_plans/PRDs/foo.md\n")
    ed = editor(text)
    ed.append("related_documents", "docs/x.md")
    assert "related_documents:\n- docs/project_plans/PRDs/foo.md\n- docs/x.md\n" in ed.render()


def test_a_unicode_value_is_written_literally_not_escaped():
    ed = editor()
    ed.set("title", "A — B")
    # The double quotes come from the line being replaced, which was already quoted.
    assert 'title: "A — B"\n' in ed.render()
    assert "\\u2014" not in ed.render()


def test_a_unicode_value_added_to_an_unquoted_key_needs_no_quotes():
    ed = editor()
    ed.set("summary", "A — B")
    assert "summary: A — B\n" in ed.render()
    assert "\\u2014" not in ed.render()


def test_a_long_value_is_not_hard_wrapped():
    long_value = "x " * 120
    ed = editor()
    ed.append("acceptance_criteria", long_value.strip())
    line = [ln for ln in ed.render().split("\n") if ln.strip().startswith("- x x")][0]
    assert len(line) > 200, "the value was wrapped across lines"


def test_a_date_value_is_written_bare():
    from datetime import date
    ed = editor()
    ed.set("created", date(2026, 8, 6))
    assert "created: 2026-08-06\n" in ed.render()


def test_metadata_matches_a_full_file_parse_when_the_last_key_is_a_block_scalar():
    """A trailing block scalar's value must not lose its newline to the extraction boundary.

    Found while sweeping the real corpus: `scope: >` as the final key parsed one way from the
    frontmatter slice and another way from the whole file, so the object being schema-validated
    was not the object the file contains.
    """
    text = "---\ntitle: t\nscope: >\n  folded text\n---\n\nbody\n"
    ed = editor(text)
    whole_file = yaml.safe_load(text.split("---\n")[1])
    assert ed.metadata()["scope"] == whole_file["scope"] == "folded text\n"

    # ...and appending a key after that block leaves the value untouched.
    ed.set("updated", "2026-08-06")
    assert ed.metadata()["scope"] == "folded text\n"


def test_metadata_reflects_edits_without_a_write():
    ed = editor()
    ed.set("planning_maturity", "shipped")
    ed.append("related_documents", "docs/x.md")
    data = ed.metadata()
    assert data["planning_maturity"] == "shipped"
    assert data["related_documents"][-1] == "docs/x.md"
    assert data["title"] == "Claude-5 Plan Doctrine v1 — rollout"


def test_normalize_scalars_renders_dates_as_iso_strings_for_validation_only():
    from datetime import date
    assert fe.normalize_scalars({"a": date(2026, 8, 6), "b": [date(2026, 1, 1)]}) == \
        {"a": "2026-08-06", "b": ["2026-01-01"]}


@pytest.mark.parametrize("rest,expected", [
    (" value", (" ", "value", "")),
    (" value  # note", (" ", "value", "  # note")),
    ("", ("", "", "")),
    (" 'a # b'", (" ", "'a # b'", "")),
    (' "a#b" # real', (" ", '"a#b"', " # real")),
    (" >", (" ", ">", "")),
])
def test_split_value_and_comment(rest, expected):
    assert fe._split_value_and_comment(rest) == expected


def test_the_validated_object_is_what_lands_on_disk(tmp_path):
    """No drift between the object update-field validates and the file it writes.

    The old code validated a separately-mutated dict; this asserts the two cannot diverge.
    """
    path = write_plan(tmp_path)
    run(UPDATE_FIELD, path, "--set", "planning_maturity=shipped",
        "--append", "related_documents=docs/x.md")

    text = path.read_text(encoding="utf-8")
    data = yaml.safe_load(text.split("\n---\n")[0].lstrip("-\n"))
    assert data["planning_maturity"] == "shipped"
    assert data["related_documents"] == [
        "docs/project_plans/PRDs/foo.md", "docs/project_plans/SPIKEs/bar.md", "docs/x.md"]
    assert data["title"] == "Claude-5 Plan Doctrine v1 — rollout"
    assert str(data["created"]) == "2026-07-30"
