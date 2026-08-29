#!/usr/bin/env python3
"""provision_artifacts.py — engine for the dev-execution pre-execution artifact provisioning gate.

Classify-and-act runs through ONE route: ``skillmeat project reconcile`` (SM-P4's deterministic
synchronous sync gate — fully qualified, and distinct from the EXISTING top-level
``skillmeat reconcile`` propose-only drift queue, per D-A). SM-P1..P4 shipped on skillmeat
v0.74.0, so the former opt-in env probe (FLEET-014's inert swap-point) and the compose path it
guarded (hand-composed ``show`` / ``deploy`` per entry) are BOTH DELETED — there is no second
classification branch left to drift, and no env var can re-enable one. ``undeploy`` is still
composed directly by ``--teardown`` (see below).

Driven by two inputs:

  * ``.claude/aos-artifacts.yaml`` — the durable per-project manifest (the linked set + lifecycle +
    active/inactive state). Schema: PRD dynamic-artifact-provisioning.md §6.1.
  * a plan's ``required_artifacts`` frontmatter (the declared set for THIS run). Schema:
    plan-frontmatter-schema.md §5.7.

Behavior (provision mode):
  desired-active = manifest permanent+active
                 ∪ manifest ephemeral+active scoped to --scope (if given)
                 ∪ plan required_artifacts with status==available

  That resolved set is handed to ``skillmeat project reconcile <PATH> --manifest <declared>
  --mode <mode> [--plan <planfile>] [--scope <scope>] [--check] --json``, which derives (scanner
  conventions + the DECLARED manifest), diffs against what is on disk, classifies each gap via the
  catalog, and acts. Outcome is read from its frozen ``--json`` payload (expected/present/gaps/
  deployed), never from its exit code — this engine computes its own exit code (below).

  Why the declared set is written to a TEMP manifest rather than forwarding the project's own
  ``.claude/aos-artifacts.yaml`` verbatim: only ``--manifest`` entries can be classified
  ``unsatisfiable`` (ADJ-6; a scanner-DERIVED miss is ``unknown`` and never hard-fails), and
  upstream's declared-set reader deliberately ignores ``lifecycle``/``scope`` (DAP-4.6) and does
  not read a plan's ``required_artifacts`` at all (``--plan`` there means "scan for assigned_to
  conventions"). Forwarding the raw file would therefore (a) stop enforcing plan-declared entries
  — the exact quiet-gate failure this gate exists to prevent — and (b) start enforcing
  out-of-scope ephemerals. So THIS engine stays the authority on *which* artifacts are declared,
  active and in-scope; reconcile is the authority on classify-and-act.

  Gap classification → exit code:
    - in_catalog  + mode=auto     → reconcile deploys it (SHA-safe, no overwrite) → reported deployed
    - in_catalog  + mode=sign-off → listed, NOT deployed → exit 2 (await approval)
    - in_catalog  + mode=off/--check → listed, NOT deployed → exit 2 (gate semantics)
    - unsatisfiable (needed, exists nowhere) → ALWAYS exit 2 (hard fail, any mode)
    - type==command + no explicit skillmeat_ref + name on PATH + classified unsatisfiable →
      rescued to present (via: cli) at ONE post-pass choke point every route traverses
      (``_rescue_command_on_path``) — a pre-existing CLI (`op`, `skillmeat`) is not a deployable
      artifact, and hard-gating on it was a false positive (5a6a582 / PR #134).
  status==inactive manifest entries are SKIPPED (linked but not deployed).
  Types the on-disk scan cannot verify from a file (``mcp``/``context_module``) are held back from
  reconcile and reported advisory-present — never gated on (unchanged contract; upstream would
  classify an unmapped type ``unsatisfiable``).
  needs_creation / needs_enhancement plan entries are REPORTED, never built (that is a batch_0 task).

Teardown mode (--teardown --scope plan:<slug>) — still composed from ``skillmeat undeploy``:
  undeploy manifest ephemerals whose scope == the given scope AND that are not also permanent;
  rewrite the manifest without them.

Exit codes: 0 = reconciled/no-op/deployed; 2 = hard gate (unsatisfiable, or gaps under sign-off/off/
--check); anything else = infra/crash (the bash wrapper treats non-2 nonzero as non-fatal → exit 0).

A DECLARED gap classified ``unknown`` (the CLI ran but could not answer — auth fault, unreachable
catalog, or an upstream not-found phrasing its matcher does not recognise) exits 0 with
``exit_reason: unverifiable_declared`` and one stderr warning PER entry. Deliberately neither of the
two silent degradations: not ``unsatisfiable`` (that would halt every run on an auth fault, and
"I couldn't check" is not "it doesn't exist" — .claude/rules/artifact-provisioning.md), and not
``reconciled`` (a gate that reports all-clear on an unanswered question reads exactly like a pass).

A DECLARED ``PROJECT_LOCAL_TYPES`` entry (today: ``rule_file``) is verified against its real on-disk
path rather than through the CLI, which cannot deploy the type at all. Absent ⇒ exit 0 with
``exit_reason: local_artifact_missing`` and one stderr warning per entry — loud, but not a halt,
since the artifact demonstrably exists upstream. The hard gate for that class is commit-time
(``tests/test_rule_file_refs.py``), not run-time.

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
import tempfile
from pathlib import Path

# Types the on-disk scan cannot verify from a file (config-backed) — reported, never gated on.
# The on-disk presence check itself now lives entirely in `skillmeat project reconcile` (one route,
# one implementation); this engine only decides which types are eligible to be classified at all.
UNVERIFIABLE_TYPES = {"mcp", "context_module"}

# Types the SkillMeat CLI cannot deploy but that ARE verifiable at a known project-local path.
# `skillmeat show/deploy --type` accepts only skill|command|agent|orchestration, so a declared
# `rule_file` handed to `project reconcile` comes back an unmapped type ⇒ DECLARED ⇒ exit 2 — a
# hard halt for an artifact that is present on disk and merely un-deployable through that lane
# (upstream gap: node_01KZEH51A9SRGJRZ92ZKFZXV53). Rather than lie about it in either direction we
# verify these ourselves, against the path the artifact actually occupies.
#
# Not folded into UNVERIFIABLE_TYPES on purpose: that set means "cannot be checked, so never
# gated". These CAN be checked, so an absence here is a real finding, reported loudly — which is
# the whole reason `rule_file:delegation-modes` is declared at all
# (node_01KZEG43PQ1JTJQQTF8C8CHFHN: referenced by 26 files, present in none).
PROJECT_LOCAL_TYPES = {"rule_file": ".claude/rules/{name}.md"}


def _project_local_path(project: Path, entry: dict) -> Path | None:
    """Resolve a PROJECT_LOCAL_TYPES entry to its on-disk path, or None if not such a type."""
    tmpl = PROJECT_LOCAL_TYPES.get(entry.get("type") or "")
    if not tmpl:
        return None
    return project / tmpl.format(name=entry["name"])


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


def _norm_entry(e: dict) -> dict:
    return {
        "type": e.get("type"),
        "name": e.get("name"),
        "skillmeat_ref": e.get("skillmeat_ref") or e.get("name"),
        # Did the author explicitly assert a SkillMeat ref? A null/absent ref means "this is not
        # claimed to be a SkillMeat artifact", which is what makes the CLI-fallback below safe.
        "has_ref": e.get("skillmeat_ref") is not None,
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


def _rescue_command_on_path(desired: list[dict], present_list: list, gaps: list, unsatisfiable: list):
    """ONE choke point every classify route traverses: rescue a pre-existing CLI from the hard gate.

    A ``type: command`` entry with NO explicit ``skillmeat_ref`` (the author asserted "this is not
    claimed to be a SkillMeat artifact") that resolves on ``PATH`` is a pre-existing CLI (`op`,
    `skillmeat`) — not a deployable artifact. Classifying it ``unsatisfiable`` was a false positive
    (fixed for the compose path by 5a6a582 / PR #134): what the plan needs IS available.

    Deliberately a post-pass on the ROUTE'S OUTPUT rather than a branch inside a route: it lived
    inside the compose loop, which is exactly why flipping the default to
    ``skillmeat project reconcile`` would have regressed it. Surface reduction before guard
    proliferation (plan decision, DAP-P2-remaining M1).

    Narrow on purpose:
      * only ``type: command``,
      * only when the author asserted no ``skillmeat_ref``,
      * only when the name resolves on PATH, and
      * only for a gap the route classified ``unsatisfiable`` OR ``unknown`` — an ``in_catalog`` gap
        is a real catalog artifact and must never be shadowed by a same-named binary.

    ``unknown`` is included deliberately. On the enterprise-federated CLI a genuinely-absent
    declared artifact comes back ``unknown`` rather than ``unsatisfiable`` (upstream's not-found
    phrasing is unrecognized — ``node_01KZDA10VEPQV5ERHZT5D0NQZG``), so restricting the rescue to
    ``unsatisfiable`` made it fire offline and never in production: the exact route-specific blind
    spot this post-pass exists to remove. The rescue's premise does not depend on the gap status at
    all — the binary resolves on PATH, so what the plan needs IS available however the catalog
    lookup landed.

    Returns the (possibly rebuilt) ``(present_list, gaps, unsatisfiable)`` triple.
    """
    rescuable = {
        e["name"]
        for e in desired
        if e.get("type") == "command" and not e.get("has_ref", True) and shutil.which(e["name"])
    }
    if not rescuable:
        return present_list, gaps, unsatisfiable

    def _hit(entry: dict) -> bool:
        return entry.get("type") == "command" and entry.get("name") in rescuable

    _RESCUABLE_STATUSES = {"unsatisfiable", "unknown"}
    rescued = [g for g in gaps if _hit(g) and g.get("status") in _RESCUABLE_STATUSES]
    if not rescued:
        return present_list, gaps, unsatisfiable
    rescued_names = {g.get("name") for g in rescued}

    def _drop(entry: dict) -> bool:
        return entry.get("type") == "command" and entry.get("name") in rescued_names

    gaps = [g for g in gaps if not (_drop(g) and g.get("status") in _RESCUABLE_STATUSES)]
    unsatisfiable = [u for u in unsatisfiable if not _drop(u)]
    present_list = list(present_list) + [
        {"name": n, "type": "command", "verified": True, "via": "cli"} for n in sorted(rescued_names)
    ]
    return present_list, gaps, unsatisfiable


def _write_declared_manifest(desired: list[dict]) -> Path | None:
    """Serialize the resolved declared set to a temp ``--manifest`` file for reconcile.

    See the module docstring: only ``--manifest`` entries can be classified ``unsatisfiable``, and
    upstream's declared reader ignores ``lifecycle``/``scope`` and never reads a plan's
    ``required_artifacts``. Writing the ALREADY-RESOLVED set (``_desired_active``) keeps this engine
    the authority on which artifacts are declared/active/in-scope while reconcile owns classify+act.
    Returns None if it could not be written (caller falls back to the project's own manifest).
    """
    try:
        import yaml  # type: ignore

        fd, path = tempfile.mkstemp(prefix="aos-declared-", suffix=".yaml")
        with os.fdopen(fd, "w") as fh:
            yaml.safe_dump(
                {
                    "schema_version": 1,
                    "artifacts": [
                        {
                            "name": e["name"],
                            "type": e["type"],
                            "skillmeat_ref": e["skillmeat_ref"],
                            "status": "active",
                        }
                        for e in desired
                    ],
                },
                fh,
                sort_keys=False,
            )
        return Path(path)
    except Exception as exc:  # noqa: BLE001 — non-fatal; caller degrades loudly
        _warn(f"could not write resolved declared manifest ({exc})")
        return None


# A `skillmeat show` failure has two very different meanings and they must never be conflated:
# the catalog answered "no such artifact" (definitively absent → a declared miss is a hard gate),
# versus the lookup could not be performed at all (401, network, CLI blew up → availability is
# UNKNOWN). Collapsing the second into the first is the same class of error as the standing
# SkillMeat rule "a 401 is a missing-credential bug, not a missing artifact" — it would halt every
# run on an auth fault. Collapsing it the other way is the quiet gate. So: match not-found
# explicitly, and treat everything else as inconclusive.
_NOT_FOUND_MARKERS = (
    "artifact not found",
    "not found on remote node",
    "no such artifact",
    "not found in collection",
)


def _show_absence_verdict(res) -> bool | None:
    """True = definitively absent · False = present in catalog · None = could not determine."""
    if res.returncode == 0:
        return False
    blob = f"{res.stdout or ''}\n{res.stderr or ''}".lower()
    if any(m in blob for m in _NOT_FOUND_MARKERS):
        return True
    return None


def _reconcile_via_project_reconcile(
    project: Path,
    desired: list[dict],
    mode: str,
    check: bool,
    manifest_path: Path | None = None,
    plan: str | None = None,
    scope: str | None = None,
):
    """The ONE classify-and-act route: ``skillmeat project reconcile`` (SM-P4).

    Fully-qualified target = ``skillmeat project reconcile`` (the deterministic synchronous sync
    gate) — distinct from the top-level ``skillmeat reconcile`` propose-only drift queue (D-A).
    Reads outcome from the command's frozen ``--json`` payload (expected/present/gaps/deployed),
    never the process exit code; ``_provision`` computes the exit code from the classified gaps.

    Invocation contract (verified against the real CLI, v0.74.0):
      ``skillmeat project reconcile PATH --manifest F --mode M [--plan F] [--scope S] [--check]
      --json`` — PATH is POSITIONAL (there is no ``--project`` option).
    """
    bin_ = _skillmeat_bin()
    have_cli = shutil.which(bin_) is not None
    expected = [{"name": e["name"], "type": e["type"]} for e in desired]
    if not have_cli:
        gaps = [{"name": e["name"], "type": e["type"], "status": "unknown"} for e in desired]
        return expected, [], gaps, [], [], [], have_cli

    declared = _write_declared_manifest(desired)
    # PATH is positional. --manifest carries the DECLARED set (ADJ-6) — without it reconcile sees
    # only DERIVED expectations, whose misses are `unknown` and NEVER hard-fail: the declared set
    # would silently stop being enforced.
    args = [bin_, "project", "reconcile", str(project), "--json"]
    manifest_arg = declared or (manifest_path if manifest_path and manifest_path.exists() else None)
    if declared is None and manifest_arg is not None:
        _warn(f"falling back to the project manifest for --manifest ({manifest_arg})")
    if manifest_arg is not None:
        args += ["--manifest", str(manifest_arg)]
    if plan:
        args += ["--plan", str(plan)]
    if mode:
        args += ["--mode", mode]
    if scope:
        args += ["--scope", scope]
    # ALWAYS `--check`: reconcile CLASSIFIES, this engine ACTS.
    #
    # Not a style choice. `--manifest` only ADDS to reconcile's scanner derivation, so under
    # `--mode auto` without `--check` reconcile would deploy artifacts this gate never declared —
    # a write nobody asked for, which the compose path could not perform (it deployed only declared
    # `in_catalog` gaps). Leaving it would be a second AC-1 regression, latent rather than visible:
    # it only fires when a DERIVED expectation happens to also be in the catalog (a scanner reading
    # `agentType: 'karen'` out of a workflow derives `agent:karen`, which does exist), so it would
    # have sat quiet until exactly the wrong moment.
    #
    # This keeps M1's actual invariant — ONE classification path, no second classifier to drift —
    # while restoring the engine's authority over what gets written for the set it declared.
    args.append("--check")
    try:
        res = _run(args)
    finally:
        if declared is not None:
            try:
                declared.unlink()
            except OSError:
                pass

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

    # ── Scope the payload back to the DECLARED set ────────────────────────────────────────────
    # `--manifest` ADDS to reconcile's own scanner derivation; it does NOT replace it (its help:
    # "derive the expected set (scanner conventions + optional --manifest DECLARED entries)").
    # Measured on this repo: 15 declared entries -> 88 `expected`, 53 gaps, every one of them
    # `origin: derived` (scanner finds e.g. `command:my-plugin:hello` inside documentation
    # examples). Left unfiltered that is two live defects, not cosmetics:
    #   * a derived row lands in `in_catalog_gaps` and can exit 2 on an artifact NOBODY declared
    #     (the PR #134 false-positive class, one layer up), and
    #   * under the production default `--mode auto` (no `--check`) reconcile ACTS on derived rows
    #     and DEPLOYS undeclared artifacts — the exact write the empty-declared guard above exists
    #     to prevent.
    # This engine is the authority on which artifacts are declared/active/in-scope, so it keeps
    # only rows it actually declared. `origin` alone is not enough: it is advisory and absent on
    # older payloads, so membership is decided by the (name, type) set we passed in.
    declared_keys = {(e["name"], e["type"]) for e in desired}

    def _is_declared(row: dict) -> bool:
        return (row.get("name"), row.get("type")) in declared_keys

    derived_dropped = [g for g in gaps if not _is_declared(g)]
    gaps = [g for g in gaps if _is_declared(g)]
    present_list = [p for p in present_list if _is_declared(p)]
    deployed = [d for d in deployed if _is_declared(d)]
    if derived_dropped:
        _warn(
            f"ignored {len(derived_dropped)} scanner-derived expectation(s) not in the declared "
            "set (reconcile derives beyond --manifest; this gate only governs declared artifacts)"
        )

    # ── Re-probe `unknown` DECLARED gaps so the hard-gate survives the route swap ─────────────
    # AC: "no behavior regression against the compose path it replaces." The compose path called
    # `skillmeat show` itself and treated a non-zero exit as absent => `unsatisfiable` => exit 2.
    # Reconcile instead reports `unknown` for a declared miss whenever `skillmeat show`'s not-found
    # phrasing is one its matcher doesn't recognize (the enterprise-federated CLI says
    # "Artifact not found on remote node <url>: <type>:<name>"), and `unknown` never hard-fails —
    # so taking reconcile's word for it silently DOWNGRADED a working exit-2 gate to a warning.
    # Fix: ask the same primitive the compose path used, per declared unknown. A definitive answer
    # reclassifies; only a genuinely inconclusive probe stays `unknown`.
    resolved_gaps: list[dict] = []
    for g in gaps:
        if g.get("status") != "unknown":
            resolved_gaps.append(g)
            continue
        entry = next(
            (e for e in desired if (e["name"], e["type"]) == (g.get("name"), g.get("type"))), None
        )
        if entry is None:
            resolved_gaps.append(g)
            continue
        show = _run([bin_, "show", entry["skillmeat_ref"], "--type", entry["type"]])
        verdict = _show_absence_verdict(show)
        if verdict is False:
            resolved_gaps.append({**g, "status": "in_catalog", "status_source": "engine-reprobe"})
        elif verdict is True:
            # Definitively absent from the catalog — what the compose path acted on. exit 2.
            resolved_gaps.append(
                {**g, "status": "unsatisfiable", "status_source": "engine-reprobe"}
            )
        else:
            resolved_gaps.append(g)  # inconclusive → stays unknown (never invented)
    gaps = resolved_gaps

    # The frozen gap shape carries a per-gap status; reuse it for the _provision exit logic.
    unsatisfiable = [g for g in gaps if g.get("status") == "unsatisfiable"]
    in_catalog_gaps = [g for g in gaps if g.get("status") == "in_catalog"]
    # ── Act on DECLARED in_catalog gaps, under auto only ──────────────────────────────────────
    # Reconcile ran with `--check`, so nothing has been written yet. This mirrors the compose
    # path's action semantics exactly: deploy only `in_catalog`, only for artifacts THIS gate
    # declared, only under `mode == auto`, never with `--overwrite` (so a tuned local copy is
    # safe). `sign-off`/`off`/`--check` still report and let `_provision` exit 2.
    if mode == "auto" and not check:
        for g in list(in_catalog_gaps):
            entry = next(
                (e for e in desired if (e["name"], e["type"]) == (g.get("name"), g.get("type"))),
                None,
            )
            if entry is None:
                continue
            res_dep = _run([bin_, "deploy", entry["skillmeat_ref"], "--type", entry["type"],
                            "--project", str(project), "--non-interactive"])
            if res_dep.returncode == 0:
                deployed.append({"name": entry["name"], "type": entry["type"]})
                gaps = [x for x in gaps
                        if not (x.get("name") == entry["name"] and x.get("type") == entry["type"])]
                in_catalog_gaps = [x for x in in_catalog_gaps
                                   if not (x.get("name") == entry["name"]
                                           and x.get("type") == entry["type"])]
            else:
                _warn(f"deploy failed for {entry['type']}:{entry['name']} — "
                      f"{(res_dep.stderr or res_dep.stdout).strip()[:200]}")

    # `expected` is the DECLARED set, always. Echoing reconcile's own `expected` reported 88 for a
    # 15-entry manifest (scanner derivation, per the filter above) — an inflated count from a
    # command whose scope differs from this gate's, which is exactly the kind of number the plan's
    # Rubric refuses ("every count emitted must come from a command whose failure mode is loud").
    return expected, present_list, gaps, deployed, unsatisfiable, in_catalog_gaps, have_cli


def _classify_and_act(
    project: Path,
    desired: list[dict],
    mode: str,
    check: bool,
    manifest_path: Path | None = None,
    plan: str | None = None,
    scope: str | None = None,
):
    """Resolve → route → post-pass. The single choke point `_provision` calls.

    ``skillmeat project reconcile`` is the ONLY route (the opt-in env probe and the hand-composed
    show/deploy branch are both deleted — SM-P1..P4 shipped on v0.74.0). The rescue post-pass runs
    on whatever the route returns, so it can never again be route-specific.
    """
    # Types the on-disk scan cannot verify from a file have no catalog equivalent either, so
    # upstream would classify them `unsatisfiable` (unmapped type ⇒ DECLARED ⇒ hard fail). They
    # have always been advisory-only here — reported, never gated on — so hold them back from the
    # route and report them directly rather than hard-failing on an unverifiable claim.
    reconcilable = [
        e for e in desired
        if e["type"] not in UNVERIFIABLE_TYPES and e["type"] not in PROJECT_LOCAL_TYPES
    ]
    advisory = [
        {"name": e["name"], "type": e["type"], "verified": False}
        for e in desired
        if e["type"] in UNVERIFIABLE_TYPES
    ]

    # Project-local types: verified here, against the real path, because the CLI route cannot
    # classify them without hard-failing on an unmapped type.
    local_present, local_gaps = [], []
    for e in desired:
        path = _project_local_path(project, e)
        if path is None:
            continue
        if path.exists():
            local_present.append({"name": e["name"], "type": e["type"], "verified": True,
                                  "via": "project-local"})
        else:
            local_gaps.append({"name": e["name"], "type": e["type"], "status": "absent_local",
                               "path": str(path.relative_to(project))})

    if reconcilable:
        (expected, present_list, gaps, deployed,
         unsatisfiable, in_catalog_gaps, have_cli) = _reconcile_via_project_reconcile(
            project, reconcilable, mode, check, manifest_path=manifest_path, plan=plan, scope=scope,
        )
    else:
        # Nothing declared for this run (all-inactive manifest, out-of-scope ephemerals only, a plan
        # whose entries are all needs_creation). Do NOT call the route: reconcile would derive
        # scanner expectations from the whole project and, under `auto`, deploy them — writes this
        # gate was never asked to make. Same discipline as the wrapper's binding guard: nothing to
        # bind to means zero `skillmeat` calls.
        expected, present_list, gaps, deployed = [], [], [], []
        unsatisfiable, in_catalog_gaps = [], []
        have_cli = shutil.which(_skillmeat_bin()) is not None

    if advisory:
        expected = list(expected) + [{"name": a["name"], "type": a["type"]} for a in advisory]
        present_list = list(present_list) + advisory

    if local_present or local_gaps:
        expected = list(expected) + [
            {"name": e["name"], "type": e["type"]} for e in (local_present + local_gaps)
        ]
        present_list = list(present_list) + local_present
        gaps = list(gaps) + local_gaps

    present_list, gaps, unsatisfiable = _rescue_command_on_path(
        desired, present_list, gaps, unsatisfiable
    )
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
     unsatisfiable, in_catalog_gaps, have_cli) = _classify_and_act(
        project, desired, mode, args.check,
        manifest_path=manifest_path, plan=args.plan, scope=args.scope,
    )

    # report non-available declared entries (batch_0 territory)
    needs = [
        {"name": (r.get("name")), "type": r.get("type"), "status": r.get("status")}
        for r in plan_reqs
        if r.get("status") in ("needs_creation", "needs_enhancement")
    ]

    unknown_gaps = [g for g in gaps if g.get("status") == "unknown"]
    local_missing = [g for g in gaps if g.get("status") == "absent_local"]

    if unsatisfiable:
        exit_reason = "unsatisfiable"
        rc = 2
    elif in_catalog_gaps and mode == "off":
        exit_reason = "gaps_present_check"
        rc = 2
    elif in_catalog_gaps and mode == "sign-off":
        exit_reason = "sign_off_pending"
        rc = 2
    elif local_missing:
        # Ordered ABOVE the two unknown branches on purpose: this is a PROVEN absence (we stat'd the
        # path ourselves, no CLI involved), and a proven finding must not be masked by an
        # "I couldn't check the catalog" reason computed from unrelated entries. That masking was
        # real in the first cut — a missing rule file reported `skillmeat_unavailable`.
        #
        # NOT `unsatisfiable`: it exists upstream and in enterprise, so "exists nowhere" is false,
        # and halting every execution run in the repo over a doc-shaped artifact is the wrong trade.
        # NOT `reconciled` either — that is the quiet-gate failure. Loud, exit 0; the hard gate for
        # this class is commit-time (tests/test_rule_file_refs.py).
        exit_reason = "local_artifact_missing"
        rc = 0
    elif not have_cli and any(g.get("status") == "unknown" for g in gaps):
        exit_reason = "skillmeat_unavailable"
        rc = 0  # non-fatal: cannot resolve → cannot prove a hard gap
    elif unknown_gaps:
        # The CLI ran but could not answer whether these DECLARED artifacts exist — "I couldn't
        # check" must degrade to neither "it's missing" (that would halt every run on an auth or
        # network fault) NOR "everything reconciled" (a quiet gate reads exactly like a pass).
        # So: non-fatal, but a distinct exit_reason and a per-entry stderr warning, always.
        exit_reason = "unverifiable_declared"
        rc = 0
    else:
        exit_reason = "reconciled"
        rc = 0

    for g in local_missing:
        _warn(
            f"declared {g.get('type')}:{g.get('name')} is MISSING at {g.get('path')} — it is "
            "UNPROVISIONED, not non-existent (.claude/rules/artifact-provisioning.md); restore it "
            "from its upstream, do not hand-roll a replacement"
        )

    for g in unknown_gaps:
        _warn(
            f"declared {g.get('type')}:{g.get('name')} could NOT be verified against the catalog "
            "(status=unknown) — availability is UNKNOWN, not confirmed absent and not confirmed "
            "present; this run was NOT gated on it"
        )

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
