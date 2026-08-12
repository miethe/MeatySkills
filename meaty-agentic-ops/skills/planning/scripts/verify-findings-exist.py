#!/usr/bin/env python3
"""
Fail-closed gate: verify every ``findings_path`` cited by an explore/spike
synthesis actually exists on disk (and isn't empty) before verdict sign-off.

Background (real incident): the explore/spike workflows tell leg agents to
write findings to disk in prose only ("Output: Write your findings to
${leg.output_path}") and the synthesis schema requires
``investigation_summary[].findings_path`` as a string — but nothing checks
that string points at a real file. The synthesis LLM can (and did) echo back
a path that was never written. This script is the mechanical, Opus-side
check that runs *before* a verdict is signed off. See
``.claude/specs/workflows/explore-spike-workflow-spec.md`` §6.

Input (choose exactly one):
  --synthesis-json PATH   Path to the workflow's structured return envelope
                          (or '-' for stdin). Extracts every
                          synthesis.investigation_summary[].findings_path —
                          also accepts a bare top-level investigation_summary
                          array. Never parses markdown/prose; JSON only.
  --paths PATH [PATH...]  Explicit list of findings-file paths to check.
                          May be given with zero values (empty input list).

Classification (per path):
  MISSING  Path does not exist, or exists but is not a regular file.
  EMPTY    File exists and is exactly 0 bytes.
  THIN     File exists, non-empty, but under 200 bytes (likely a stub/
           partial-leg placeholder) — printed as a warning, does not fail.
  OK       File exists and is >= 200 bytes.

Fail-closed rule: exit 1 if ANY path is MISSING or EMPTY. THIN paths pass
(exit 0) but print a prominent warning. A usage/parse error (bad JSON,
missing investigation_summary array, unreadable file) exits 2 — so "the gate
could not run" is never confused with "the gate passed".

legs_run cross-check (--synthesis-json only): the workflow return envelope
also carries a top-level ``legs_run`` integer (how many legs actually ran).
If present and > 0, and the number of investigation_summary entries is LESS
than legs_run, the gate fails closed — a synthesis can otherwise assert N
legs ran while citing zero (or fewer than N) findings paths and vacuously
pass with an empty-but-true "every findings_path resolves" report. When
legs_run is absent or 0, this check is skipped (--paths mode has no
legs_run concept at all). A zero-entries report never prints the
"every findings_path resolves" line — it says plainly that nothing was
checked.

Usage:
  python verify-findings-exist.py --synthesis-json path/to/synthesis.json
  cat synthesis.json | python verify-findings-exist.py --synthesis-json -
  python verify-findings-exist.py --paths findings-a.md findings-b.md
  python verify-findings-exist.py --synthesis-json synthesis.json --json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

THIN_THRESHOLD_BYTES = 200

STATUS_MISSING = "MISSING"
STATUS_EMPTY = "EMPTY"
STATUS_THIN = "THIN"
STATUS_OK = "OK"

FAILING_STATUSES = {STATUS_MISSING, STATUS_EMPTY}
_STATUS_ORDER = (STATUS_OK, STATUS_THIN, STATUS_EMPTY, STATUS_MISSING)


class GateInputError(Exception):
    """Usage/parse error — maps to exit code 2 (gate could not run)."""


# ---------------------------------------------------------------------------
# Extraction — structured input only, never markdown/prose parsing.
# ---------------------------------------------------------------------------


def _load_synthesis_data(path_arg: str) -> Any:
    """Read and JSON-parse the synthesis envelope from a file path or stdin."""
    if path_arg == "-":
        source = "<stdin>"
        raw = sys.stdin.read()
    else:
        p = Path(path_arg)
        if not p.is_file():
            raise GateInputError(f"synthesis JSON file not found: {p}")
        source = str(p)
        try:
            raw = p.read_text(encoding="utf-8")
        except OSError as exc:
            raise GateInputError(f"could not read {source}: {exc}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GateInputError(f"invalid JSON in {source}: {exc}") from exc


def _extract_summary_array(data: Any) -> List[Any]:
    """Pull the investigation_summary array from either envelope shape."""
    if isinstance(data, dict):
        synthesis = data.get("synthesis")
        if isinstance(synthesis, dict) and isinstance(
            synthesis.get("investigation_summary"), list
        ):
            return synthesis["investigation_summary"]
        if isinstance(data.get("investigation_summary"), list):
            return data["investigation_summary"]
    raise GateInputError(
        "could not locate an 'investigation_summary' array — checked top-level "
        "'investigation_summary' and 'synthesis.investigation_summary'"
    )


def extract_legs_run(data: Any) -> Optional[int]:
    """Pull the top-level ``legs_run`` integer from a workflow return envelope.

    Returns None when absent, non-dict, or not a plain int (bool is excluded —
    it's a bool subclass of int but never a meaningful legs_run value).
    """
    if isinstance(data, dict):
        val = data.get("legs_run")
        if isinstance(val, int) and not isinstance(val, bool):
            return val
    return None


def entries_from_synthesis(data: Any) -> List[Tuple[Optional[str], Optional[str]]]:
    """Return (findings_path, leg_id) tuples from a synthesis JSON payload."""
    summary = _extract_summary_array(data)
    entries: List[Tuple[Optional[str], Optional[str]]] = []
    for i, item in enumerate(summary):
        if not isinstance(item, dict):
            raise GateInputError(f"investigation_summary[{i}] is not a JSON object")
        leg_id = item.get("leg_id") or f"leg[{i}]"
        entries.append((item.get("findings_path"), leg_id))
    return entries


def entries_from_paths(paths: List[str]) -> List[Tuple[Optional[str], Optional[str]]]:
    """Return (path, leg_id) tuples for explicit --paths input (leg_id unknown)."""
    return [(p, None) for p in paths]


# ---------------------------------------------------------------------------
# Classification + report
# ---------------------------------------------------------------------------


def resolve_path(raw: str, root: Path) -> Path:
    p = Path(raw)
    return p if p.is_absolute() else (root / p)


def classify(resolved: Path) -> Tuple[str, Optional[int]]:
    if not resolved.exists() or not resolved.is_file():
        return STATUS_MISSING, None
    size = resolved.stat().st_size
    if size == 0:
        return STATUS_EMPTY, 0
    if size < THIN_THRESHOLD_BYTES:
        return STATUS_THIN, size
    return STATUS_OK, size


def build_report(
    entries: List[Tuple[Optional[str], Optional[str]]], root: Path
) -> List[Dict[str, Any]]:
    report: List[Dict[str, Any]] = []
    for raw_path, leg_id in entries:
        if not raw_path:
            report.append(
                {
                    "leg_id": leg_id,
                    "declared_path": raw_path,
                    "resolved_path": None,
                    "status": STATUS_MISSING,
                    "size_bytes": None,
                    "note": "no findings_path provided",
                }
            )
            continue
        resolved = resolve_path(raw_path, root)
        status, size = classify(resolved)
        report.append(
            {
                "leg_id": leg_id,
                "declared_path": raw_path,
                "resolved_path": str(resolved),
                "status": status,
                "size_bytes": size,
                "note": None,
            }
        )
    return report


def compute_legs_undercount(legs_run: Optional[int], entries_count: int) -> bool:
    """True when legs_run is a positive int and fewer findings entries were cited than ran."""
    return bool(legs_run) and legs_run > 0 and entries_count < legs_run


def format_table(
    report: List[Dict[str, Any]], root: Path, legs_run: Optional[int]
) -> str:
    entries_count = len(report)
    legs_undercount = compute_legs_undercount(legs_run, entries_count)

    lines = [
        "=" * 78,
        "Findings-Exist Gate Report",
        "=" * 78,
        f"Root: {root}",
        f"Checked: {entries_count} path(s)"
        + (f" (legs_run={legs_run})" if legs_run is not None else ""),
        "-" * 78,
    ]
    if not report:
        lines.append("(no findings paths supplied — nothing to verify)")
    else:
        leg_w = max([len(str(r["leg_id"])) for r in report if r["leg_id"]] + [3])
        for r in report:
            leg_label = str(r["leg_id"]) if r["leg_id"] else "-"
            size_label = f"{r['size_bytes']}B" if r["size_bytes"] is not None else "-"
            path_label = r["declared_path"] or "<missing findings_path>"
            lines.append(
                f"  [{r['status']:<7}] {leg_label:<{leg_w}}  {size_label:>8}  {path_label}"
            )
    lines.append("-" * 78)

    counts = Counter(r["status"] for r in report)
    summary_bits = ", ".join(
        f"{status}={counts.get(status, 0)}" for status in _STATUS_ORDER
    )
    lines.append(f"Summary: {summary_bits}")

    failing = [r for r in report if r["status"] in FAILING_STATUSES]
    thin = [r for r in report if r["status"] == STATUS_THIN]

    if failing:
        lines.append(
            f"GATE FAILED — {len(failing)} path(s) MISSING or EMPTY. "
            "Fail-closed: verdict sign-off must NOT proceed."
        )
    if legs_undercount:
        missing_legs = legs_run - entries_count
        lines.append(
            f"GATE FAILED — {legs_run} leg(s) ran but only {entries_count} findings "
            f"path(s) cited — {missing_legs} leg(s) contributed no evidence. "
            "Fail-closed: verdict sign-off must NOT proceed."
        )
    if not failing and not legs_undercount:
        if report:
            lines.append(
                "GATE PASSED — every findings_path resolves to a real, non-empty file."
            )
        else:
            lines.append(
                "GATE PASSED — nothing was checked (0 findings paths supplied)."
            )

    if thin:
        lines.append(
            f"WARNING: {len(thin)} path(s) are THIN (< {THIN_THRESHOLD_BYTES} bytes) — "
            "likely a stub or partial-leg placeholder. Review before trusting."
        )
    lines.append("=" * 78)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Fail-closed gate: verify every findings_path cited by an explore/spike "
            "synthesis actually exists on disk before verdict sign-off."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # From the workflow's structured return envelope
  python verify-findings-exist.py --synthesis-json docs/.../synthesis.json

  # From stdin
  cat synthesis.json | python verify-findings-exist.py --synthesis-json -

  # Explicit paths
  python verify-findings-exist.py --paths findings-a.md findings-b.md

  # Machine-readable output
  python verify-findings-exist.py --synthesis-json synthesis.json --json

Exit codes:
  0  All paths OK (THIN paths print a warning but do not fail the gate)
  1  One or more paths MISSING or EMPTY, or fewer findings cited than legs_run (fail-closed)
  2  Usage or parse error (bad JSON, missing investigation_summary, file not found)
""",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--synthesis-json",
        metavar="PATH",
        help="Path to the workflow's synthesis JSON envelope, or '-' for stdin",
    )
    group.add_argument(
        "--paths",
        nargs="*",
        metavar="PATH",
        help="Explicit findings-file paths to verify (may be given with zero values)",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Base directory to resolve relative paths against (default: cwd)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a machine-readable JSON report to stdout",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    root = args.root if args.root is not None else Path.cwd()

    legs_run: Optional[int] = None
    try:
        if args.synthesis_json is not None:
            data = _load_synthesis_data(args.synthesis_json)
            entries = entries_from_synthesis(data)
            legs_run = extract_legs_run(data)
        else:
            entries = entries_from_paths(args.paths)
    except GateInputError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    report = build_report(entries, root)
    entries_count = len(report)
    legs_undercount = compute_legs_undercount(legs_run, entries_count)
    path_level_failing = any(r["status"] in FAILING_STATUSES for r in report)
    gate_passed = not path_level_failing and not legs_undercount

    if args.json:
        print(
            json.dumps(
                {
                    "root": str(root),
                    "checked": entries_count,
                    "legs_run": legs_run,
                    "legs_undercount": legs_undercount,
                    "entries": report,
                    "gate_passed": gate_passed,
                },
                indent=2,
            )
        )
    else:
        print(format_table(report, root, legs_run))

    return 0 if gate_passed else 1


if __name__ == "__main__":
    sys.exit(main())
