# `workflow-sets/` — versioned history of the AOS workflow set

The **AOS workflow set** is the plan → execute lifecycle closure: the planning/execution skills,
the `/dev:*` + `/plan:*` commands, the executor + validator agents, and the orchestration scripts
the commands run. It has been informally versioned per major refactor; this directory is where
each version is frozen when the next one begins.

**The live set is always the upstream paths** (`agentic_meta_dev/.claude/…`,
`meaty-agentic-ops/skills/…`, `meaty-agentic-ops/workflows/…`). This directory holds **history
only** — never edit a snapshot to change behavior, and never point a project at one as its
day-to-day source.

## Why a directory, not a branch

A versioned directory stays visible and deployable side-by-side from `main` indefinitely.
Branches drift, rot, and are invisible to SkillMeat sync. The git tag gives a reproducible
whole-repo pointer; the directory gives discoverability. We keep both.

## Contents

| Path | What |
|---|---|
| `make-snapshot.py` | The generator — `build <label>` freezes a set, `verify <label>` re-hashes it. |
| `v3.5/` | The pre-Claude-5-gen baseline (2026-07-30). See its README. |

## Snapshotting a set

```bash
python3 meaty-agentic-ops/workflow-sets/make-snapshot.py build v3.5 \
  --launchpad ~/dev/homelab/development/agentic_meta_dev
python3 meaty-agentic-ops/workflow-sets/make-snapshot.py verify v3.5
```

`build` copies every member to `<label>/artifacts/<type>/<name>/` and writes `MANIFEST.yaml`
(inventory + a content hash per member + the source repo commits). Point `--launchpad` at a
**clean checkout at the ref you intend to pin**, not at a worktree — the manifest records the
branch and commit it read, and that is the pin.

`MANIFEST.yaml` is the version pin. A SkillMeat bundle's membership is `type:name` only — the
CLI has no per-member version field — so the reproducible pin lives in the manifest's content
hashes, not in the bundle. `verify` re-hashes the frozen copies and fails on any drift.

The member list and the deliberate exclusions live in `make-snapshot.py` (`MEMBERS`,
`EXCLUSIONS`). Editing that list is how the set's boundary changes; the manifest records the
result so each version's scope is explicit and diffable against the next.

## The three artifacts of a snapshot

Every version exists in three cross-linked places (doctrine spec §5):

1. **This directory** — frozen copies + manifest (discoverable, deployable, diffable).
2. **A git tag** `workflow-set-<label>` on the snapshot commit (reproducible whole-repo pointer).
3. **A SkillMeat enterprise bundle** `aos-workflow-set` at the matching semver (canonical
   registry entry; its description carries the repo + tag + dir back-pointer).

## Rollback / coexistence

Older sets stay deployable for other users and legacy-generation models. Either:

```bash
skillmeat bundle deploy aos-workflow-set --version 3.5.0    # from enterprise
```

or copy the frozen members out of `<label>/artifacts/` directly. Both must reproduce the set's
behavior byte-for-byte; `verify` is what proves the frozen copies are still faithful.

## Spec

`agentic_meta_dev/docs/project_plans/design-specs/claude5-plan-doctrine-v1.md` §5
("Workflow-set versioning — v3.5 baseline BEFORE any v4 edit").
