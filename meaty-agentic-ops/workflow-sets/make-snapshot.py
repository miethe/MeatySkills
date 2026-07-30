#!/usr/bin/env python3
"""Snapshot an AOS workflow set into `workflow-sets/<version>/`.

Implements step 1 + step 3 of the workflow-set versioning contract
(`agentic_meta_dev/docs/project_plans/design-specs/claude5-plan-doctrine-v1.md` §5):

  1. Enumerate the set  -> MANIFEST.yaml (inventory + content hashes = the version pin)
  3. Snapshot the set   -> artifacts/<type>/<name>/ frozen copies

The manifest is the pin. SkillMeat bundle membership is `type:name` only — the CLI has no
per-member version field — so the reproducible pin lives here: a content hash per member plus
the source repo commits. `verify` re-hashes a snapshot to prove it has not drifted.

Usage:
    make-snapshot.py build v3.5 [--launchpad PATH] [--force]
    make-snapshot.py verify v3.5
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

WORKFLOW_SETS = Path(__file__).resolve().parent
MEATYSKILLS = WORKFLOW_SETS.parent.parent
DEFAULT_LAUNCHPAD = MEATYSKILLS.parent / "agentic_meta_dev"

# Files that are build/cache noise, never part of an artifact's behavior.
EXCLUDE_NAMES = {".DS_Store", "__pycache__", ".pytest_cache", "node_modules", ".git"}
EXCLUDE_SUFFIXES = {".pyc", ".pyo"}

LP = "launchpad"       # agentic_meta_dev
MS = "meatyskills"     # this repo

# The set = the plan/execute lifecycle closure, per doctrine spec §5 step 1.
# (repo, upstream path relative to that repo, artifact id)
MEMBERS: list[tuple[str, str, str]] = [
    # --- skills -------------------------------------------------------------
    (LP, ".claude/skills/planning", "skill:planning"),
    (LP, ".claude/skills/dev-execution", "skill:dev-execution"),
    (LP, ".claude/skills/skillmeat-cli", "skill:skillmeat-cli"),
    (LP, ".claude/skills/op", "skill:op"),
    (LP, ".claude/skills/delivery-report", "skill:delivery-report"),
    (MS, "meaty-agentic-ops/skills/delegation-router", "skill:delegation-router"),
    (MS, "meaty-agentic-ops/skills/model-playbook", "skill:model-playbook"),
    # --- commands: /dev:* ---------------------------------------------------
    (LP, ".claude/commands/dev/execute-plan.md", "command:execute-plan"),
    (LP, ".claude/commands/dev/execute-phase.md", "command:execute-phase"),
    (LP, ".claude/commands/dev/execute-contract.md", "command:execute-contract"),
    (LP, ".claude/commands/dev/autopilot.md", "command:autopilot"),
    (LP, ".claude/commands/dev/quick-feature.md", "command:quick-feature"),
    (LP, ".claude/commands/dev/create-feature.md", "command:create-feature"),
    # --- commands: /plan:* --------------------------------------------------
    (LP, ".claude/commands/plan/plan-feature.md", "command:plan-feature"),
    (LP, ".claude/commands/plan/explore.md", "command:explore"),
    (LP, ".claude/commands/plan/spike.md", "command:spike"),
    (LP, ".claude/commands/plan/design.md", "command:design"),
    (LP, ".claude/commands/plan/plan-story.md", "command:plan-story"),
    (LP, ".claude/commands/plan/plan-from-gh.md", "command:plan-from-gh"),
    (LP, ".claude/commands/plan/ultra_think.md", "command:ultra_think"),
    (
        LP,
        ".claude/commands/plan/architecture-scenario-explorer.md",
        "command:architecture-scenario-explorer",
    ),
    # --- agents (executors + validators) ------------------------------------
    (LP, ".claude/agents/pm/implementation-planner.md", "agent:implementation-planner"),
    (LP, ".claude/agents/dev/phase-owner.md", "agent:phase-owner"),
    (LP, ".claude/agents/feature-sprint-executor.md", "agent:feature-sprint-executor"),
    (LP, ".claude/agents/task-completion-validator.md", "agent:task-completion-validator"),
    (LP, ".claude/agents/karen.md", "agent:karen"),
    (LP, ".claude/agents/dev/artifact-tracker.md", "agent:artifact-tracker"),
    # --- orchestrations (the Workflow-tool scripts the /dev:* commands run) --
    (MS, "meaty-agentic-ops/workflows/execute-plan.js", "orchestration:execute-plan"),
    (MS, "meaty-agentic-ops/workflows/execute-contract.js", "orchestration:execute-contract"),
    (MS, "meaty-agentic-ops/workflows/auto-feature.js", "orchestration:auto-feature"),
    (MS, "meaty-agentic-ops/workflows/spike.js", "orchestration:spike"),
    (MS, "meaty-agentic-ops/workflows/explore.js", "orchestration:explore"),
    (MS, "meaty-agentic-ops/workflows/review-council.js", "orchestration:review-council"),
]

# Deliberately out of scope, recorded so the v4 diff baseline has an explicit boundary.
EXCLUSIONS: list[tuple[str, str]] = [
    ("skill:skill-dev", "authoring/conformance gate for artifacts — meta-layer, not the plan/execute lifecycle"),
    ("skill:artifact-tracking", "progress-file bookkeeping; orthogonal to the doctrine refactor"),
    ("skill:workflow-authoring", "authors orchestration scripts — meta-layer"),
    ("skill:plan-status", "read-only status surface; no doctrine-bearing content"),
    ("skill:plan-review", "review lens, not part of the plan->execute path"),
    ("agent:artifact-validator", "tracking-artifact validator, paired with skill:artifact-tracking"),
]


def _iter_files(root: Path):
    if root.is_file():
        yield root
        return
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if any(part in EXCLUDE_NAMES for part in p.parts):
            continue
        if p.suffix in EXCLUDE_SUFFIXES:
            continue
        yield p


def content_hash(root: Path) -> tuple[str, int]:
    """Deterministic hash over (relative path, file bytes) for a file or directory."""
    h = hashlib.sha256()
    count = 0
    base = root.parent if root.is_file() else root
    for p in _iter_files(root):
        rel = p.relative_to(base).as_posix()
        h.update(rel.encode())
        h.update(b"\0")
        h.update(hashlib.sha256(p.read_bytes()).digest())
        count += 1
    return "sha256:" + h.hexdigest(), count


def git_info(repo: Path) -> dict:
    def run(*args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
        ).stdout.strip()

    # Untracked files are excluded: they are scratch noise at the repo root, and any untracked
    # file *inside* a member is still captured by that member's content hash.
    return {
        "commit": run("rev-parse", "HEAD"),
        "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
        "tracked_dirty": bool(run("status", "--porcelain", "--untracked-files=no")),
    }


def yaml_dump(data, indent: int = 0) -> str:
    """Minimal YAML emitter — avoids a PyYAML dependency for a build-time script."""
    pad = "  " * indent
    out: list[str] = []
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, (dict, list)) and v:
                out.append(f"{pad}{k}:")
                out.append(yaml_dump(v, indent + 1))
            elif isinstance(v, (dict, list)):
                out.append(f"{pad}{k}: {'{}' if isinstance(v, dict) else '[]'}")
            else:
                out.append(f"{pad}{k}: {_scalar(v)}")
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                lines = yaml_dump(item, indent + 1).split("\n")
                first = lines[0].lstrip()
                out.append(f"{pad}- {first}")
                out.extend(lines[1:])
            else:
                out.append(f"{pad}- {_scalar(item)}")
    return "\n".join(out)


def _scalar(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    s = str(v)
    if s == "" or any(c in s for c in ":#") or s != s.strip():
        return json.dumps(s)
    return s


def resolve(repo_key: str, launchpad: Path) -> Path:
    return launchpad if repo_key == LP else MEATYSKILLS


def build(version: str, launchpad: Path, force: bool) -> int:
    outdir = WORKFLOW_SETS / version
    artifacts = outdir / "artifacts"
    if artifacts.exists():
        if not force:
            print(f"error: {artifacts} exists (use --force to rebuild)", file=sys.stderr)
            return 1
        shutil.rmtree(artifacts)

    repos = {
        "agentic_meta_dev": {"path": str(launchpad), **git_info(launchpad)},
        "MeatySkills": {"path": str(MEATYSKILLS), **git_info(MEATYSKILLS)},
    }

    members = []
    missing = []
    for repo_key, rel, artifact_id in MEMBERS:
        src = resolve(repo_key, launchpad) / rel
        if not src.exists():
            missing.append(f"{artifact_id} -> {src}")
            continue
        atype, name = artifact_id.split(":", 1)
        dest = artifacts / atype / (name + src.suffix if src.is_file() else name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.is_file():
            shutil.copy2(src, dest)
        else:
            shutil.copytree(
                src,
                dest,
                ignore=shutil.ignore_patterns(*EXCLUDE_NAMES, "*.pyc", "*.pyo"),
            )
        digest, nfiles = content_hash(src)
        members.append(
            {
                "id": artifact_id,
                "repo": "agentic_meta_dev" if repo_key == LP else "MeatySkills",
                "upstream_path": rel,
                "snapshot_path": dest.relative_to(outdir).as_posix(),
                "files": nfiles,
                "content_hash": digest,
            }
        )

    if missing:
        print("error: unresolved members:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 1

    manifest = {
        "workflow_set": "aos-workflow-set",
        "version": version.lstrip("v") + ".0" if version.count(".") == 1 else version.lstrip("v"),
        "set_label": version,
        "snapshot_date": date.today().isoformat(),
        "doctrine_status": "pre-Claude-5-gen baseline",
        "spec": "agentic_meta_dev/docs/project_plans/design-specs/claude5-plan-doctrine-v1.md#5",
        "enterprise_bundle": {
            "name": "aos-workflow-set",
            "version": "3.5.0",
            "instance": "nuc enterprise (rocket-fedora, http://127.0.0.1:8080 on-node)",
        },
        "git_tag": "workflow-set-" + version,
        "source_repos": repos,
        "member_count": len(members),
        "members": members,
        "excluded": [{"id": i, "reason": r} for i, r in EXCLUSIONS],
    }

    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "MANIFEST.yaml").write_text(
        "# GENERATED by workflow-sets/make-snapshot.py — do not hand-edit.\n"
        "# Re-verify with: make-snapshot.py verify " + version + "\n"
        + yaml_dump(manifest)
        + "\n"
    )
    print(f"wrote {outdir/'MANIFEST.yaml'} ({len(members)} members)")
    for r, info in repos.items():
        flag = "  ⚠ DIRTY" if info["tracked_dirty"] else ""
        print(f"  {r}: {info['branch']} @ {info['commit'][:12]}{flag}")
    return 0


def verify(version: str) -> int:
    outdir = WORKFLOW_SETS / version
    manifest = outdir / "MANIFEST.yaml"
    if not manifest.exists():
        print(f"error: {manifest} not found", file=sys.stderr)
        return 1

    # Parse only what verify needs (id / snapshot_path / content_hash triples).
    def unquote(s: str) -> str:
        return json.loads(s) if s.startswith('"') else s

    entries, cur = [], {}
    for line in manifest.read_text().splitlines():
        s = line.strip()
        if s.startswith("- id: "):
            if cur:
                entries.append(cur)
            cur = {"id": unquote(s[6:])}
        elif s.startswith("snapshot_path: ") and cur:
            cur["snapshot_path"] = unquote(s[15:])
        elif s.startswith("content_hash: ") and cur:
            cur["content_hash"] = unquote(s[14:])
    if cur:
        entries.append(cur)
    entries = [e for e in entries if "content_hash" in e]

    bad = 0
    for e in entries:
        path = outdir / e["snapshot_path"]
        if not path.exists():
            print(f"MISSING  {e['id']} ({e['snapshot_path']})")
            bad += 1
            continue
        digest, _ = content_hash(path)
        if digest != e["content_hash"]:
            print(f"DRIFT    {e['id']}\n  manifest {e['content_hash']}\n  actual   {digest}")
            bad += 1
    print(f"{len(entries) - bad}/{len(entries)} members verified in {version}")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build a snapshot dir + manifest")
    b.add_argument("version", help="set label, e.g. v3.5")
    b.add_argument("--launchpad", type=Path, default=DEFAULT_LAUNCHPAD)
    b.add_argument("--force", action="store_true")
    v = sub.add_parser("verify", help="re-hash a snapshot against its manifest")
    v.add_argument("version")
    args = ap.parse_args()
    if args.cmd == "build":
        return build(args.version, args.launchpad.resolve(), args.force)
    return verify(args.version)


if __name__ == "__main__":
    raise SystemExit(main())
