#!/usr/bin/env python3
"""
check-registry-fresh.py — fail when model-registry.generated.json is stale.

WHY THIS EXISTS
  model-registry.generated.json is a DERIVED artifact: build-model-registry.py
  emits it from model-registry.yaml so resolver.js has a JSON fallback when it
  cannot import a YAML parser. Nothing regenerated it automatically, so an edit
  to the YAML that was not followed by a regen shipped a generated JSON that
  silently disagreed with its own source — and the stale deployed copy gated
  DI-1's dated-slug join (node_01KZS696RXQGB4TAG8AEQCGCBS).

WHAT IT CHECKS
  Regenerates the JSON from the committed YAML into a temp file (via
  build-model-registry.py, the ONE sanctioned generator — never a second copy
  of the conversion logic) and byte-compares it against the committed
  generated JSON. Any difference exits 1 and prints a unified diff. This is
  only honest because `_generated_from` is now the source BASENAME, not an
  absolute path: were it still absolute, a fresh regen on any other machine
  would differ on that line alone and the check would be either a false alarm
  or (if special-cased) blind to that field.

RUN (zero deps beyond PyYAML, which the generator already needs):
  python3 .claude/skills/delegation-router/scripts/check-registry-fresh.py

  Explicit paths (CI / per-project override):
  python3 .../check-registry-fresh.py \
      --in  path/to/model-registry.yaml \
      --generated path/to/model-registry.generated.json

  Exit 0 = in sync. Exit 1 = drift (regenerate and commit). Exit 2 = usage/IO error.

WIRE IT
  Invoke from a pre-commit hook or CI step alongside `node routing-record.test.js`
  (the repo's existing standalone-check convention). No framework required.
"""

import argparse
import difflib
import os
import subprocess
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_GENERATOR = os.path.join(_HERE, "build-model-registry.py")
# The skill root is the generator's grandparent (scripts/ -> skill dir).
_SKILL_DIR = os.path.dirname(_HERE)


def main() -> int:
    default_yaml = os.path.join(_SKILL_DIR, "model-registry.yaml")
    default_generated = os.path.join(_SKILL_DIR, "model-registry.generated.json")

    ap = argparse.ArgumentParser(
        description="Fail when model-registry.generated.json is stale relative to its YAML."
    )
    ap.add_argument("--in", dest="src", default=default_yaml,
                    help=f"Path to model-registry.yaml (default: {default_yaml})")
    ap.add_argument("--generated", dest="generated", default=default_generated,
                    help=f"Path to the committed generated JSON (default: {default_generated})")
    ap.add_argument("--table", dest="table", default=os.path.join(_SKILL_DIR, "routing-table.generated.json"),
                    help="Path to the committed generated routing table")
    args = ap.parse_args()

    if not os.path.isfile(args.src):
        sys.stderr.write(f"ERROR: source YAML not found: {args.src}\n")
        return 2
    if not os.path.isfile(args.generated):
        sys.stderr.write(f"ERROR: generated JSON not found: {args.generated}\n")
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        fresh = os.path.join(tmp, "model-registry.generated.json")
        fresh_table = os.path.join(tmp, "routing-table.generated.json")
        proc = subprocess.run(
            [sys.executable, _GENERATOR, "--in", args.src, "--out", fresh],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            sys.stderr.write(
                "ERROR: build-model-registry.py failed during freshness check:\n"
                + (proc.stderr or "")
            )
            return 2

        with open(fresh, encoding="utf-8") as fh:
            fresh_text = fh.read()
        with open(args.generated, encoding="utf-8") as fh:
            committed_text = fh.read()
        with open(fresh_table, encoding="utf-8") as fh:
            fresh_table_text = fh.read()
        with open(args.table, encoding="utf-8") as fh:
            committed_table_text = fh.read()

    if fresh_text == committed_text and fresh_table_text == committed_table_text:
        sys.stderr.write("check-registry-fresh.py: generated registry JSON and routing table are up to date.\n")
        return 0

    sys.stderr.write(
        "check-registry-fresh.py: STALE — generated registry JSON and/or routing table do not match\n"
        "a fresh regeneration of model-registry.yaml. Run build-model-registry.py and commit the result.\n\n"
    )
    diff = difflib.unified_diff(
        committed_text.splitlines(keepends=True),
        fresh_text.splitlines(keepends=True),
        fromfile="committed/model-registry.generated.json",
        tofile="fresh-regeneration",
    )
    if fresh_text != committed_text:
        diff = difflib.unified_diff(
            committed_text.splitlines(keepends=True), fresh_text.splitlines(keepends=True),
            fromfile="committed/model-registry.generated.json", tofile="fresh-regeneration",
        )
        sys.stderr.writelines(diff)
    if fresh_table_text != committed_table_text:
        diff = difflib.unified_diff(
            committed_table_text.splitlines(keepends=True), fresh_table_text.splitlines(keepends=True),
            fromfile="committed/routing-table.generated.json", tofile="fresh-regeneration",
        )
        sys.stderr.writelines(diff)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
