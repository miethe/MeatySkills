#!/usr/bin/env python3
"""finding_sweep.py — reconcile findings NAMED in a run against nodes actually FILED.

The engine behind ``finding-sweep.sh``. The wrapper owns the master switch, the binding
guard, and the non-fatal contract; this module owns the reconciliation and the report.

WHY THIS EXISTS (and why it is deliberately a backstop, not the mechanism)
-------------------------------------------------------------------------
The primary mechanism is behavioral: an agent that detects a deferral/bug/gap files an
IntentTree node for it *at detection time*, ungated (`.claude/rules/finding-capture.md`).
That is where capture belongs, because that is the only moment the agent still has the
context that makes the node worth reading.

This sweep exists because behavioral defaults decay silently. It reads the artifacts a run
leaves behind, finds every item that *claims* to be a finding or a deferral, and asks one
question: is there a node id behind it? An item surfacing here means the rule was already
missed — the sweep's job is to make that visible instead of letting it vanish.

TWO FAILURE MODES, BOTH CHECKED
-------------------------------
1. **Omission** — the entry names no node at all. This is the loophole that motivated the
   whole rule: a spec-conformant deferral row with a file path and nothing filed behind it.
2. **Fabrication** — the entry names a node id that does not exist. Observed for real:
   during the run that built this hook, a `node_…` id was written into a rules file from
   memory before the node had been created. A fabricated id is *worse* than an omission,
   because it reads as satisfied. So ids are verified against the server when `itt` is
   reachable (default-on, degrades to a warning when it is not).

DETERMINISTIC. No model call (AOS constraint 4). The omission pass needs no network at all;
only id verification touches the server, and it is best-effort.

SOURCES SWEPT
-------------
* findings doc  (`.claude/findings/<slug>-findings.md`) — bullet entries under the
  Discoveries / Plan-Reality / Bugs-Gotchas / Schema-Gaps subsections.
* plan file — rows of the DOC-006 deferred-items triage table, read by locating the
  ``Tracker Node`` column in the header rather than by fixed position, so the table can
  grow columns without breaking the sweep.

EXIT: 0 always. See the wrapper's contract.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Overridable so the suite can exercise the CLI-absent branch without mutating PATH — which
# also strips the interpreter and, on a pyenv shim, `bash` (both tried; both broke the test).
ITT_BIN = os.environ.get("FINDING_SWEEP_ITT", "itt")

# A node id is `node_` + a ULID. Deliberately looser than 26 chars so a real-but-unusual id
# is not reported as fabricated; the existence check is what adjudicates borderline cases.
NODE_ID_RE = re.compile(r"\bnode_[A-Za-z0-9]{8,}\b")

# Findings-doc subsections whose bullets are individual findings (planning skill
# `references/deferred-items-and-findings.md` §2 Step 2). Matched case-insensitively on the
# heading text so "Bugs / Gotchas" and "Bugs/Gotchas" both land.
FINDING_SECTIONS = (
    "discoveries",
    "plan / reality mismatches",
    "plan/reality mismatches",
    "bugs / gotchas",
    "bugs/gotchas",
    "schema / data gaps",
    "schema/data gaps",
)

# `N/A — <rationale>` is the one sanctioned escape: a reviewed decision that this row will never
# be worked. Everything else without an id — blank, `TBD`, the `node_01…` template stub — is an
# unfiled item, because the placeholder is exactly what a skipped filing looks like.


@dataclass
class Unfiled:
    """One item that names a finding but no usable node."""

    source: str          # file:line
    text: str            # the item as written, trimmed
    reason: str          # "no tracker node id" | "tracker node does not exist: <id>"


@dataclass
class SweepResult:
    scanned: list[str] = field(default_factory=list)
    items_seen: int = 0
    ids_seen: set[str] = field(default_factory=set)
    unfiled: list[Unfiled] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _is_na(cell: str) -> bool:
    """`N/A — rationale` is a deliberate, reviewed decision not to file. Honor it."""
    return cell.strip().lower().startswith(("n/a", "na —", "na -"))


def sweep_findings_doc(path: Path, result: SweepResult) -> None:
    """Collect findings-doc bullets that carry no node id."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        result.notes.append(f"could not read findings doc {path}: {exc}")
        return
    result.scanned.append(str(path))

    in_section = False
    for lineno, raw in enumerate(lines, start=1):
        line = raw.rstrip()
        if line.startswith("#"):
            heading = line.lstrip("#").strip().lower()
            in_section = heading in FINDING_SECTIONS
            continue
        if not in_section:
            continue
        stripped = line.strip()
        # Bullets only. A template placeholder bullet (`- [What was found…]`) is skeleton,
        # not a finding — counting it would make every fresh findings doc look delinquent.
        if not stripped.startswith(("- ", "* ")):
            continue
        body = stripped[2:].strip()
        if not body or (body.startswith("[") and body.endswith("]")):
            continue
        result.items_seen += 1
        ids = NODE_ID_RE.findall(body)
        if ids:
            result.ids_seen.update(ids)
        elif not _is_na(body):
            result.unfiled.append(
                Unfiled(f"{path}:{lineno}", body, "no tracker node id")
            )


def _split_row(line: str) -> list[str]:
    """Cells of a markdown table row, outer pipes discarded."""
    return [c.strip() for c in line.strip().strip("|").split("|")]


def sweep_plan_table(path: Path, result: SweepResult) -> None:
    """Collect deferred-items triage rows whose Tracker Node cell holds no id.

    The column is located by header text, not index — the triage table has gained columns
    before and will again, and a positional read would silently start checking the wrong one.
    """
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        result.notes.append(f"could not read plan file {path}: {exc}")
        return
    result.scanned.append(str(path))

    tracker_col: int | None = None
    for lineno, raw in enumerate(lines, start=1):
        line = raw.rstrip()
        if "|" not in line:
            tracker_col = None          # any non-table line ends the current table
            continue
        cells = _split_row(line)
        lowered = [c.lower() for c in cells]
        if "tracker node" in lowered:
            tracker_col = lowered.index("tracker node")
            continue
        if tracker_col is None:
            continue
        # Separator row (|---|---|)
        if all(set(c) <= set("-: ") for c in cells if c):
            continue
        if tracker_col >= len(cells):
            continue
        # Skip the schema's own illustrative rows (DF-001/2/3 in the reference doc).
        if cells and re.fullmatch(r"DF-00[123]", cells[0]):
            continue
        result.items_seen += 1
        cell = cells[tracker_col]
        ids = NODE_ID_RE.findall(cell)
        if ids:
            result.ids_seen.update(ids)
        elif not _is_na(cell):
            label = cells[0] if cells else "(row)"
            result.unfiled.append(
                Unfiled(f"{path}:{lineno}", f"deferred item {label}", "no tracker node id")
            )


def verify_ids(ids: set[str], result: SweepResult) -> None:
    """Best-effort existence check. A fabricated id reads as satisfied; that is the risk."""
    if not ids:
        return
    if not shutil.which(ITT_BIN):
        result.notes.append(
            f"{ITT_BIN} CLI not found — node ids not verified (omission pass still ran)"
        )
        return
    for node_id in sorted(ids):
        try:
            proc = subprocess.run(
                [ITT_BIN, "--json", "node", "get", node_id],
                capture_output=True, text=True, timeout=20, check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            result.notes.append(f"id verification unavailable ({exc}) — omission pass still ran")
            return
        if proc.returncode != 0:
            # Distinguish "does not exist" from "server unreachable": one unreachable server
            # would otherwise report every id in the run as fabricated.
            blob = (proc.stdout + proc.stderr).lower()
            if any(sig in blob for sig in ("not found", "404", "no such")):
                result.unfiled.append(
                    Unfiled("(tracker)", node_id, f"tracker node does not exist: {node_id}")
                )
            else:
                result.notes.append(
                    f"could not verify {node_id} (server unreachable?) — not treated as missing"
                )
                return


def render(result: SweepResult, *, as_json: bool) -> str:
    if as_json:
        return json.dumps(
            {
                "scanned": result.scanned,
                "items_seen": result.items_seen,
                "ids_seen": sorted(result.ids_seen),
                "unfiled": [vars(u) for u in result.unfiled],
                "notes": result.notes,
            },
            indent=2,
        )

    out: list[str] = []
    for note in result.notes:
        out.append(f"[finding-sweep] note: {note}")
    if not result.unfiled:
        out.append(
            f"[finding-sweep] {result.items_seen} item(s) across {len(result.scanned)} artifact(s); "
            f"all have a tracker node. Nothing to file."
        )
        return "\n".join(out)

    out.append(
        f"[finding-sweep] {len(result.unfiled)} of {result.items_seen} item(s) have no node behind "
        f"them. The rule is to file at DETECTION time (.claude/rules/finding-capture.md) — these "
        f"surfacing here means it was missed. File them now, before this run closes:"
    )
    for item in result.unfiled:
        out.append(f"  • {item.source} — {item.reason}")
        out.append(f"      {item.text[:160]}")
    out.append(
        "  Resolve the target tree from the finding's repo (not your cwd), then:\n"
        "      itt node create --tree <tree-id> --type atomic_task --title '<what is wrong>' \\\n"
        "        --description '<what, where, consequence>' --ac '<checkable outcome>' --repo <repo>\n"
        "  Then write the returned id back into the artifact above."
    )
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--findings-doc", action="append", default=[], help="findings doc to sweep (repeatable)")
    ap.add_argument("--plan-file", action="append", default=[], help="plan file whose triage table to sweep (repeatable)")
    ap.add_argument("--no-verify", action="store_true", help="skip the node-existence check")
    ap.add_argument("--json", action="store_true", dest="as_json", help="emit machine-readable output")
    args = ap.parse_args(argv)

    result = SweepResult()
    for raw in args.findings_doc:
        path = Path(raw)
        if path.is_file():
            sweep_findings_doc(path, result)
    for raw in args.plan_file:
        path = Path(raw)
        if path.is_file():
            sweep_plan_table(path, result)

    if not result.scanned:
        # Binding absent at engine level too — say nothing, change nothing.
        return 0

    if not args.no_verify:
        verify_ids(result.ids_seen, result)

    print(render(result, as_json=args.as_json), file=sys.stderr)
    # Always 0. This hook reports; it never blocks a phase, a plan, or a merge.
    return 0


if __name__ == "__main__":
    sys.exit(main())
