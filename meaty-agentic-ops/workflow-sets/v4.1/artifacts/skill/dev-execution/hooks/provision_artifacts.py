#!/usr/bin/env python3
"""provision_artifacts.py — engine for the dev-execution pre-execution artifact provisioning gate.

Composes ONLY existing SkillMeat CLI primitives (``show`` / ``deploy`` / ``undeploy``) — no
``skillmeat project reconcile`` dependency (that is P2; this engine emits the reconcile frozen
``--json`` shape so the P2 swap is drop-in). Driven by two inputs:

P2 swap-point (FLEET-014 / DF-002): a single inert, documented seam
(``_use_reconcile`` probe → ``_reconcile_via_project_reconcile``) lets an operator opt into
routing the classify+act step through the NEW deterministic sync gate
``skillmeat project reconcile`` (SM-P4) — fully qualified, and distinct from the EXISTING
top-level ``skillmeat reconcile`` propose-only drift queue (D-A naming cross-ref). It is off by
default (``PROVISION_USE_RECONCILE`` unset/false) and changes NOTHING until explicitly flipped
once SM-P4 has landed; when flipped it is a drop-in call producing the same frozen result shape.

  * ``.claude/aos-artifacts.yaml`` — the durable per-project manifest (the linked set + lifecycle +
    active/inactive state). Schema: PRD dynamic-artifact-provisioning.md §6.1.
  * a plan's ``required_artifacts`` frontmatter (the declared set for THIS run). Schema:
    plan-frontmatter-schema.md §5.7.

Behavior (provision mode):
  desired-active = manifest permanent+active
                 ∪ manifest ephemeral+active scoped to --scope (if given)
                 ∪ plan required_artifacts with status==available
  gaps = desired-active − on-disk .claude/{agents,skills,commands,workflows}
  for each gap: ``skillmeat show`` classifies in_catalog|unsatisfiable
    - in_catalog  + mode=auto     → ``skillmeat deploy … --non-interactive`` (SHA-safe, no --overwrite)
    - in_catalog  + mode=sign-off → listed, NOT deployed → exit 2 (await approval)
    - in_catalog  + mode=off/--check → listed, NOT deployed → exit 2 (gate semantics)
    - unsatisfiable (needed, exists nowhere) → ALWAYS exit 2 (hard fail, any mode)
  status==inactive manifest entries are SKIPPED (linked but not deployed).
  needs_creation / needs_enhancement plan entries are REPORTED, never built (that is a batch_0 task).

Teardown mode (--teardown --scope plan:<slug>):
  undeploy manifest ephemerals whose scope == the given scope AND that are not also permanent;
  rewrite the manifest without them.

Exit codes: 0 = reconciled/no-op/deployed; 2 = hard gate (unsatisfiable, or gaps under sign-off/off/
--check); anything else = infra/crash (the bash wrapper treats non-2 nonzero as non-fatal → exit 0).

The bash wrapper (provision-artifacts.sh) owns the master-switch + binding + non-fatal contract; this
engine owns resolution/action/JSON. ``SKILLMEAT_BIN`` overrides the CLI path (tests point it at a fake).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

DEPLOYABLE_DIRS = {
    "skill": "skills",
    "agent": "agents",
    "command": "commands",
    "workflow": "workflows",
}
# Types the on-disk scan cannot verify from a file (config-backed) — reported, never gated on.
UNVERIFIABLE_TYPES = {"mcp", "context_module"}


def _warn(msg: str) -> None:
    print(f"[provision-artifacts] {msg}", file=sys.stderr)


def _load_yaml(path: Path):
    try:
        import yaml  # type: ignore
    except ImportError:
        return None, "pyyaml-missing"
    try:
        with path.open() as fh:
            return yaml.safe_load(fh) or {}, None
    except FileNotFoundError:
        return {}, "not-found"
    except Exception as exc:  # noqa: BLE001 — non-fatal contract
        return None, f"parse-error: {exc}"


def _read_frontmatter(path: Path):
    """Return the parsed YAML frontmatter dict of a markdown plan file (or {})."""
    try:
        text = path.read_text()
    except OSError:
        return {}
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    block = text[3:end]
    try:
        import yaml  # type: ignore

        return yaml.safe_load(block) or {}
    except Exception:  # noqa: BLE001
        return {}


def _skillmeat_bin() -> str:
    return os.environ.get("SKILLMEAT_BIN", "skillmeat")


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True)


def _present(project: Path, atype: str, name: str) -> bool | None:
    """True/False if verifiable on disk; None if this type cannot be verified from a file."""
    base = project / ".claude"
    if atype in UNVERIFIABLE_TYPES:
        return None
    subdir = DEPLOYABLE_DIRS.get(atype)
    if subdir is None:
        return None
    root = base / subdir
    if not root.exists():
        return False
    if atype == "skill":
        return (root / name).is_dir() or (root / f"{name}.md").exists()
    if atype == "workflow":
        return any(root.glob(f"{name}.*"))
    # agent / command may be namespaced under subdirs
    return any(root.rglob(f"{name}.md"))


def _norm_entry(e: dict) -> dict:
    return {
        "type": e.get("type"),
        "name": e.get("name"),
        "skillmeat_ref": e.get("skillmeat_ref") or e.get("name"),
        "status": e.get("status", "available"),
        "lifecycle": e.get("lifecycle", "permanent"),
        "scope": e.get("scope"),
        "tuned": bool(e.get("tuned", False)),
        "note": e.get("note", ""),
    }


def _desired_active(manifest: dict, plan_reqs: list[dict], scope: str | None) -> list[dict]:
    """Compute the set to ensure-present for this run."""
    out: dict[tuple, dict] = {}

    def add(entry: dict):
        key = (entry["type"], entry["name"])
        # first writer wins, but a permanent entry supersedes an ephemeral duplicate
        if key not in out or entry["lifecycle"] == "permanent":
            out[key] = entry

    for raw in manifest.get("artifacts", []) or []:
        e = _norm_entry(raw)
        if e["status"] != "active":
            continue  # inactive → skip (linked but not deployed)
        if e["lifecycle"] == "permanent":
            add(e)
        elif e["lifecycle"] == "ephemeral" and scope and e["scope"] == scope:
            add(e)

    for raw in plan_reqs or []:
        e = _norm_entry(raw)
        if e["status"] == "available":
            add(e)
        # needs_creation / needs_enhancement are reported separately, not provisioned

    return list(out.values())


def _use_reconcile() -> bool:
    """Capability probe for the P2 swap-point (FLEET-014 / DF-002).

    Returns True when the operator opts into routing provisioning through the NEW
    deterministic sync gate ``skillmeat project reconcile`` (SM-P4) instead of composing
    this engine's own ``show`` / ``deploy`` / ``undeploy`` primitives.

    D-A naming cross-ref: the target is the fully-qualified ``skillmeat project reconcile``
    (the NEW deterministic sync gate) — NOT the EXISTING top-level ``skillmeat reconcile``
    (the propose-only drift queue). They are different commands; this seam only ever calls
    the former.

    Inert by default: only an explicit truthy ``PROVISION_USE_RECONCILE`` (1/true/yes/on)
    flips it. When unset/false the compose path runs exactly as before — zero behavior change
    until SM-P4 lands and this is deliberately flipped. (Chosen over a
    ``skillmeat project reconcile --help`` exit-code probe: an env-var opt-in is deterministic,
    offline-testable, and never spawns a subprocess just to sniff capability.)
    """
    return os.environ.get("PROVISION_USE_RECONCILE", "").strip().lower() in {"1", "true", "yes", "on"}


def _reconcile_via_project_reconcile(project: Path, desired: list[dict], mode: str, check: bool):
    """Drop-in swap route: provision via ``skillmeat project reconcile`` (SM-P4).

    Fully-qualified target = ``skillmeat project reconcile`` (the NEW deterministic sync gate,
    DF-002) — distinct from the top-level ``skillmeat reconcile`` propose-only drift queue (D-A).
    Emits the SAME frozen tuple shape as ``_classify_and_act`` so ``_provision`` needs no changes
    when this route is taken. Reads outcome from the command's frozen ``--json`` payload
    (expected/present/gaps/deployed), never the process exit code.
    """
    bin_ = _skillmeat_bin()
    have_cli = shutil.which(bin_) is not None
    expected = [{"name": e["name"], "type": e["type"]} for e in desired]
    if not have_cli:
        gaps = [{"name": e["name"], "type": e["type"], "status": "unknown"} for e in desired]
        return expected, [], gaps, [], [], [], have_cli

    # `skillmeat project reconcile` — the NEW deterministic sync gate (NOT `skillmeat reconcile`).
    args = [bin_, "project", "reconcile", "--project", str(project), "--json"]
    if check or mode in ("off", "sign-off"):
        args.append("--check")
    res = _run(args)

    payload: dict = {}
    if res.stdout and res.stdout.strip().startswith("{"):
        try:
            payload = json.loads(res.stdout)
        except json.JSONDecodeError:
            _warn("project reconcile emitted non-JSON — treating as no reconcile data")
            payload = {}

    present_list = payload.get("present", []) or []
    deployed = payload.get("deployed", []) or []
    gaps = payload.get("gaps", []) or []
    # The frozen gap shape carries a per-gap status; reuse it for the _provision exit logic.
    unsatisfiable = [g for g in gaps if g.get("status") == "unsatisfiable"]
    in_catalog_gaps = [g for g in gaps if g.get("status") == "in_catalog"]
    if not payload.get("expected"):
        payload_expected = expected
    else:
        payload_expected = payload["expected"]
    return payload_expected, present_list, gaps, deployed, unsatisfiable, in_catalog_gaps, have_cli


def _classify_and_act(project: Path, desired: list[dict], mode: str, check: bool):
    # --- P2 swap-point seam (FLEET-014 / DF-002) -----------------------------------
    # Inert by default. When the operator opts in via PROVISION_USE_RECONCILE — i.e. SM-P4's
    # `skillmeat project reconcile` (the NEW deterministic sync gate, fully qualified; NOT the
    # top-level `skillmeat reconcile` propose-only drift queue, per D-A) has landed — route the
    # whole classify+act step through that ONE command instead of composing show/deploy/undeploy
    # below. Probe absent/false ⇒ the compose path runs unchanged.
    if _use_reconcile():
        return _reconcile_via_project_reconcile(project, desired, mode, check)
    # --- default compose path (unchanged) ------------------------------------------
    bin_ = _skillmeat_bin()
    have_cli = shutil.which(bin_) is not None
    expected, present_list, gaps, deployed = [], [], [], []
    unsatisfiable, in_catalog_gaps = [], []

    for e in desired:
        expected.append({"name": e["name"], "type": e["type"]})
        pres = _present(project, e["type"], e["name"])
        if pres is True:
            present_list.append({"name": e["name"], "type": e["type"]})
            continue
        if pres is None:
            # unverifiable type (mcp/context_module) — report as advisory present-unknown
            present_list.append({"name": e["name"], "type": e["type"], "verified": False})
            continue
        # absent → is it in the catalog?
        if not have_cli:
            gaps.append({"name": e["name"], "type": e["type"], "status": "unknown"})
            continue
        show = _run([bin_, "show", e["skillmeat_ref"], "--type", e["type"]])
        if show.returncode == 0:
            gaps.append({"name": e["name"], "type": e["type"], "status": "in_catalog"})
            in_catalog_gaps.append(e)
        else:
            gaps.append({"name": e["name"], "type": e["type"], "status": "unsatisfiable"})
            unsatisfiable.append(e)

    # Act on in_catalog gaps only under auto (never overwrite → tuned artifacts are safe).
    if mode == "auto" and not check and have_cli:
        for e in list(in_catalog_gaps):
            res = _run([bin_, "deploy", e["skillmeat_ref"], "--type", e["type"],
                        "--project", str(project), "--non-interactive"])
            if res.returncode == 0:
                deployed.append({"name": e["name"], "type": e["type"]})
                gaps = [g for g in gaps if not (g["name"] == e["name"] and g["type"] == e["type"])]
                in_catalog_gaps.remove(e)
            else:
                _warn(f"deploy failed for {e['type']}:{e['name']} — {(res.stderr or res.stdout).strip()[:200]}")

    return expected, present_list, gaps, deployed, unsatisfiable, in_catalog_gaps, have_cli


def _emit(payload: dict, as_json: bool):
    if as_json:
        print(json.dumps(payload, indent=2))
    else:
        r = payload["exit_reason"]
        print(f"[provision-artifacts] {r}: "
              f"{len(payload['deployed'])} deployed, {len(payload['gaps'])} gap(s), "
              f"{len(payload['expected'])} expected")
        for g in payload["gaps"]:
            print(f"  - GAP {g['type']}:{g['name']} [{g['status']}]")
        for d in payload["deployed"]:
            print(f"  - deployed {d['type']}:{d['name']}")


def _provision(args) -> int:
    project = Path(args.project).resolve()
    manifest_path = Path(args.manifest) if args.manifest else project / ".claude" / "aos-artifacts.yaml"
    manifest, merr = _load_yaml(manifest_path)
    if manifest is None:
        _warn(f"manifest unreadable ({merr}) — non-fatal, skipping")
        return 0
    plan_reqs = []
    if args.plan:
        fm = _read_frontmatter(Path(args.plan))
        plan_reqs = fm.get("required_artifacts", []) or []

    # mode resolution: flag > manifest policy > default auto
    mode = args.mode or (manifest.get("policy", {}) or {}).get("mode", "auto")
    if args.check:
        mode = "off"

    desired = _desired_active(manifest, plan_reqs, args.scope)
    (expected, present_list, gaps, deployed,
     unsatisfiable, in_catalog_gaps, have_cli) = _classify_and_act(project, desired, mode, args.check)

    # report non-available declared entries (batch_0 territory)
    needs = [
        {"name": (r.get("name")), "type": r.get("type"), "status": r.get("status")}
        for r in plan_reqs
        if r.get("status") in ("needs_creation", "needs_enhancement")
    ]

    if unsatisfiable:
        exit_reason = "unsatisfiable"
        rc = 2
    elif in_catalog_gaps and mode == "off":
        exit_reason = "gaps_present_check"
        rc = 2
    elif in_catalog_gaps and mode == "sign-off":
        exit_reason = "sign_off_pending"
        rc = 2
    elif not have_cli and any(g["status"] == "unknown" for g in gaps):
        exit_reason = "skillmeat_unavailable"
        rc = 0  # non-fatal: cannot resolve → cannot prove a hard gap
    else:
        exit_reason = "reconciled"
        rc = 0

    payload = {
        "expected": expected,
        "present": present_list,
        "gaps": gaps,
        "deployed": deployed,
        "needs": needs,
        "mode": mode,
        "exit_reason": exit_reason,
    }
    _emit(payload, args.json)
    if needs and not args.json:
        for n in needs:
            _warn(f"declared {n['type']}:{n['name']} is {n['status']} — needs a batch_0 task before it runs")
    return rc


def _teardown(args) -> int:
    project = Path(args.project).resolve()
    manifest_path = Path(args.manifest) if args.manifest else project / ".claude" / "aos-artifacts.yaml"
    manifest, merr = _load_yaml(manifest_path)
    if not manifest:
        _warn(f"no manifest to tear down ({merr or 'empty'}) — non-fatal")
        return 0
    scope = args.scope
    if not scope:
        _warn("--teardown requires --scope plan:<slug> — skipping")
        return 0
    bin_ = _skillmeat_bin()
    have_cli = shutil.which(bin_) is not None
    artifacts = manifest.get("artifacts", []) or []
    permanent_keys = {(a.get("type"), a.get("name")) for a in artifacts
                      if a.get("lifecycle") == "permanent"}
    kept, removed = [], []
    for a in artifacts:
        e = _norm_entry(a)
        is_target = (e["lifecycle"] == "ephemeral" and e["scope"] == scope
                     and (e["type"], e["name"]) not in permanent_keys)
        if not is_target:
            kept.append(a)
            continue
        if have_cli:
            res = _run([bin_, "undeploy", e["name"], "--project", str(project),
                        "--type", e["type"], "--force"])
            if res.returncode != 0:
                _warn(f"undeploy failed for {e['type']}:{e['name']} — keeping in manifest (non-fatal)")
                kept.append(a)
                continue
        removed.append({"name": e["name"], "type": e["type"]})
    manifest["artifacts"] = kept
    try:
        import yaml  # type: ignore
        manifest_path.write_text(yaml.safe_dump(manifest, sort_keys=False))
    except Exception as exc:  # noqa: BLE001
        _warn(f"could not rewrite manifest ({exc}) — non-fatal")
    payload = {"torn_down": removed, "scope": scope, "exit_reason": "teardown"}
    _emit({"expected": [], "present": [], "gaps": [], "deployed": [], **payload}, args.json)
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Pre-execution artifact provisioning gate engine.")
    p.add_argument("--project", default=".")
    p.add_argument("--plan", default=None, help="plan file whose required_artifacts to resolve")
    p.add_argument("--manifest", default=None, help="path to .claude/aos-artifacts.yaml")
    p.add_argument("--mode", choices=["auto", "sign-off", "off"], default=None)
    p.add_argument("--check", action="store_true", help="report only; exit 2 on any needed gap")
    p.add_argument("--scope", default=None, help="ephemeral scope, e.g. plan:<slug>")
    p.add_argument("--teardown", action="store_true", help="undeploy plan-scoped ephemerals")
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)
    if args.teardown:
        return _teardown(args)
    return _provision(args)


if __name__ == "__main__":
    sys.exit(main())
