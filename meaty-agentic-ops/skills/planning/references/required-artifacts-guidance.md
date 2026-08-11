# Required Artifacts — Planning Guidance

> How to author the `required_artifacts` manifest (schema: `plan-frontmatter-schema.md` §5.7) so the
> dev-execution pre-execution provisioning gate can guarantee every artifact a plan needs is present
> before execution starts — deploying in-catalog gaps and surfacing (never silently skipping) the
> ones that must be built first. Initiative PRD:
> `docs/project_plans/PRDs/dynamic-artifact-provisioning.md`.

## Why this exists

Plans routinely reference skills/agents/commands/context/MCP/workflows that are **not deployed in the
repo where execution runs**. Historically that failed *reactively* — a mid-execution HITL stall or a
silent fallback to a generic agent. The fix is to **declare** the full artifact set at planning time,
tag each with an availability status, and let a pre-execution gate resolve it. Declaring is the half
that derivation can't do: you cannot derive an artifact that does not exist yet.

## Two sets, one loop

| | **Declared** (this doc) | **Derived** (P2 `skillmeat project reconcile`) |
|---|---|---|
| Source | The planner authors `required_artifacts` | A scanner reads `.claude/` conventions (`assigned_to`, `Skill()`, `agentType`, `/ns:cmd`) |
| Can express not-yet-existing? | Yes (`needs_creation`/`needs_enhancement`) | No |
| Role | The provisioning input | The safety cross-check |

Until reconcile ships, the gate uses the declared set + the project manifest only. Author the declared
set well and the loop works today.

## The entry shape

```yaml
required_artifacts:
  - {type: agent, name: python-backend-engineer, skillmeat_ref: python-backend-engineer, status: available,      lifecycle: permanent, scope: null,               note: "P2 API work"}
  - {type: skill, name: dataviz,                 skillmeat_ref: dataviz,                 status: available,      lifecycle: ephemeral, scope: plan:this-feature, note: "charts for the report phase"}
  - {type: agent, name: rf-claims-verifier,      skillmeat_ref: null,                    status: needs_creation, lifecycle: ephemeral, scope: plan:this-feature, note: "author in batch_0 before P3"}
```

- **`type`** — `skill | agent | command | mcp | workflow | context_module`.
- **`name`** — as it deploys under `.claude/{agents,skills,commands}` (or the MCP/context id).
- **`skillmeat_ref`** — the SkillMeat catalog name to deploy; `null` when it doesn't exist yet.
- **`status`**:
  - `available` — in the SkillMeat catalog (or already on-disk); the gate deploys it if missing.
  - `needs_creation` — does not exist anywhere; MUST become a `batch_0` authoring task (or a blocker).
  - `needs_enhancement` — exists but must be extended first; MUST become a `batch_0` task against the existing artifact.
- **`lifecycle`** — `permanent` (joins the project's durable set → written to `.claude/aos-artifacts.yaml`) or `ephemeral` (epic/plan-scoped, torn down on completion).
- **`scope`** — for ephemeral: `epic:<id>` or `plan:<feature_slug>` (the teardown trigger).
- **`note`** — why it's needed / which phase.

Per-phase entries live under `wave_plan.phases[].required_artifacts` (same shape) — the generalization
of `owner_skills` beyond Claude-Code skills, with a type + availability axis `owner_skills` lacks.
Keep `owner_skills` for the narrow "preload this skill's SKILL.md into the phase-owner" case.

## The planning-time resolution step (planning SKILL.md, Workflow 2)

Between **Model Assignment** and the **`/dev:execute-plan` handoff**, run **Required Artifacts
Resolution**:

1. **Enumerate.** From the phase agent-routing + skills + any MCP/workflow/context the plan needs,
   build `required_artifacts` (plan-level and/or per-phase).
2. **Resolve against SkillMeat enterprise** (look-first; `.claude/rules/aos-operating-rules.md`):
   `skillmeat search "<name>" --json` / `skillmeat show <name> --type <t>`. Set `status`:
   - found in catalog or already on-disk → `available`, fill `skillmeat_ref`;
   - not found → `needs_creation`;
   - found but insufficient for the task → `needs_enhancement`.
3. **Route the non-available entries.** Each `needs_creation`/`needs_enhancement` becomes an explicit
   **`batch_0` provisioning task** (mirrors the "External Model Pre-Work Batching" pattern) — authored
   *before* the phase that consumes it — or, if it can't be resolved in-plan, a named **blocker** that
   halts the execute handoff. Never leave a non-available artifact implicit.
4. **Record lifecycle.** Tag each entry `permanent` or `ephemeral` + `scope`. Permanent entries the
   project doesn't already carry should be added to `.claude/aos-artifacts.yaml` (the gate/scaffolder
   maintains this; a planner may seed it).

## What the gate does with it (dev-execution)

`hooks/provision-artifacts.sh`, run before the execution graph is built:
- deploys `available` + `active` entries that are absent on-disk (in-catalog) via `skillmeat deploy`;
- **skips** `status: inactive` manifest entries (linked but not deployed);
- **hard-fails** (explicit list) if an `available`-declared artifact is absent on-disk AND absent from
  the catalog (`skillmeat show` exits 1) — a needed artifact that exists nowhere;
- leaves `needs_creation`/`needs_enhancement` to the `batch_0` tasks you authored (it reports them, it
  does not build them);
- tears down `ephemeral` artifacts scoped to a plan when that plan completes.

## Worked example

A Tier-2 plan whose P2 needs a backend agent (deployed), P3 needs a charting skill (ephemeral, pull
for this plan), and P3 also needs a verifier agent that doesn't exist yet:

```yaml
required_artifacts:
  - {type: agent, name: python-backend-engineer, skillmeat_ref: python-backend-engineer, status: available,      lifecycle: permanent, scope: null,               note: "P2"}
  - {type: skill, name: dataviz,                 skillmeat_ref: dataviz,                 status: available,      lifecycle: ephemeral, scope: plan:my-feature,   note: "P3 charts"}
  - {type: agent, name: my-verifier,             skillmeat_ref: null,                    status: needs_creation, lifecycle: ephemeral, scope: plan:my-feature,   note: "P3; author in batch_0"}
```
Resolution inserts a `batch_0` task "author `my-verifier` agent" before P3; the gate deploys
`python-backend-engineer` (if missing) and `dataviz`, and tears `dataviz` + `my-verifier` down when
`my-feature` completes.
