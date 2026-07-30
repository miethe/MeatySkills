# AOS workflow set — **v3.5** (pre-Claude-5-gen baseline)

Frozen **2026-07-30**. This is the production plan → execute workflow set as it stood immediately
before the Claude-5-generation doctrine refactor (v4). It is preserved so the pre-v4 behavior
stays reproducible and deployable for other users and legacy-generation models.

> **History only.** The live set is the upstream paths. Do not edit anything under this
> directory to change behavior, and do not point day-to-day work at it. See
> [`../README.md`](../README.md).

## Cross-links

| Where | Identifier |
|---|---|
| SkillMeat enterprise bundle | **`aos-workflow-set`** version **`3.5.0`** (nuc enterprise, `rocket-fedora`) |
| Git tag | **`workflow-set-v3.5`** (this repo, on the snapshot commit) |
| Snapshot directory | `meaty-agentic-ops/workflow-sets/v3.5/` (here) |
| Launchpad source ref | `agentic_meta_dev` `main` @ `24e2bc1` |
| MeatySkills source ref | `MeatySkills` `ibm-main` @ `fe8a18b` |
| Spec | `agentic_meta_dev/docs/project_plans/design-specs/claude5-plan-doctrine-v1.md` §5 |

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

### Deliberately excluded

Recorded in `MANIFEST.yaml` under `excluded:` so the v4 diff has an explicit boundary:
`skill-dev`, `artifact-tracking`, `workflow-authoring`, `plan-status`, `plan-review`,
`artifact-validator` — authoring/meta-layer and read-only surfaces, not the plan → execute path.

## Verify this snapshot

```bash
python3 meaty-agentic-ops/workflow-sets/make-snapshot.py verify v3.5
# -> 33/33 members verified in v3.5
```

The manifest's content hashes are the version pin: SkillMeat bundle membership is `type:name`
only, so the bundle records *which* artifacts, and this manifest records *which bytes*.

## Restore / deploy v3.5

```bash
# from the enterprise registry
skillmeat bundle deploy aos-workflow-set --version 3.5.0

# or straight from the frozen copies
cp -R artifacts/skill/dev-execution ~/.claude/skills/dev-execution
```

Either path must reproduce v3.5 behavior byte-for-byte. Run `verify` first if the frozen copies
have been sitting a while.
