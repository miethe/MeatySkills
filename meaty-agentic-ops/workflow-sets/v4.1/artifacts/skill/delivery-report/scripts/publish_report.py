#!/usr/bin/env python3
"""Actuate a delivery-report writeback envelope: atlas ingest -> resolve scope -> guardrail -> link.

The M2 engine behind design contract D3 (`.claude/worknotes/delivery-report-hosting-and-linking/
implementation-notes.md`). `delivery_report.py export --target atlas` stays pure (deterministic,
offline, no subprocess); ALL actuation — every network/subprocess call — lives here instead, so it
never sits on the render path (AOS constraint 4). This script is manually invocable; the M3
non-fatal wrapper (`publish-report.sh`) is a documented follow-on, not part of this module.

Steps (in this literal order — atlas ingest happens before the guardrail is evaluated, because
hosting the report carries no misattribution risk; only the IntentTree LINK does):

  1. atlas ingest    -- subprocess `python3 -m app.cli.atlas report ingest <html> --envelope
                         <envelope.json> [--project SLUG]` in the sibling `artifact_atlas` repo;
                         parse its `Preview URL: ...` line for the servable URL. A missing/
                         unreachable atlas repo or a non-zero exit is a clean PublishError (exit
                         2) — the non-fatal SWALLOWING of that failure is M3's wrapper's job, not
                         this engine's (D3).
  2. resolve scope   -- route -> target node_id, per the D4 route->node table, walking out from a
                         caller-supplied feature ANCHOR node id (see resolve_scope()).
  3. the guardrail    -- re-read the resolved node (a fresh `itt node get`, never trusting step 2's
                         intermediate reads) and reject LOUDLY — no write — unless all three D4
                         conditions hold: the node exists, its `meta.feature_slug` matches the
                         envelope's subject slug, and its `type` is in the allow-set for the route.
                         This is the headline C2 AC (risk R1 — silent scope misattribution).
  4. itt link report -- the actual write: `itt link report <node> --report-url <url> --route
                         <route> --subject <subject> --ref <link_identity> [--title --revision
                         --truth-status]`. `link_identity` (D2) is passed through VERBATIM from the
                         envelope `delivery_report.py export` produced — never recomputed here.

`--dry-run` performs ONLY steps 2-3 (resolve scope + the guardrail) and skips step 1 (atlas
ingest) entirely: a flag named `--dry-run` must never create or refresh a hosted asset, so the
printed resolution reports its `url` as not-fetched rather than actually hosting the report. The
guardrail needs no URL to evaluate, so nothing about its correctness is lost. It then stops before
step 4: it never issues the IntentTree write the guardrail exists to gate.

`itt link report` may be absent on an installed `itt` snapshot (D5 — a probe, not a crash): when
so, this script exits 3 rather than attempting a write. That is a DISTINCT exit code from a
guardrail rejection (1) or a general error (2), so a wrapper can treat it as a benign "upstream
verb unavailable, skip" the same way `seed_dossier.py` distinguishes its own skip codes.

Exit codes:
  0  link written (or, under --dry-run, the resolution succeeded and WOULD have written)
  1  guardrail rejected the resolved node — scope misattribution (R1); NO write occurred
  2  atlas ingest failure / scope-resolution failure / usage error
  3  `itt link report` verb unavailable on the installed CLI — benign, skip (D5)

Talks to IntentTree ONLY through the `itt` CLI (AOS constraint 7) — never re-implements its HTTP
calls, never imports from the `intenttree` repo.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, NamedTuple

VERSION = "0.1.0"

PREVIEW_URL_RE = re.compile(r"Preview URL:\s*(\S+)")

# D4 route -> allowed node type(s) for the resolved target. Pinned to the real NodeType enum
# (`../intenttree/backend/src/intenttree/models/enums.py:8-28`: root, pillar, work_area,
# work_package, atomic_task, step, milestone, side_quest, quick_win, shared_work, agent_loop,
# intent, note, decision, question, run_request, review_request, document_link) and checked
# against live tree shapes in this initiative, NOT inferred from the taxonomy name alone:
#   - a real "phase" node in this tree is `milestone`-typed (node_01KYWGX689GTWBPXGAZH0J2GMM,
#     "M1 — Report-aware ingest…") — PHASE_TYPES lists `milestone` first for that reason.
#   - a real feature anchor is `work_area`-typed (the live "Delivery Dossier" feature node), not
#     only `work_package` — FEATURE_ANCHOR_TYPES adds `work_area`.
#   - PROGRAM_ROOT_TYPES adds `root` alongside `work_area`/`pillar` per D4's own wording.
FEATURE_ANCHOR_TYPES = {"work_package", "work_area", "atomic_task"}
PROGRAM_ROOT_TYPES = {"root", "pillar", "work_area"}
PHASE_TYPES = {"milestone", "atomic_task", "work_package"}

# D1's no-collapse invariant (mirrors delivery_report.py's STATUS_ROUTES — duplicated rather than
# imported, since this engine only ever talks to delivery_report.py's OUTPUT, an envelope, never
# its code; see the module docstring). These routes recur (one report per phase boundary /
# milestone / go-no-go decision), so `(route, subject)` alone is not a safe link identity.
RECURRING_ROUTES = {"phase", "program", "readiness"}

# The allow-set for a NORMALLY-resolved target (resolve_scope found the specific node it was
# looking for). `phase` no longer unions in FEATURE_ANCHOR_TYPES here: when resolve_scope falls
# back to the anchor (no matching child/ancestor found), check_guardrail is told so via
# `fell_back` and validates against FEATURE_ANCHOR_TYPES directly instead — see check_guardrail.
# That replaces a per-route "OR the anchor's types too" union with one explicit fallback rule,
# so a route's allow-set here only ever describes the node it was actually looking for.
# `readiness` still unions FEATURE_ANCHOR_TYPES unconditionally: for level="feature" (the
# default), the anchor IS the directly-resolved target (fell_back is always False there, not a
# fallback), so its own allow-set — not the fallback path — must accept anchor types.
ROUTE_ALLOWED_TYPES: dict[str, set[str]] = {
    "feature": FEATURE_ANCHOR_TYPES,
    "dossier": FEATURE_ANCHOR_TYPES,
    "phase": PHASE_TYPES,
    "program": PROGRAM_ROOT_TYPES,
    "readiness": FEATURE_ANCHOR_TYPES | PROGRAM_ROOT_TYPES,
}

Runner = Callable[..., "subprocess.CompletedProcess[str]"]


class PublishError(RuntimeError):
    """Atlas ingest / scope-resolution / usage failure (exit 2)."""


class GuardrailRejection(RuntimeError):
    """The D4 misattribution guardrail rejected the resolved node (exit 1). Carries a JSON
    resolution payload as its message so the caller can report exactly what was rejected."""


class VerbUnavailable(RuntimeError):
    """`itt link report` is not present on the installed CLI (exit 3, D5)."""


def slugify(text: Any) -> str:
    text = str(text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def load_envelope(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise PublishError(f"cannot read envelope: {exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PublishError(f"invalid envelope JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise PublishError("envelope root must be an object")
    return data


# --------------------------------------------------------------------- step 1: atlas ingest

def atlas_ingest(atlas_repo: Path, html_path: Path, envelope_path: Path,
                 project: str | None, runner: Runner = subprocess.run) -> str:
    """`python3 -m app.cli.atlas report ingest <html> --envelope <envelope.json>` in the sibling
    artifact_atlas repo's api/ directory; parse its printed `Preview URL:` line."""
    cli_dir = atlas_repo / "api"
    if not cli_dir.is_dir():
        raise PublishError(
            f"artifact_atlas repo not found — expected an 'api' directory at {cli_dir} "
            f"(pass --atlas-repo, or set ATLAS_REPO)"
        )
    cmd = ["python3", "-m", "app.cli.atlas", "report", "ingest", str(html_path),
           "--envelope", str(envelope_path)]
    if project:
        cmd += ["--project", project]
    try:
        result = runner(cmd, cwd=str(cli_dir), capture_output=True, text=True, timeout=120, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise PublishError(f"atlas ingest subprocess failed to launch: {exc}") from exc
    if result.returncode != 0:
        raise PublishError(
            f"atlas ingest exited {result.returncode}: "
            f"{(result.stderr or result.stdout or '').strip()}"
        )
    match = PREVIEW_URL_RE.search(result.stdout or "")
    if not match:
        raise PublishError(f"atlas ingest printed no 'Preview URL:' line: {(result.stdout or '').strip()}")
    return match.group(1)


# ------------------------------------------------------------------------- itt CLI plumbing

def run_itt(itt_bin: str, args: list[str], runner: Runner = subprocess.run) -> "subprocess.CompletedProcess[str]":
    try:
        return runner([itt_bin, *args], capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise PublishError(f"itt CLI invocation failed to launch: {exc}") from exc


def _json_or_none(result: "subprocess.CompletedProcess[str]") -> dict[str, Any] | None:
    if result.returncode != 0:
        return None
    try:
        parsed = json.loads(result.stdout or "")
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def itt_get_node(itt_bin: str, node_id: str, include: str | None = None,
                 runner: Runner = subprocess.run) -> dict[str, Any] | None:
    """Re-read a node. Returns None on a 404 / any non-zero exit (guardrail condition a).

    ``--json`` is a GLOBAL `itt` option and MUST precede the subcommand — `itt --json node get ID`,
    never `itt node get ID --json` (which exits 2 with "No such option '--json'"). Getting this
    wrong is silent and total: every read returns None, so the guardrail concludes every node is
    missing and rejects every link. It fails safe but it fails ALWAYS, which reads exactly like a
    working guardrail. Found only by running against the real CLI — an offline fake that echoes
    JSON regardless of argument order cannot catch it. Same shape as `sdlc-sync.sh`'s
    `itt --json node complete`.
    """
    args = ["--json", "node", "get", node_id]
    if include:
        args += ["--include", include]
    return _json_or_none(run_itt(itt_bin, args, runner=runner))


def link_verb_available(itt_bin: str, runner: Runner = subprocess.run) -> bool:
    """Probe, not a crash (D5): the installed `itt` may be a stale snapshot without `link report`."""
    try:
        result = runner([itt_bin, "link", "report", "--help"], capture_output=True, text=True,
                        timeout=15, check=False)
    except (OSError, subprocess.SubprocessError):
        return False
    if result.returncode == 0:
        return True
    combined = f"{result.stdout or ''}\n{result.stderr or ''}"
    return "No such command" not in combined


# ------------------------------------------------------------------- step 2: scope resolution (D4)

class ScopeResolution(NamedTuple):
    """resolve_scope's result. `fell_back` and `reason` make a silent fallback impossible: the
    caller (publish()) surfaces them in the JSON output as `scope_fallback` / `scope_fallback_reason`
    rather than a resolved node_id nobody can tell apart from a normally-resolved one."""
    node_id: str
    fell_back: bool
    reason: str | None


def resolve_scope(itt_bin: str, route: str, anchor_id: str, level: str | None,
                  runner: Runner = subprocess.run) -> ScopeResolution:
    """Route -> target node_id, walking out from a caller-resolved feature ANCHOR node id.

    feature | dossier  -> the anchor itself. Not a fallback (fell_back=False): there is no search
                           to fall back FROM — the anchor is definitionally the target.
    phase              -> the first child of the anchor whose type is in PHASE_TYPES; falls back
                           to the anchor when no such child exists (D4).
    program            -> the first ancestor of the anchor whose type is in PROGRAM_ROOT_TYPES;
                           falls back to the anchor when the anchor has no such ancestor (D4
                           amendment 2026-08-02, mirroring `phase`'s fallback). Root-level
                           `work_package` anchors with `parent_id: null` are the NORM for a
                           per-initiative node (PF-1/PF-2/PF-3 are all shaped that way), so a hard
                           failure here made the `program` route unusable for the exact node shape
                           this repo uses — found by live-testing against the real tree, where it
                           failed for BOTH a correct and a deliberately-wrong anchor. Falling back
                           to the anchor is safe: it is the top of its own subtree, and the
                           guardrail still independently verifies `meta.feature_slug` — but see
                           check_guardrail: a fallback target is validated against
                           FEATURE_ANCHOR_TYPES, not PROGRAM_ROOT_TYPES, because it IS an anchor,
                           not a program root that happens to also satisfy that set.
    readiness          -> the anchor for a feature-level decision (default, or level="feature",
                           never a fallback), the program root (same ancestor walk — and the same
                           fallback — as `program`) for level="program".
    """
    if route in ("feature", "dossier"):
        return ScopeResolution(anchor_id, False, None)
    if route == "phase":
        node = itt_get_node(itt_bin, anchor_id, include="children", runner=runner)
        for child in (node or {}).get("children") or []:
            if isinstance(child, dict) and child.get("type") in PHASE_TYPES and child.get("id"):
                return ScopeResolution(str(child["id"]), False, None)
        return ScopeResolution(
            anchor_id, True,
            "no phase/milestone child found under the anchor; using the anchor itself",
        )
    if route == "readiness" and level != "program":
        return ScopeResolution(anchor_id, False, None)
    if route == "program" or (route == "readiness" and level == "program"):
        node = itt_get_node(itt_bin, anchor_id, include="ancestors", runner=runner)
        for ancestor in (node or {}).get("ancestors") or []:
            if isinstance(ancestor, dict) and ancestor.get("type") in PROGRAM_ROOT_TYPES and ancestor.get("id"):
                return ScopeResolution(str(ancestor["id"]), False, None)
        # No program-root ancestor: the anchor is the top of its own subtree, so it IS the widest
        # correct target. Fall back rather than fail — the guardrail below still verifies the slug,
        # and (per check_guardrail) validates the TYPE against FEATURE_ANCHOR_TYPES rather than
        # PROGRAM_ROOT_TYPES, which the anchor cannot and should not have to satisfy.
        return ScopeResolution(
            anchor_id, True,
            "no program-root ancestor found above the anchor; using the anchor itself "
            "(it is the top of its own subtree)",
        )
    raise PublishError(f"unknown report route: {route!r}")


# --------------------------------------------------------------- step 3: the guardrail (the C2 AC)

def check_guardrail(node: dict[str, Any] | None, route: str, subject_slug: str,
                    fell_back: bool = False) -> list[str]:
    """Return guardrail violations (D4). Empty -> the write may proceed.

    `fell_back` (from ScopeResolution) changes ONLY the type check, not the slug check: when
    resolve_scope could not find the specific node a route was looking for (no phase/milestone
    child, no program-root ancestor) and fell back to the anchor, the anchor is knowingly being
    linked because no wider/more specific node exists — validating its type against the route's
    normal allow-set (which describes what resolve_scope was searching FOR, not what it fell back
    TO) would be a tautological rejection. Validate against FEATURE_ANCHOR_TYPES instead, since
    that is what a fallback target actually is: an anchor.
    """
    if node is None:
        return ["resolved node does not exist (itt node get returned no result)"]
    violations: list[str] = []
    meta = node.get("meta") or {}
    node_slug = str(meta.get("feature_slug") or "")
    if node_slug != subject_slug:
        violations.append(
            f"resolved node's meta.feature_slug ({node_slug!r}) does not match the envelope's "
            f"subject slug ({subject_slug!r}) — scope misattribution (R1)"
        )
    allowed = FEATURE_ANCHOR_TYPES if fell_back else ROUTE_ALLOWED_TYPES.get(route, set())
    node_type = node.get("type")
    if node_type not in allowed:
        fallback_note = " (fallback target: validated as a feature anchor, not the route's normal allow-set)" if fell_back else ""
        violations.append(
            f"resolved node's type ({node_type!r}) is not in the allow-set for route "
            f"{route!r} ({sorted(allowed)}){fallback_note}"
        )
    return violations


# ------------------------------------------------------------------------ step 4: the actuator

def itt_link_report(itt_bin: str, node_id: str, report_url: str, route: str, subject: str,
                    title: Any, revision: Any, truth_status: Any, ref: str,
                    runner: Runner = subprocess.run) -> dict[str, Any]:
    # `--json` is GLOBAL and must precede the subcommand — see itt_get_node's note.
    args = ["--json", "link", "report", node_id, "--report-url", report_url, "--route", route,
            "--subject", subject, "--ref", ref]
    if title:
        args += ["--title", str(title)]
    if revision is not None:
        args += ["--revision", str(revision)]
    if truth_status:
        args += ["--truth-status", str(truth_status)]
    result = run_itt(itt_bin, args, runner=runner)
    combined = f"{result.stdout or ''}\n{result.stderr or ''}"
    if result.returncode != 0:
        if "No such command" in combined:
            raise VerbUnavailable("itt link report is not available on the installed CLI")
        raise PublishError(f"itt link report exited {result.returncode}: {combined.strip()}")
    parsed = _json_or_none(result)
    return parsed if parsed is not None else {"raw": result.stdout}


# --------------------------------------------------------------------------- orchestration

def publish(envelope: dict[str, Any], envelope_path: Path, *, itt_bin: str, atlas_repo: Path,
           anchor_node_id: str, level: str | None = None, project: str | None = None,
           dry_run: bool = False, runner: Runner = subprocess.run) -> dict[str, Any]:
    route = envelope.get("route")
    subject = envelope.get("subject")
    if not route or not subject:
        raise PublishError("envelope missing route/subject — was it produced by `delivery_report.py export`?")
    if route not in ROUTE_ALLOWED_TYPES:
        raise PublishError(f"unknown report route: {route!r}")

    subject_slug = slugify(subject)

    if route in RECURRING_ROUTES:
        # D1 no-collapse invariant, enforced HERE independent of the envelope's `target` —
        # refuse, never synthesize. `build_export`'s own loud-failure gate
        # (delivery_report.py) only fires for `target in {"atlas", "intenttree"}`; an envelope
        # exported to `skillmeat`/`meatywiki`/`ccdash` on a recurring route with no
        # `--instance-key` sails through THAT gate with `link_identity: None` (per
        # `compute_link_identity`'s own no-collapse contract) and would otherwise reach here.
        # Accepting a `... or f"report:{route}:{subject}"` fallback at this layer would
        # manufacture exactly the collapsing identity D1 exists to forbid — two different
        # `phase` reports for the same subject would silently overwrite each other's link row
        # (DI-283) the moment this engine is invoked independently of the M3 hook (D3), which
        # gates on instance_key before ever calling export and so never hits this path.
        if not envelope.get("instance_key") or not envelope.get("link_identity"):
            raise PublishError(
                f"envelope is missing instance_key/link_identity for recurring route {route!r} "
                "— refusing to synthesize one. Re-export with `delivery_report.py export "
                "--instance-key <key>` (the phase/milestone id for phase, the milestone id for "
                "program, the decision date for readiness) before publishing."
            )
        link_identity = envelope["link_identity"]
    else:
        # feature/dossier collapse on (route, subject) BY DESIGN (one report per feature, or a
        # living record regenerated in place) — recomputing a missing link_identity here is
        # correct and intentional; this is NOT the same shape as the recurring-route refusal
        # above, so it stays a fallback rather than a hard requirement.
        link_identity = envelope.get("link_identity") or f"report:{route}:{subject}"

    html_path = envelope.get("html_path")
    if not html_path:
        raise PublishError("envelope carries no html_path — re-export with `export --html <path>`")

    verb_ok = link_verb_available(itt_bin, runner=runner)
    if not verb_ok and not dry_run:
        raise VerbUnavailable("itt link report is not available on the installed CLI")

    def _base_resolution(scope: ScopeResolution, violations: list[str]) -> dict[str, Any]:
        resolution = {
            "route": route, "subject": subject, "subject_slug": subject_slug,
            "anchor_node_id": anchor_node_id, "resolved_node_id": scope.node_id,
            "link_identity": link_identity, "itt_link_report_available": verb_ok,
            "guardrail_violations": violations,
            # Surfaced explicitly rather than left silent (a fallback nobody can see is how
            # misattribution creeps back in): true when resolve_scope could not find the specific
            # node a route was looking for and fell back to the anchor.
            "scope_fallback": scope.fell_back,
        }
        if scope.fell_back:
            resolution["scope_fallback_reason"] = scope.reason
        return resolution

    if dry_run:
        # --dry-run runs ONLY steps 2/3 (resolve + guardrail) and NEVER step 1 (atlas ingest):
        # a flag named --dry-run must not create or refresh a hosted asset (it would surprise
        # every caller and defeat the one thing people reach for it for — safely previewing scope
        # resolution). The guardrail needs no URL, so nothing about its correctness is lost.
        scope = resolve_scope(itt_bin, route, anchor_node_id, level, runner=runner)
        node = itt_get_node(itt_bin, scope.node_id, runner=runner)
        violations = check_guardrail(node, route, subject_slug, fell_back=scope.fell_back)
        resolution = _base_resolution(scope, violations)
        resolution["url"] = None
        resolution["url_status"] = "not_fetched — --dry-run never calls atlas ingest"
        if violations:
            raise GuardrailRejection(json.dumps(resolution))
        resolution["would_write"] = True
        return resolution

    # Live path — literal step order preserved: ingest (1) still runs before the guardrail (3)
    # is evaluated, because hosting carries no misattribution risk while the LINK write does; a
    # rejected guardrail still leaves the report hosted, it just never gets pointed at from
    # IntentTree.
    preview_url = atlas_ingest(atlas_repo, Path(html_path), envelope_path, project, runner=runner)
    scope = resolve_scope(itt_bin, route, anchor_node_id, level, runner=runner)
    node = itt_get_node(itt_bin, scope.node_id, runner=runner)
    violations = check_guardrail(node, route, subject_slug, fell_back=scope.fell_back)
    resolution = _base_resolution(scope, violations)
    resolution["url"] = preview_url
    if violations:
        raise GuardrailRejection(json.dumps(resolution))

    # Step 4 — the write, `--ref` carrying D2's link_identity through verbatim.
    link_result = itt_link_report(
        itt_bin, scope.node_id, preview_url, route, str(subject),
        envelope.get("title"), envelope.get("revision"), envelope.get("truth_status"),
        link_identity, runner=runner,
    )
    resolution["written"] = True
    resolution["link_result"] = link_result
    return resolution


# --------------------------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--envelope", type=Path, required=True,
                        help="writeback envelope from `delivery_report.py export --target atlas`")
    parser.add_argument("--html", type=Path, help="override envelope.html_path")
    parser.add_argument("--anchor-node-id", default=os.environ.get("ITT_NODE_ID"),
                        help="the feature ANCHOR node_id (caller-resolved); route resolution "
                             "(D4) walks out from here. Defaults to $ITT_NODE_ID.")
    parser.add_argument("--level", choices=("feature", "program"), default=None,
                        help="for route=readiness only: feature-level (anchor, default) or "
                             "program-level (the program-root ancestor)")
    parser.add_argument("--atlas-repo", type=Path,
                        default=Path(os.environ.get("ATLAS_REPO", "../artifact_atlas")),
                        help="path to the artifact_atlas repo checkout (default: $ATLAS_REPO or "
                             "../artifact_atlas)")
    parser.add_argument("--project", default=None,
                        help="atlas project slug, passed through to `atlas report ingest --project`")
    parser.add_argument("--itt-bin", default=os.environ.get("ITT_BIN", "itt"))
    parser.add_argument("--dry-run", action="store_true",
                        help="resolve + guardrail-check + host the report; print the full "
                             "resolution; never issue the itt link write")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    def emit(payload: dict[str, Any], code: int) -> int:
        if args.json:
            stream = sys.stdout if code == 0 else sys.stderr
            stream.write(json.dumps(payload, indent=2) + "\n")
        elif payload.get("message"):
            stream = sys.stdout if code == 0 else sys.stderr
            stream.write(f"[publish-report] {payload['message']}\n")
        else:
            stream = sys.stdout if code == 0 else sys.stderr
            stream.write(json.dumps(payload, indent=2) + "\n")
        return code

    if not args.anchor_node_id:
        return emit({"ok": False, "status": "usage",
                     "message": "--anchor-node-id is required (or set $ITT_NODE_ID)"}, 2)

    try:
        envelope = load_envelope(args.envelope)
    except PublishError as exc:
        return emit({"ok": False, "status": "bad_envelope", "message": str(exc)}, 2)

    if args.html:
        envelope["html_path"] = str(args.html)

    try:
        result = publish(
            envelope, args.envelope, itt_bin=args.itt_bin, atlas_repo=args.atlas_repo,
            anchor_node_id=args.anchor_node_id, level=args.level, project=args.project,
            dry_run=args.dry_run,
        )
    except GuardrailRejection as exc:
        payload = json.loads(str(exc))
        payload.update({"ok": False, "status": "guardrail_rejected",
                        "message": "scope-misattribution guardrail rejected the resolved node; "
                                   "no IntentTree write occurred (R1)"})
        return emit(payload, 1)
    except VerbUnavailable as exc:
        return emit({"ok": True, "status": "verb_unavailable", "message": str(exc)}, 3)
    except PublishError as exc:
        return emit({"ok": False, "status": "error", "message": str(exc)}, 2)

    result["ok"] = True
    result["status"] = "dry_run" if args.dry_run else "published"
    return emit(result, 0)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
