#!/usr/bin/env python3
"""
Manage frontmatter status and verdict fields in exploration artifacts.

Supports advancing status on:
  - exploration_charter   (doc_type: exploration_charter)
  - feasibility_brief     (doc_type: report with report_category: feasibility)

Enforces the invariants from §3.6 of the pre-commitment exploration meta-plan.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from io import StringIO

try:
    from ruamel.yaml import YAML as _RYAML
except ImportError as _ruamel_import_err:
    raise RuntimeError(
        "ruamel.yaml is required by manage-exploration-status.py. "
        "Install it with: pip install ruamel.yaml"
    ) from _ruamel_import_err

import yaml  # PyYAML fallback


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CHARTER_STATUSES = ("draft", "in-progress", "concluded")
BRIEF_STATUSES = ("draft", "in-progress", "finalized")
VALID_VERDICTS = ("go", "no-go", "conditional")

# Flipping go↔no-go is the only restricted transition.
_FLIP_PAIRS = frozenset({("go", "no-go"), ("no-go", "go")})


# ---------------------------------------------------------------------------
# YAML round-trip helpers
# ---------------------------------------------------------------------------


def _load_ruamel():
    """Return a configured ruamel.yaml YAML instance."""
    ry = _RYAML()
    ry.preserve_quotes = True
    ry.default_flow_style = False
    return ry


def extract_frontmatter_and_body(
    filepath: Path,
) -> Tuple[Optional[Dict[str, Any]], str, str]:
    """
    Parse YAML frontmatter from *filepath*.

    Returns (frontmatter_dict, raw_frontmatter_str, body_str).
    On failure prints to stderr and returns (None, "", "").
    """
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception as exc:
        print(f"Error: Could not read {filepath}: {exc}", file=sys.stderr)
        return None, "", ""

    if not content.startswith("---\n"):
        print("Error: File does not contain YAML frontmatter", file=sys.stderr)
        return None, "", ""

    match = re.match(r"^---\n(.*?)\n---\n?(.*)", content, re.DOTALL)
    if not match:
        print("Error: Could not parse YAML frontmatter delimiters", file=sys.stderr)
        return None, "", ""

    fm_str, body = match.group(1), match.group(2)

    try:
        frontmatter = yaml.safe_load(fm_str) or {}
    except Exception as exc:
        print(f"Error: Invalid YAML frontmatter in {filepath}: {exc}", file=sys.stderr)
        return None, "", ""

    if not isinstance(frontmatter, dict):
        print(f"Error: Frontmatter in {filepath} is not a mapping", file=sys.stderr)
        return None, "", ""

    return frontmatter, fm_str, body


def write_frontmatter_and_body(
    filepath: Path,
    frontmatter: Dict[str, Any],
    body: str,
    original_fm_str: str,
) -> None:
    """
    Write *frontmatter* + *body* back to *filepath*.

    Uses ruamel.yaml for round-trip preservation of ordering and comments.
    """
    ry = _load_ruamel()
    # Load the original to preserve ordering/comments; then overlay updates.
    original_obj = ry.load(original_fm_str)
    if original_obj is None:
        original_obj = {}
    for key, val in frontmatter.items():
        original_obj[key] = val
    # Serialise to string
    buf = StringIO()
    ry.dump(original_obj, buf)
    fm_out = buf.getvalue()

    filepath.write_text(f"---\n{fm_out}---\n{body}", encoding="utf-8")


# ---------------------------------------------------------------------------
# Artifact-kind detection
# ---------------------------------------------------------------------------


def detect_kind(frontmatter: Dict[str, Any], filepath: Path) -> Optional[str]:
    """
    Return 'charter' or 'brief', or None if *filepath* is not a supported kind.

    Args:
        frontmatter: Parsed YAML frontmatter dict.
        filepath: Source file path — included in debug logging when detection fails.
    """
    doc_type = frontmatter.get("doc_type", "")
    report_category = frontmatter.get("report_category", "")

    if doc_type == "exploration_charter":
        return "charter"
    if doc_type == "report" and report_category == "feasibility":
        return "brief"

    # Log at debug level so callers can surface a useful error with the path.
    import logging as _logging
    _logging.debug("detect_kind: unsupported doc_type=%r in %s", doc_type, filepath)
    return None


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def _validate_verdict(verdict: str) -> bool:
    if verdict not in VALID_VERDICTS:
        print(
            f"Error: Invalid verdict '{verdict}'. Must be one of: {', '.join(VALID_VERDICTS)}",
            file=sys.stderr,
        )
        return False
    return True


def _validate_confidence(value: float) -> bool:
    if not (0.0 <= value <= 1.0):
        print(
            f"Error: verdict_confidence {value!r} is outside [0.0, 1.0].",
            file=sys.stderr,
        )
        return False
    return True


def _current_verdict(frontmatter: Dict[str, Any]) -> Optional[str]:
    v = frontmatter.get("verdict")
    if v is None or v == "null" or str(v).strip().lower() in ("null", "none", ""):
        return None
    return str(v)


def _validate_verdict_transition(
    current: Optional[str],
    new: str,
    force: bool,
) -> bool:
    """Return True if the verdict transition is allowed."""
    if current is None:
        return True
    if current == new:
        return True
    if (current, new) in _FLIP_PAIRS and not force:
        print(
            f"Error: Refusing to flip verdict from '{current}' to '{new}' "
            "without --force.  This is a significant re-decision; confirm with --force.",
            file=sys.stderr,
        )
        return False
    return True


# ---------------------------------------------------------------------------
# Per-kind validation before write
# ---------------------------------------------------------------------------


def _validate_charter_conclude(
    frontmatter: Dict[str, Any],
    new_verdict: Optional[str],
    new_rationale: Optional[str],
) -> bool:
    """Enforce charter-specific invariants for status: concluded."""
    effective_verdict = new_verdict or _current_verdict(frontmatter)
    if effective_verdict is None:
        print(
            "Error: Cannot set status: concluded on a charter without a verdict. "
            "Pass --verdict {go|no-go|conditional}.",
            file=sys.stderr,
        )
        return False

    # verdict_rationale check — new_rationale or already non-empty in frontmatter
    existing_rationale = frontmatter.get("verdict_rationale")
    has_rationale = bool(new_rationale) or (
        existing_rationale is not None
        and str(existing_rationale).strip() not in ("", "null", "None")
    )
    if not has_rationale:
        print(
            "Error: Cannot set status: concluded on a charter without a non-empty "
            "verdict_rationale. Pass --verdict-rationale TEXT.",
            file=sys.stderr,
        )
        return False

    return True


def _validate_brief_finalize(
    frontmatter: Dict[str, Any],
    new_verdict: Optional[str],
    new_confidence: Optional[float],
) -> bool:
    """Enforce feasibility-brief-specific invariants for status: finalized."""
    effective_verdict = new_verdict or _current_verdict(frontmatter)
    if effective_verdict is None:
        print(
            "Error: Cannot set status: finalized on a feasibility brief without a verdict. "
            "Pass --verdict {go|no-go|conditional}.",
            file=sys.stderr,
        )
        return False

    effective_confidence = new_confidence
    if effective_confidence is None:
        existing = frontmatter.get("verdict_confidence")
        if existing is not None:
            try:
                effective_confidence = float(existing)
            except (TypeError, ValueError):
                pass

    if effective_confidence is None:
        print(
            "Error: Cannot set status: finalized on a feasibility brief without "
            "verdict_confidence. Pass --verdict-confidence FLOAT.",
            file=sys.stderr,
        )
        return False

    rna = frontmatter.get("recommended_next_action")
    if not rna or str(rna).strip() in ("", "null", "None"):
        print(
            "Error: Cannot set status: finalized on a feasibility brief without "
            "recommended_next_action. Update the frontmatter field first.",
            file=sys.stderr,
        )
        return False

    return True


# ---------------------------------------------------------------------------
# Core update logic
# ---------------------------------------------------------------------------


def update_exploration_artifact(
    filepath: Path,
    new_status: Optional[str],
    new_verdict: Optional[str],
    new_confidence: Optional[float],
    new_rationale: Optional[str],
    dry_run: bool,
    as_json: bool,
    force: bool,
) -> int:
    """
    Apply requested changes to *filepath* and return an exit code (0/1/2).
    """
    if not filepath.exists():
        msg = f"File not found: {filepath}"
        if as_json:
            print(json.dumps({"error": msg}))
        else:
            print(f"Error: {msg}", file=sys.stderr)
        return 2

    frontmatter, fm_str, body = extract_frontmatter_and_body(filepath)
    if frontmatter is None:
        return 2

    kind = detect_kind(frontmatter, filepath)
    if kind is None:
        msg = (
            f"Unsupported artifact kind in {filepath}. "
            "Expected doc_type: exploration_charter  OR  "
            "doc_type: report with report_category: feasibility."
        )
        if as_json:
            print(json.dumps({"error": msg}))
        else:
            print(f"Error: {msg}", file=sys.stderr)
        return 1

    # -----------------------------------------------------------------------
    # Per-kind status validation
    # -----------------------------------------------------------------------
    valid_statuses = CHARTER_STATUSES if kind == "charter" else BRIEF_STATUSES

    if new_status is not None and new_status not in valid_statuses:
        msg = (
            f"Invalid status '{new_status}' for {kind}. "
            f"Must be one of: {', '.join(valid_statuses)}"
        )
        if as_json:
            print(json.dumps({"error": msg}))
        else:
            print(f"Error: {msg}", file=sys.stderr)
        return 1

    # -----------------------------------------------------------------------
    # Verdict-confidence is brief-only
    # -----------------------------------------------------------------------
    if new_confidence is not None and kind == "charter":
        msg = "--verdict-confidence is only valid for feasibility briefs."
        if as_json:
            print(json.dumps({"error": msg}))
        else:
            print(f"Error: {msg}", file=sys.stderr)
        return 1

    # -----------------------------------------------------------------------
    # Verdict value validation
    # -----------------------------------------------------------------------
    if new_verdict is not None and not _validate_verdict(new_verdict):
        return 1

    if new_confidence is not None and not _validate_confidence(new_confidence):
        return 1

    # -----------------------------------------------------------------------
    # Verdict transition check
    # -----------------------------------------------------------------------
    current_verdict = _current_verdict(frontmatter)
    if new_verdict is not None:
        if not _validate_verdict_transition(current_verdict, new_verdict, force):
            return 1

    # -----------------------------------------------------------------------
    # Conclude / finalize pre-flight invariants
    # -----------------------------------------------------------------------
    if new_status == "concluded" and kind == "charter":
        if not _validate_charter_conclude(frontmatter, new_verdict, new_rationale):
            return 1

    if new_status == "finalized" and kind == "brief":
        if not _validate_brief_finalize(frontmatter, new_verdict, new_confidence):
            return 1

    # -----------------------------------------------------------------------
    # Build change set
    # -----------------------------------------------------------------------
    changes: Dict[str, Any] = {}
    today = datetime.now().strftime("%Y-%m-%d")

    if new_status is not None:
        changes["status"] = new_status

    if new_verdict is not None:
        changes["verdict"] = new_verdict

    if new_confidence is not None and kind == "brief":
        changes["verdict_confidence"] = new_confidence

    if new_rationale is not None and kind == "charter":
        changes["verdict_rationale"] = new_rationale

    changes["updated"] = today

    # -----------------------------------------------------------------------
    # Dry-run path
    # -----------------------------------------------------------------------
    if dry_run:
        diff_lines = []
        for key, new_val in changes.items():
            old_val = frontmatter.get(key, "<not set>")
            diff_lines.append(f"  {key}: {old_val!r} -> {new_val!r}")
        summary = {
            "dry_run": True,
            "file": str(filepath),
            "kind": kind,
            "changes": changes,
            "diff": diff_lines,
        }
        if as_json:
            print(json.dumps(summary, indent=2))
        else:
            print(f"Dry-run — would update: {filepath}  [{kind}]")
            for line in diff_lines:
                print(line)
        return 0

    # -----------------------------------------------------------------------
    # Apply changes
    # -----------------------------------------------------------------------
    updated_fm = dict(frontmatter)
    updated_fm.update(changes)

    try:
        write_frontmatter_and_body(filepath, updated_fm, body, fm_str)
    except Exception as exc:
        msg = f"Could not write {filepath}: {exc}"
        if as_json:
            print(json.dumps({"error": msg}))
        else:
            print(f"Error: {msg}", file=sys.stderr)
        return 2

    result = {
        "file": str(filepath),
        "kind": kind,
        "changes": {k: str(v) for k, v in changes.items()},
    }
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Updated [{kind}]: {filepath}")
        for key, new_val in changes.items():
            old_val = frontmatter.get(key, "<not set>")
            print(f"  {key}: {old_val!r} -> {new_val!r}")

    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Manage status and verdict fields in exploration_charter and "
            "feasibility_brief artifacts."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Advance charter to in-progress
  python manage-exploration-status.py \\
      --file docs/project_plans/exploration/my-idea/my-idea-charter.md \\
      --status in-progress

  # Conclude charter with verdict
  python manage-exploration-status.py \\
      --file docs/project_plans/exploration/my-idea/my-idea-charter.md \\
      --status concluded --verdict go \\
      --verdict-rationale "All legs passed confidence threshold; no deal-killer."

  # Finalize feasibility brief
  python manage-exploration-status.py \\
      --file docs/project_plans/exploration/my-idea/my-idea-feasibility-brief.md \\
      --status finalized --verdict go --verdict-confidence 0.85

  # Dry-run preview
  python manage-exploration-status.py \\
      --file my-idea-charter.md --status concluded --verdict no-go \\
      --verdict-rationale "Deal-killer triggered." --dry-run

  # JSON output
  python manage-exploration-status.py --file my-idea-charter.md --status in-progress --json
""",
    )

    parser.add_argument("--file", "-f", type=Path, required=True, help="Path to artifact file")
    parser.add_argument(
        "--status",
        help=(
            "New status value. Charter: draft|in-progress|concluded. "
            "Brief: draft|in-progress|finalized."
        ),
    )
    parser.add_argument(
        "--verdict",
        choices=list(VALID_VERDICTS),
        help="Set verdict: go|no-go|conditional",
    )
    parser.add_argument(
        "--verdict-confidence",
        type=float,
        dest="verdict_confidence",
        metavar="FLOAT",
        help="Feasibility briefs only. Confidence score 0.0–1.0.",
    )
    parser.add_argument(
        "--verdict-rationale",
        dest="verdict_rationale",
        metavar="TEXT",
        help="Verdict rationale text (written to charter frontmatter only).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow otherwise-rejected transitions (e.g. go -> no-go flip).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        dest="dry_run",
        help="Print what would change without writing.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="Machine-readable JSON output.",
    )

    args = parser.parse_args()

    if args.status is None and args.verdict is None and args.verdict_confidence is None:
        parser.error("Provide at least one of --status, --verdict, or --verdict-confidence.")

    try:
        exit_code = update_exploration_artifact(
            filepath=args.file,
            new_status=args.status,
            new_verdict=args.verdict,
            new_confidence=args.verdict_confidence,
            new_rationale=args.verdict_rationale,
            dry_run=args.dry_run,
            as_json=args.as_json,
            force=args.force,
        )
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:  # pragma: no cover
        print(f"Error: Unexpected error: {exc}", file=sys.stderr)
        raise

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
