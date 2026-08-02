# AOS workflow set — **v4.1** (Claude-5-gen doctrine + gate tiering)

Frozen **2026-08-02**. This is the production plan → execute workflow set as it stands after the
Claude-5-generation doctrine refactor (v4, spec §7) and the gate-tiering amendment (v4.1, spec §8).
It is the **current** set, snapshotted so it has a reproducible pin rather than only a pair of
commit SHAs.

> **History only.** The live set is the upstream paths. Do not edit anything under this
> directory to change behavior, and do not point day-to-day work at it. See
> [`../README.md`](../README.md).

## Cross-links

| Where | Identifier |
|---|---|
| SkillMeat enterprise bundle | **`aos-workflow-set`** version **`4.1.0`** — ⚠️ **not yet cut** (registry holds `3.5.0`); see [Remaining](#remaining--the-enterprise-bundle) |
| Git tag | **`workflow-set-v4.1`** (this repo, on the snapshot commit) |
| Snapshot directory | `meaty-agentic-ops/workflow-sets/v4.1/` (here) |
| Launchpad source ref | `agentic_meta_dev` `main` @ `46cd8ac` |
| MeatySkills source ref | `MeatySkills` `ibm-main` @ `32b05f1` |
| Spec | `agentic_meta_dev/docs/project_plans/design-specs/claude5-plan-doctrine-v1.md` §5 (versioning), §7 (v4), §8 (v4.1 gate tiering) |
| Hand-off pack | `agentic_meta_dev/docs/enablement/workflow-set-v4.1-handoff/` — the prose companion to this pin |

## What's in it — 33 members

Full inventory with per-member content hashes: [`MANIFEST.yaml`](MANIFEST.yaml).

- **7 skills** — `planning`, `dev-execution`, `skillmeat-cli`, `op`, `delivery-report`,
  `delegation-router`, `model-playbook`
- **14 commands** — `/dev:` `execute-plan`, `execute-phase`, `execute-contract`, `autopilot`,
  `quick-feature`, `create-feature`; `/plan:` `plan-feature`, `explore`, `spike`, `design`,
  `plan-story`, `plan-from-gh`, `ultra_think`, `architecture-scenario-explorer`
- **6 agents** — `implementation-planner`, `phase-owner`, `feature-sprint-executor`,
  `task-completion-validator`, `karen`, `artifact-tracker`
- **6 orchestrations** — the `Workflow`-tool scripts the `/dev:*` commands run: `execute-plan`,
  `execute-contract`, `auto-feature`, `spike`, `explore`, `review-council`

Frozen copies live under `artifacts/<type>/<name>/`.

### What changed since v3.5

The set's **boundary did not move** — same 33 members, no additions, no removals, same
`excluded:` block. The doctrine refactor changed *contents*, not membership:

| | Count | Members |
|---|---|---|
| Changed | **14** | `skill:planning`, `skill:dev-execution`, `skill:skillmeat-cli`, `skill:delivery-report`, `skill:delegation-router`, `skill:model-playbook`, `command:execute-plan`, `command:plan-feature`, `command:plan-from-gh`, `agent:feature-sprint-executor`, `agent:task-completion-validator`, `agent:karen`, `orchestration:execute-plan`, `orchestration:auto-feature` |
| Byte-identical | **19** | the remaining commands, `agent:implementation-planner`, `agent:phase-owner`, `agent:artifact-tracker`, `skill:op`, and the `spike`/`explore`/`review-council`/`execute-contract` orchestrations |

Reproduce that diff from the two manifests' `content_hash` fields — it is derived data, not a
maintained list.

### Deliberately excluded

Recorded in `MANIFEST.yaml` under `excluded:` so the diff has an explicit boundary:
`skill-dev`, `artifact-tracking`, `workflow-authoring`, `plan-status`, `plan-review`,
`artifact-validator` — authoring/meta-layer and read-only surfaces, not the plan → execute path.
(`skill-dev` stays excluded from the *set* even though it is now registered in the enterprise
catalog in its own right — catalog presence and set membership are different questions.)

## Verify this snapshot

```bash
python3 meaty-agentic-ops/workflow-sets/make-snapshot.py verify v4.1
# -> 33/33 members verified in v4.1
```

The manifest's content hashes are the version pin: SkillMeat bundle membership is `type:name`
only, so the bundle records *which* artifacts, and this manifest records *which bytes*.

## Depending on this set

A skill that needs to declare currency against the set pins it here rather than at a commit:

```yaml
depends_on:
  - id: skill:dev-execution
    snapshot: workflow-set-v4.1
```

`make-snapshot.py verify v4.1` is the currency check behind such a pin.

## Restore / deploy v4.1

```bash
# straight from the frozen copies
cp -R artifacts/skill/dev-execution ~/.claude/skills/dev-execution

# from the enterprise registry — once the 4.1.0 bundle is cut (see below)
skillmeat bundle deploy aos-workflow-set --version 4.1.0
```

Run `verify` first if the frozen copies have been sitting a while.

## Remaining — the enterprise bundle

Two of the contract's three artifacts exist (this directory + the git tag). The third — enterprise
bundle `aos-workflow-set` `4.1.0` — has **not** been cut; the registry still holds `3.5.0` only.
Membership is already decided (the 33 ids in `MANIFEST.yaml`), so cutting it is a registry
operation, not a design one. Run enterprise writes **on the node**.
