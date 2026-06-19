---
schema_version: 2
doc_type: spec
title: "auto-feature Workflow Spec — request → plan → gate → execute autopilot"
status: active
phase: 7
created: 2026-06-03
updated: 2026-06-03
owner: nick
related_documents:
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/plans/workflow-orchestration-integration-v1.md
  - .claude/plans/tiered-workflow-overhaul.md
  - .claude/specs/workflows/execute-contract-workflow-spec.md
  - .claude/specs/workflows/execute-plan-workflow-spec.md
  - .claude/specs/workflows/schemas/execution-graph.schema.json
  - .claude/specs/workflows/schemas/execution-report.schema.json
  - .claude/skills/dev-execution/orchestration/workflow-patterns.md
  - .claude/rules/delegation-modes.md
  - .claude/rules/context-budget.md
script: .claude/workflows/auto-feature.js
registry_entry: .claude/specs/workflows/workflow-registry.md
command: .claude/commands/dev/autopilot.md
---

# auto-feature Workflow Spec

Per-workflow contract for `.claude/workflows/auto-feature.js` (the `/dev:autopilot` engine).
Extends, never contradicts, `workflow-authoring-spec.md`. Read the master contract first.

---

## Purpose

`auto-feature` is the **autopilot lane**: it takes a *raw feature request* (not a pre-built
plan), classifies it against the recalibrated tier system, decomposes it into an
ExecutionGraph, applies a deterministic **single-pass feasibility gate**, and — when the work
fits single-pass capacity — executes it end-to-end by **nesting the existing engines**
(`execute-contract` for single-wave work, `execute-plan` for ≤3-wave work), which bring their
own reviewer gate + fix-loop. When the work exceeds single-pass capacity (or hits a Mode D or
SPIKE boundary), it returns `needs_opus` with a specific reason so Opus routes to the
tier-appropriate full-planning flow — **and always leaves a durable plan artifact on disk** so
escalation hands full planning a head start.

It is the single-pass express path defined in `tiered-workflow-overhaul.md`
§ "Opus 4.8 + Autopilot Recalibration".

**Replaces**: the manual `/plan:plan-feature` → review → `/dev:execute-contract` | `/dev:execute-plan`
hand-off chain for work that fits single-pass capacity.
**Fallback**: `/plan:plan-feature` (planning) + the dedicated execute commands remain the path
for anything the gate escalates, and for any run where the operator wants human sign-off
between planning and execution (use `plan_only: true`).

**Reuse, not reimplementation**: `auto-feature` deliberately does NOT reimplement wave
execution, reviewer gating, or fix-loops. Those live in `execute-contract` / `execute-plan`.
This workflow is planner + gate + dispatcher + report consolidation. One level of `workflow()`
nesting only (authoring-spec §1); the nested engines never nest further.

---

## `args` Contract

**Canonical schema**: `.claude/specs/workflows/schemas/execution-graph.schema.json` (extended).

Unlike `execute-contract` / `execute-plan`, `auto-feature` does **not** receive a pre-built
ExecutionGraph. Opus passes a *request envelope*; the Plan phase builds the graph. The script
never reads any file itself (constraint 1) — `request` text and `context_paths` are passed by
Opus; the planner agent reads the codebase.

`const parsed = typeof args === 'string' ? JSON.parse(args) : args`

### Request envelope

| Field | Type | Required | Description |
|---|---|---|---|
| `request` | string | yes | Raw feature request text. The planner reads this verbatim. |
| `request_id` | string | no | REQ-ID from the request-log, for lifecycle tracking by Opus post-run. Passed through; not used by the script. |
| `timestamp` | string | yes | ISO 8601 from Opus. Never `Date.now()` in the script. Threaded into nested-engine args + the plan slug. |
| `budget_total` | integer | no | Default `90000` (plan + structure + nested execute + headroom). Maps to `budget.total`. |
| `context_paths` | string[] | no | Optional seed paths for the planner. Passed verbatim into the plan prompt. Keep narrow. |
| `category` | string | no | `features` \| `enhancements` \| `refactors` \| `harden-polish` \| `infrastructure`. Default `features`. Controls artifact placement; the planner may override based on the request. |
| `ceiling` | object | no | Override of single-pass thresholds. Keys: `max_points` (13), `max_waves` (3), `max_phases` (8), `max_files` (25). Defaults applied per key when omitted. |
| `plan_only` | boolean | no | When `true`, run Plan + Structure + gate, then return `needs_opus` / reason `plan_only` WITHOUT executing. For human sign-off between planning and execution. |
| `dry_run` | boolean | no | Return parsed args immediately without spawning agents. |

---

## Phases

Exactly three `phase()` calls, matching `meta.phases`:

| Phase title | What happens |
|---|---|
| `Plan` | `implementation-planner` (Mode B) explores the codebase, classifies the request into a tier, decomposes it into an ExecutionGraph (or a single-sprint contract envelope), and **writes a durable plan artifact** (Feature Contract or lightweight Implementation Plan) to disk — embedding a fenced `autopilot-graph` JSON block with the verdict fields + graph. Returns a plain-text summary (no schema — two-stage durability). |
| `Structure plan` | `general-purpose` (haiku, schema `AUTOPILOT_PLAN_SCHEMA`) reads the artifact, extracts the `autopilot-graph` block into a structured `AutopilotPlan`. Wrapped in try/catch → `plan_structure_failed` escalation on miss (artifact survives on disk). |
| `Execute` | After the in-script feasibility gate passes, dispatch to the nested engine: `workflow('execute-contract', …)` (single wave) or `workflow('execute-plan', …)` (≤3 waves). The nested engine runs the sprint/wave + reviewer gate + fix-loop and returns an ExecutionReport, which is annotated and returned. |

The **feasibility gate** is deterministic in-script logic between `Structure plan` and `Execute`
— it spawns no agents and therefore has no `phase()` of its own; its decision is surfaced via
`log()`.

---

## Agent Routing

| agentType | Role | edit-less? | Mode | Notes |
|---|---|---|---|---|
| `implementation-planner` | Plan + classify + write artifact (Stage A) | No (writes a planning .md only; Mode B) | B | Heavy stage, NO schema (durability). Writes the plan artifact + embedded graph. |
| `general-purpose` (haiku) | Structure the artifact into `AutopilotPlan` (Stage B) | Read-only by prompt; emits schema | A | try/catch fallback → `plan_structure_failed`. |
| _(nested)_ `execute-contract` | Single-wave sprint + reviewer + fix-loop | — | — | Reviewers inside it are edit-less (`task-completion-validator` / `karen` / `council-review`). |
| _(nested)_ `execute-plan` | ≤3-wave execution + per-phase reviewer gates | — | — | Same edit-less reviewer guarantee. |

Constraint 3 (edit-less reviewers) is satisfied **transitively**: `auto-feature` itself spawns no
reviewer; all review happens inside the nested engines, which already route to edit-less
reviewer `agentType`s. The planner writes only a planning artifact (Mode B), never production
code.

---

## Single-Pass Feasibility Gate (the "too big" wall)

Deterministic, authoritative (the planner's own `single_pass_feasible` is advisory only). After
`Structure plan`, evaluate the `AutopilotPlan` against the ceiling (args override or defaults
`max_points:13, max_waves:3, max_phases:8, max_files:25`). Return early — **before** the Execute
phase — on the FIRST failing predicate:

```
1. plan.mode_d === true                          → needs_opus, reason 'mode_d'
2. plan.needs_spike === true                      → needs_opus, reason 'spike_required'
3. plan.tier >= 3
   || plan.effort_points > max_points
   || plan.wave_count > max_waves
   || plan.phase_count > max_phases
   || plan.file_count  > max_files                → needs_opus, reason 'scope_exceeds_single_pass'
4. parsed.plan_only === true                      → needs_opus, reason 'plan_only'
```

Every early return carries the `autopilot` annotation (incl. `plan_artifact_path` and
`escalation_recommendation`) so Opus can route without re-deriving anything. The checks ordered
so that boundary reasons (Mode D, SPIKE) win over scope reasons, and `plan_only` is evaluated
last (only meaningful when the work was otherwise feasible).

---

## Mode D Handling

Two-tier, mirroring the rest of the system:

1. **Planner classification**: the planner sets `mode_d: true` + `mode_d_reasons[]` when the
   request touches auth / payments / billing / migrations / deletion / secret rotation / infra.
2. **Heuristic backstop**: the script also scans `plan.execution_graph` `files_affected` against
   `HIGH_RISK_PATTERNS` (`auth, payment, billing, migration, alembic, delete, drop_table,
   secret, token`) and forces `mode_d` true on a match, even if the planner missed it.

On Mode D: `return { status: 'needs_opus', reason: 'mode_d', blocked_phase: 'execute', report: [], autopilot }`.
The nested engine is never invoked. Opus runs the work interactively under Mode D discipline
(`delegation-modes.md`).

---

## Dry-Run Mode

`args.dry_run === true`: return `{ status: 'complete', report: [], _dry_run: true, _parsed_args: parsedArgs }`
immediately, before spawning any agents. Used by Opus to validate the envelope.

---

## Plan_only Mode

`args.plan_only === true`: run Plan + Structure + gate, but if the gate would otherwise pass to
Execute, return `{ status: 'needs_opus', reason: 'plan_only', report: [], autopilot }` instead of
nesting an engine. Opus presents the plan + `plan_artifact_path` and relaunches with
`plan_only: false` on a go-ahead. (Boundary reasons — Mode D / SPIKE / scope — still take
precedence and return their own reason; `plan_only` only applies to otherwise-feasible work.)

---

## Pre-conditions

- [ ] Opus has set up an isolated git worktree branch for the run (nested engines require it;
      `auto-feature.js` does not create worktrees — constraint 1).
- [ ] `request` text present and non-empty.
- [ ] `timestamp` is a valid ISO 8601 string set by Opus pre-flight.
- [ ] Working tree clean on the files the planner is likely to touch (best effort; isolation:
      worktree covers the rest).

---

## Post-conditions / Exit Gates

On `status: 'complete'` (execution ran and the nested engine approved), Opus must:

- [ ] Merge the worktree branch into the working branch (git mutation stays with Opus — constraint 1).
- [ ] Run final validation (`pytest` / `pnpm test` + type-check + lint as applicable).
- [ ] Update the plan artifact frontmatter (`status: completed`, `commit_refs`).
- [ ] If `request_id` set, update the request-log item; if a progress file exists, `update-batch.py`.
- [ ] Confirm `report[].phases[].verdict.approved === true` and no `escalate: true`.

On `status: 'needs_opus'`, Opus reads `reason` + the `autopilot` annotation and routes
(see Return Value).

---

## Return Value

Conforms to `execution-report.schema.json`, plus the optional `autopilot` annotation (now
declared in the schema). The `report` array is the nested engine's report on the execute path,
or `[]` on an escalation/plan_only/dry_run return.

| `status` | `reason` | Meaning | Opus action |
|---|---|---|---|
| `complete` | — | Plan feasible, nested engine ran and approved | Merge worktree, validate, complete tracking |
| `needs_opus` | `scope_exceeds_single_pass` | Work too big for single pass | `/plan:plan-feature` (use `autopilot.plan_artifact_path` as head start) |
| `needs_opus` | `spike_required` | Unresolved research unknowns | `/plan:explore` or `/plan:spike` first |
| `needs_opus` / `blocked` | `mode_d` | High-risk boundary | Run interactively under Mode D discipline |
| `needs_opus` | `plan_only` | `plan_only` run; planning done, no execution | Present plan; relaunch with `plan_only:false` on go-ahead |
| `needs_opus` | `plan_structure_failed` | Stage B could not structure the artifact | Read `autopilot.plan_artifact_path`; decide manually |
| `needs_opus` | `reviewer_unresolved` / `budget_exhausted` | Nested engine's fix-loop exhausted | Adjudicate via nested `report[].verdict.required_fixes` |

---

## Patterns Used

- **two-stage structuring** (Plan = Stage A no-schema + Structure = Stage B haiku schema) — durability, mirrors `execute-contract`.
- **modeBoundary** — gate predicate + `HIGH_RISK_PATTERNS` backstop.
- **sub-workflow nesting** — `workflow('execute-contract'|'execute-plan', …)`; one level only.
- _Not used_: `waveFanout` / `reviewerGate` / `fixLoop` directly — delegated to the nested engines.

---

## Budget Convention

`budget_total` defaults to `90000`: ~15K plan + ~5K structure + nested-engine budget
(execute-contract ≈ 50K, execute-plan ≈ higher) + headroom. The script passes a derived
`budget_total` into the nested engine's args based on `plan.effort_points` (`effort_points ×
6250`, mirroring execute-contract §9), clamped to leave the autopilot's own spend covered.
The nested engine enforces its own fix-loop budget guard (`budget.remaining() > 60_000`);
`auto-feature` adds no while-loops of its own, so no additional budget guard is required in this
script.

---

## Extension Points

- **Custom planner**: swap `implementation-planner` for a domain-specific planner via a future
  `args.planner_agent` (keep Mode B, must still write the `autopilot-graph` block).
- **Ceiling tuning**: `args.ceiling` overrides per-key without code changes (telemetry-driven per
  the recalibration's reversion criterion).
- **New escalation reason**: add a predicate to the gate + a `reason` enum value in
  `execution-report.schema.json` + a routing row in the command.
- **plan_only as default for a category**: a future command flag could force `plan_only` for
  high-blast-radius categories (e.g. `infrastructure`).

---

## Four-Constraints Checklist (this workflow)

```
[x] No FS/shell access in script body
    — request text + context_paths passed by Opus; planner agent reads the codebase and
      WRITES the plan artifact; the script reads/writes nothing. Nested git merges are Opus post-run.
[x] Mode D phases trigger early return, never executed
    — planner mode_d flag OR HIGH_RISK_PATTERNS backstop on files_affected → needs_opus before Execute.
      The 'execute' phase (and its nested engine) never spawns for Mode D work.
[x] All reviewer agents use edit-less agentType
    — auto-feature spawns no reviewer; all review is inside nested execute-contract/execute-plan,
      which route to task-completion-validator / karen / council-review (edit-less by definition).
[x] No Date.now() / Math.random() / new Date() in script body
    — timestamp from args.timestamp; threaded into nested args + plan slug.
[x] meta is a pure literal object (no computed values, no function calls)
[x] phase() titles match meta.phases exactly: 'Plan', 'Structure plan', 'Execute'
[x] Budget guard: no while-loops in this script (fix-loops live in nested engines, already guarded)
[x] Durability: Plan (Stage A) has no schema; writes plan artifact to disk before Structure runs
[x] Durability: Structure (Stage B) wrapped in try/catch with plan_structure_failed fallback
[x] Implementation/planner prompt forbids git add/commit/push/stash for the planner (it writes a
    doc only); nested engines own their own commit discipline
[x] args parsed at top (typeof args === 'string' ? JSON.parse : identity)
[x] args.dry_run handled (return parsed args without spawning agents)
```
