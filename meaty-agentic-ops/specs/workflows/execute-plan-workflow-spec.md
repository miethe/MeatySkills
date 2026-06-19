---
schema_version: 2
doc_type: spec
title: "execute-plan Workflow Spec — Tier 2/3 Plan Execution"
status: active
phase: 1
created: 2026-06-01
owner: nick
related_documents:
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/plans/workflow-orchestration-integration-v1.md
  - .claude/specs/workflows/schemas/execution-graph.schema.json
  - .claude/specs/workflows/schemas/execution-report.schema.json
  - .claude/skills/dev-execution/orchestration/workflow-patterns.md
  - .claude/rules/delegation-modes.md
  - .claude/rules/context-budget.md
script: .claude/workflows/execute-plan.js
---

# execute-plan Workflow Spec

Per-workflow contract for `.claude/workflows/execute-plan.js`. Extends, never contradicts,
`workflow-authoring-spec.md`. Authors: read the master contract first.

---

## Purpose

`execute-plan` is the Tier 2/3 prime target described in `workflow-orchestration-integration-v1.md`
§4 T1. It replaces the manual Opus dispatch-and-poll wave loop in `/dev:execute-plan` with a
deterministic background script that:

- Runs waves sequentially (dependency ordering preserved).
- Fans phases within each wave out in parallel.
- Dispatches tasks through precomputed file-ownership batches (serial batches, parallel within).
- Routes each task to the exact registered specialist named in `task.assigned_to`.
- Gates each phase with a tier-appropriate reviewer; runs a budget-guarded fix-loop on rejection.
- Detects Mode D boundaries and halts, returning control to Opus before any high-risk agents spawn.
- Updates progress YAML per phase via a `trackerStep` agent (no FS in script).
- Returns a structured `ExecutionReport` Opus post-processes for merges, commits, and plan completion.

Replaces: the `parallel(Task(...))` wave loop in the `/dev:execute-plan` command.
Fallback: the `/dev:execute-plan` manual loop remains until Phase 6.

---

## `args` Contract

**Canonical schema**: `.claude/specs/workflows/schemas/execution-graph.schema.json`

The script accepts one `args` value: a serialized `ExecutionGraph`. Opus builds it pre-flight
from the plan's `wave_plan` frontmatter (~2–3K tokens) and passes it when invoking the workflow.
**The script never reads plan files itself** (constraint 1 — no FS access from script).

The script handles the case where `args` arrives as a JSON string (`typeof args === 'string'`);
it calls `JSON.parse` at the top before any destructuring.

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `waves` | `Wave[]` | yes | Sequential dependency levels. Each wave completes before the next begins. |
| `tier` | `1\|2\|3` | yes | Execution tier. Controls reviewer routing. |
| `plan_ref` | `string` | yes | Relative path from repo root to the source plan file. Agents may read it. |
| `timestamp` | `string` | yes | ISO 8601 from Opus pre-flight. Never generated inside the script. |
| `budget_total` | `integer` | no | Token ceiling, derived from plan `effort_estimate`. |
| `dry_run` | `boolean` | no | When `true`, return parsed+validated graph immediately, no agents spawned. |
| `progressFile` | `string` | no | Resolved path to the per-phase progress YAML. Set by Opus pre-flight. |

### Wave, Phase, Task shape

See `execution-graph.schema.json` for the full nested definition. Key fields the script consumes:

**Phase-level** (`waves[].phases[]`):

| Field | Default | Script use |
|---|---|---|
| `mode` | — | `'D'` triggers `modeBoundary` → early return. |
| `review_intensity` | `standard` | `councilEscalation()` routing (per-phase only, NOT tier-derived): `council` → `council-review`; `tier3` → `karen`; `standard`/unset → `task-completion-validator`. Opus pre-flight sets `tier3` ONLY on milestone phases. |
| `isolation` | `shared` | `'worktree'` → `isolation:'worktree'` on each task agent. |
| `phase_strategy` | `static` | `'adaptive'` → single `agentType:'phase-owner'` for the whole phase. |
| `fix_agent` | — | Override agentType for fix-loop; falls back to first task's `assigned_to`. |
| `batches` | — | Precomputed by Opus. Serial outer loop; `parallel()` inner loop per batch. |

**Task-level** (`phases[].tasks[]` and `phases[].batches[][]`):

| Field | Script use |
|---|---|
| `id` | Agent `label` and tracker IDs. |
| `prompt` | Full agent prompt (must include "Do NOT git add/commit/push/stash"). |
| `assigned_to` | `agentType` passed to `agent()`. A value not in the registered agent set (or `hitl: true`) marks the task as a human-in-the-loop gate — see HITL routing below. |
| `model` | Per-agent model override. |
| `isolation` | Per-task override; inherits from Phase if absent. |
| `hitl` | Optional. `true` forces the task to be treated as a human-in-the-loop gate regardless of `assigned_to`. |

---

## Phases

The workflow's `meta.phases` (displayed in `/workflows` TUI):

| Phase title | When active |
|---|---|
| `Dry run` | `args.dry_run === true`. Returns immediately after graph parse. |
| `Wave <id>` | One phase group per wave (e.g. `Wave wave-1`). Created via `phase('Wave wave-1')`. |
| `Review` | Reviewer gate agent calls grouped here across all waves. |
| `Fix cycle <n>` | Per-iteration fix agent calls (e.g. `Fix cycle 1`). |
| `Progress update` | `trackerStep` agent call at the end of each phase. |

`meta.phases` must contain entries for all title strings listed above. See the workflow script
for the complete literal list.

---

## Agent Routing

### Implementation agents (`agentType = task.assigned_to`)

The script reads `task.assigned_to` directly from the execution graph and passes it as `agentType`
to `agent()`. It never hard-codes a specialist — routing is fully driven by the graph Opus builds.

Common values for Tier 2/3 plans (registered in `workflow-authoring-spec.md` §4):
`python-backend-engineer`, `ui-engineer-enhanced`, `ui-engineer`, `frontend-developer`,
`backend-typescript-architect`, `data-layer-expert`, `refactoring-expert`, `openapi-expert`.

**Adaptive phases** (`phase_strategy === 'adaptive'`): the script spawns a single
`agentType:'phase-owner'` for the entire phase and passes the tasks list in the prompt.
The `phase-owner` handles internal batching. This is the narrow fallback only; static dispatch
is always preferred.

### Reviewer routing (`councilEscalation`)

Routing is driven **purely by the per-phase `review_intensity` field** (schema default
`standard`) — it is NOT derived from the plan tier:

```
council-review            ← review_intensity === 'council'
karen                     ← review_intensity === 'tier3'
task-completion-validator ← 'standard' or unset (default)
```

**Behavior change (2026-06-02):** the prior rule routed `tier === 3 → karen` on *every*
phase, which silently overrode the per-phase `standard` default and made karen (opus) the
reviewer for all phases of a tier-3 plan. Routing is now per-phase. Opus pre-flight sets
`review_intensity: 'tier3'` ONLY on milestone phases (e.g. end-of-feature documentation,
security-default cutovers); all other phases stay `standard` → `task-completion-validator`.
This aligns the engine with the plan-stated cadence ("validator per phase; karen at
milestones") and removes redundant opus-cost reviewer passes. The `tier` argument is retained
in the `councilEscalation(p, tier)` signature for compatibility but no longer affects routing.

All reviewer `agentType` values are edit-less by their agent definitions (constraint 3). The
script never creates a reviewer from an inline prompt to a write-capable agent.

### HITL routing (human-assigned tasks)

A task whose `assigned_to` is not a registered agentType (e.g. a username like `nick`), or
which sets `hitl: true`, is a **human-in-the-loop gate**. The script:

1. Never passes it to `agent()` (that would attempt to spawn an agent named after a human).
2. Dispatches all the phase's *agent* tasks and runs the reviewer gate on their output as normal.
   (A phase with only HITL tasks skips the reviewer gate — `reviewer_type: 'none'`.)
3. Collects pending HITL tasks into the phase's `hitl_gates`, aggregated at wave level.
4. After the wave's agent work + reviewer gates complete, if any HITL gates remain, returns
   `{ status: 'needs_opus', reason: 'hitl_required', hitl_tasks: [...], report }`.

This honors constraint 2 (no mid-run human sign-off): the workflow completes all automatable
work in the wave, then bubbles the human gate up to Opus rather than blocking the wave up front.
Opus coordinates the human review — in the near term as a HITL prompt; once the external task
tracker is wired in, by triggering a review request in that tool — then relaunches the workflow
with the HITL tasks marked complete / trimmed from `args.waves`.

### Tracker agent

`agentType: 'artifact-tracker'` with `model: 'haiku'`. Runs `update-batch.py` once per phase
after `taskOut` is populated. Prompt includes "Do NOT git add/commit/push/stash".

---

## ExecutionReport Output

**Canonical schema**: `.claude/specs/workflows/schemas/execution-report.schema.json`

The workflow always returns a value conforming to this schema. Three terminal states:

| `status` | `reason` | Meaning |
|---|---|---|
| `complete` | — | All waves finished; all reviewer gates approved. |
| `blocked` | `mode_d` | A wave contained a Phase with `mode === 'D'`. `blocked_phase` names it. Opus runs it interactively, then relaunches with a trimmed `args.waves`. |
| `needs_opus` | `reviewer_unresolved` | Fix-loop exhausted (2 cycles) without approval. Opus adjudicates the escalation and decides whether to continue. |
| `needs_opus` | `budget_exhausted` | `budget.remaining()` fell below the fix-loop guard (`60_000`) mid-wave. Partial `report` array returned. |
| `dry_run` | — | `args.dry_run === true`. Returns `{ status: 'dry_run', graph }` immediately. Not an ExecutionReport — see §dryRun below. |

The `report` array contains `WaveResult[]` with per-phase `tasks`, `verdict`, `fix_cycles`,
`escalate`, `files_touched`, and `blockers`. When `reviewer_type === 'council-review'`, the
`verdict` also includes a `council_artifacts` object (paths to all six ARC artifacts under
`.claude/skills/council-review/runs/<date>-<slug>/`).

---

## Opus Pre-flight Graph-Builder Procedure

This section documents what Opus does **before** invoking the workflow. The script cannot
read plan files (constraint 1) — all derivation happens here.

### Step 1 — Read wave_plan frontmatter (~2–3K tokens)

Read only the YAML frontmatter block from the plan file (the `wave_plan` key). Do not read the
full plan body unless a task prompt requires it. Target: `head -n 80` or equivalent frontmatter
slice.

### Step 2 — Build the execution graph

From the frontmatter, construct the `ExecutionGraph` JSON:

1. **Map waves**: each `wave_plan.waves[]` entry → `Wave { id, phases[] }`.
2. **Map phases**: each phase entry → `Phase { id, title, mode, review_intensity, isolation,
   phase_strategy, fix_agent, tasks[], batches[] }`.
3. **Compute batches**: for each phase, group `tasks[]` by `files_affected` disjointness. Tasks
   sharing at least one file go into separate batches (must run serially). Fully disjoint tasks
   go into the same batch (may run in parallel). Result: `batches: Task[][]`.
4. **Detect Mode D**: if any task has `files_affected` paths matching auth/payments/migrations/
   deletion signals (and `mode` is not already set), annotate the phase `mode: 'D'`.
5. **Set `tier`** from the plan's `tier` field.
6. **Set `plan_ref`** to the relative path from repo root.
7. **Set `timestamp`** to the current ISO 8601 string (from Opus, not inside the script).
8. **Set `budget_total`** from `effort_estimate × token_per_point` (default: `effort * 25000`).
9. **Resolve `progressFile`**: `ls -d .claude/progress/<plan-slug>*/` to find the correct
   directory (may have version suffix). Construct path as
   `.claude/progress/<resolved-dir>/phase-<N>-progress.md`. Set as `args.progressFile`.

### Step 3 — Validate before launch

- Confirm every `task.assigned_to` maps to a registered agent (see `workflow-authoring-spec.md` §4).
- Check that any phase touching auth/payments/migrations/deletion has `mode: 'D'`.
- Use `dry_run: true` to inspect the parsed graph before committing to a full run.
- Confirm `budget_total` is set and reasonable (≥ waves × phases × 25K).

### Step 4 — Invoke the workflow

Pass the serialized graph as `args`. Record `git rev-parse HEAD` as the pre-run checkpoint.

### Post-wave responsibilities (not in script)

After each wave completes (script returns `status: 'complete'` or is relaunched from
`needs_opus`):

- Run `git merge --squash` on each worktree branch produced by the wave.
- Record `git rev-parse HEAD` wave checkpoint.
- On `blocked` (Mode D): run the blocked phase interactively, then relaunch the workflow
  with `args.waves` trimmed to the remaining waves.
- On `needs_opus` (reviewer_unresolved): inspect the `verdict.required_fixes` from the
  `ExecutionReport`, adjudicate, and either fix manually or relaunch from the failed phase.

### Post-run responsibilities (not in script)

- Perform final `git commit` / push from the merged working tree.
- Run `manage-plan-status.py` to mark the plan complete.
- Consume `council_artifacts` paths (if any council-review gates ran) and update the
  plan-completion artifact with findings/decision records.

---

## dryRun Short-circuit

When `args.dry_run === true`, the workflow returns immediately after parsing and validating
the graph — before any `agent()` calls are made. Return shape:

```js
{ status: 'dry_run', graph }
```

This is **not** an `ExecutionReport` — it is an inspection artifact only. Opus uses it to
verify the graph before committing to a full run. Use it after Step 2 of the pre-flight
procedure to confirm batch groupings, mode annotations, and reviewer routing before launch.

The dry_run short-circuit is the **first conditional after graph parsing** in the script body.

---

## Tracker / Merge Seam

This section captures the division of labor described in
`workflow-orchestration-integration-v1.md` §3.2 as it applies to this workflow.

| Responsibility | Owner | Mechanism |
|---|---|---|
| Read plan, build execution graph | Opus pre-flight | Frontmatter read → `args` |
| Per-task implementation | Tier-3 agent | `agent(t.prompt, {agentType: t.assigned_to, isolation, model})` |
| Per-task commit (in worktree) | Tier-3 agent | Agent runs `git add/commit` inside its own worktree branch |
| Progress YAML update | `trackerStep` agent | `agentType:'artifact-tracker'` runs `update-batch.py` once per phase |
| Reviewer gate + fix-loop | Script control flow | `while` loop: validate → fix → re-validate, budget-guarded |
| Mode D phase | Workflow boundary | Script returns `{status:'blocked', reason:'mode_d'}`; Opus runs it interactively |
| Cross-wave worktree merge | Opus post-wave | `git merge --squash` after validator pass (human-in-loop) |
| Final commit / push, plan-completion | Opus post-run | From the returned `ExecutionReport` |

**Why cross-wave merges stay with Opus**: git mutations that cross a trust boundary (merge,
push, Mode D code) require a human-in-the-loop. The workflow script has no git access
(constraint 1). Worktree-internal commits by implementation agents are the only git operations
inside the workflow.

---

## Mode D Boundary

Mode D phases (auth, payments, migrations, data deletion, force-push, secret rotation) are
**never executed inside the workflow**. The script detects them in two ways:

1. **Explicit flag**: `phase.mode === 'D'`.
2. **Implicit heuristic** (`modeBoundary` pattern): `files_affected` paths matching
   `/auth/i`, `/payment/i`, `/billing/i`, `/migration/i`, `/alembic/i`, `/delete/i`,
   `/drop_table/i`, `/secret/i`, `/token/i`.

On detection, the script returns:
```js
{ status: 'blocked', reason: 'mode_d', blocked_phase: <phase.id>, report: <partial> }
```

The check runs at the **top of each wave loop**, before any agents are spawned for that wave.
No Mode D phase is ever executed — even partially.

---

## Extension Points

### Adding a new reviewer tier

Add a new `review_intensity` value to the `Phase.review_intensity` enum in
`execution-graph.schema.json`, add an `agentType` entry for the reviewer in
`workflow-authoring-spec.md` §4, and extend the `councilEscalation` routing table in the script.
The fix-loop structure is unchanged.

### Adding a new wave strategy

The current strategies are `static` (default) and `adaptive`. A third strategy (e.g.
`speculative`: dispatch all tasks, cancel on first reviewer approval) can be added by:
1. Adding the value to `Phase.phase_strategy` enum in the schema.
2. Adding a branch in the phase-body section of the script that handles the new strategy.
3. Documenting the strategy here with its routing logic and exit conditions.

### Adding a per-wave post-hook agent

The script has a deliberate gap between wave completion and wave-level reporting. A
`postWaveAgent` field on the Wave schema (optional `agentType` to spawn after all phases pass)
can be added to perform per-wave summaries or structured artifact generation without changing
the core fanout logic. Wire it just before `report.push(...)`.

### Resume from a partial run

Opus rebuilds `args` excluding already-committed waves and relaunches via `scriptPath` +
`resumeFromRunId`. The script's sequential `for (const wave of waves)` loop naturally skips
waves not present in `args.waves`. Ensure Opus trims the `waves` array before relaunch rather
than relying on the script to detect committed state (constraint 1 — no FS in script).

---

## Durability Design (commit-checkpoints + per-task fallback structurer)

Two durability patterns were added to the workflow (see `workflow-authoring-spec.md` §16):

**Commit-checkpoints**: every implementation agent prompt now includes `DURABILITY_FOOTER` — a standard instruction requiring the agent to commit each logical unit of work to its isolated worktree branch before returning. This ensures work survives session interruption, mid-run crash, or a terminal StructuredOutput miss. `fixPrompt` and `adaptivePhasePrompt` both append `DURABILITY_FOOTER`. `reviewPrompt` and `trackerPrompt` do NOT (they are edit-less — correct).

**Per-task fallback structurer**: each static per-task `agent(..., {schema: TASK_RESULT_SCHEMA})` call is now wrapped in try/catch inside its `parallel()` thunk. On a schema miss (throw), a cheap `haiku` / `general-purpose` structurer runs `git log -1`/`git rev-parse HEAD` and emits a minimal `TASK_RESULT_SCHEMA` result (`status:'completed'`, recovered `commit_sha`, summary note). This prevents silent task-drop in `parallel()` (which resolves throwing thunks to `null`) while keeping the happy path single-agent.

The adaptive phase-owner path is schema-free and manually wrapped already — left as-is.

---

## Four-Constraints Checklist

```
[x] No FS/shell access in script body
[x] Mode D phases trigger early return (blocked_phase returned), never executed
[x] All reviewer agents use edit-less agentType (task-completion-validator | karen | council-review)
[x] No Date.now() / Math.random() / new Date() in script body
[x] meta is a pure literal object
[x] phase() titles match meta.phases exactly
[x] Budget guard present in every while/loop-until-dry pattern (budget.remaining() > 60_000)
[x] Durability: DURABILITY_FOOTER appended to static task prompts, fixPrompt, adaptivePhasePrompt
[x] Durability: per-task fallback structurer in try/catch inside parallel() thunk
[x] Durability: reviewPrompt and trackerPrompt do NOT include durability footer (edit-less)
```
