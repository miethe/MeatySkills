#!/usr/bin/env python3
"""
Regression checks for the SkillMeat look-first recipes documented in the
planning skill (SKILL.md + references/required-artifacts-guidance.md).

The recipes previously used `--json` (search/list only accept `--format json`)
and `list --project` (no such option), so they died with a click usage error
before any result was parsed.

- Static tests (always run): every documented `skillmeat search|list|show`
  command uses only flags from a snapshot of the current help surfaces.
- Live tests (skipped when `skillmeat` / `jq` are not on PATH): the flags are
  checked against the real `--help` output, and the documented recipes are
  executed and must reach result parsing (JSON / jq) without a usage error.
"""

import json
import re
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[5]
DOCS = [SKILL_DIR / "SKILL.md", SKILL_DIR / "references" / "required-artifacts-guidance.md"]

# Snapshot of long options accepted by the current CLI help surfaces.
ALLOWED_FLAGS = {
    "search": {
        "--collection", "--type", "--search-type", "--tags", "--limit", "--projects",
        "--discover", "--no-cache", "--format", "--instance", "--local", "--team", "--scope",
    },
    "list": {
        "--type", "--collection", "--tags", "--no-cache", "--cache-status", "--group-by",
        "--format", "--instance", "--local", "--team", "--scope",
    },
    "show": {
        "--type", "--collection", "--scores", "--json", "--instance", "--local", "--namespace",
    },
}

PLACEHOLDERS = {
    "<feature-keywords>": "planning",
    "<keyword>": "planning",
    "<name>": "planning",
    "<t>": "skill",
}

INLINE_RE = re.compile(r"`(skillmeat [^`]+)`")
FENCE_RE = re.compile(r"^```.*?$(.*?)^```", re.M | re.S)


def _recipes():
    """Return (doc, line) for every skillmeat command in the planning docs."""
    out = []
    for doc in DOCS:
        text = doc.read_text()
        for block in FENCE_RE.findall(text):
            for line in block.splitlines():
                if line.strip().startswith("skillmeat "):
                    out.append((doc.name, line.strip()))
        for m in INLINE_RE.finditer(text):
            out.append((doc.name, m.group(1).strip()))
    return out


def _split(line):
    """Return (argv, jq_filter_or_None) with placeholders substituted."""
    for k, v in PLACEHOLDERS.items():
        line = line.replace(k, v)
    cmd, _, jq_part = line.partition(" | jq ")
    jq_filter = shlex.split(jq_part)[0] if jq_part else None
    return shlex.split(cmd), jq_filter


RECIPES = [r for r in _recipes() if len(_split(r[1])[0]) > 1 and _split(r[1])[0][1] in ALLOWED_FLAGS]


def _flags(argv):
    return [a for a in argv if a.startswith("--")]


def test_recipes_found():
    subs = {_split(line)[0][1] for _, line in RECIPES}
    assert {"search", "show"} <= subs
    # The fenced look-first block must include a project-scoped discovery recipe.
    assert any("--projects" in line and " | jq " in line for _, line in RECIPES)


@pytest.mark.parametrize("doc,line", RECIPES)
def test_flags_in_help_snapshot(doc, line):
    argv, _ = _split(line)
    sub = argv[1]
    bad = [f for f in _flags(argv) if f not in ALLOWED_FLAGS[sub]]
    assert not bad, f"{doc}: `{line}` uses flags not accepted by `skillmeat {sub}`: {bad}"
    if sub in ("search", "list"):
        assert "--json" not in argv, f"{doc}: use `--format json`, not `--json`: {line}"


needs_cli = pytest.mark.skipif(shutil.which("skillmeat") is None, reason="skillmeat not on PATH")


@needs_cli
@pytest.mark.parametrize("doc,line", RECIPES)
def test_flags_in_live_help(doc, line):
    argv, _ = _split(line)
    sub = argv[1]
    res = subprocess.run(["skillmeat", sub, "--help"], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    live = set(re.findall(r"(?<![\w-])(--[a-z][a-z0-9-]*)", res.stdout))
    bad = [f for f in _flags(argv) if f not in live]
    assert not bad, f"{doc}: `{line}` flags missing from live `skillmeat {sub} --help`: {bad}"


@needs_cli
@pytest.mark.parametrize(
    "doc,line", [r for r in RECIPES if _split(r[1])[0][1] in ("search", "list")]
)
def test_recipe_reaches_result_parsing(doc, line):
    argv, jq_filter = _split(line)
    res = subprocess.run(argv, capture_output=True, text=True, timeout=180, cwd=REPO_ROOT)
    usage_error = res.returncode == 2 or "No such option" in res.stderr or "Usage:" in res.stderr
    assert not usage_error, f"{doc}: `{line}` hit a usage error:\n{res.stderr}"
    if res.returncode != 0:
        pytest.skip(f"skillmeat runtime failure (not a usage error): {res.stderr[-300:]}")
    if "--format" not in argv:
        return  # table output (e.g. a bare `skillmeat list` mention): no usage error is enough
    json.loads(res.stdout)  # result parsing: output must be valid JSON
    if jq_filter is not None:
        if shutil.which("jq") is None:
            pytest.skip("jq not on PATH")
        jq = subprocess.run(["jq", "-c", jq_filter], input=res.stdout,
                            capture_output=True, text=True, timeout=60)
        assert jq.returncode == 0, f"{doc}: jq filter failed on `{line}` output:\n{jq.stderr}"
