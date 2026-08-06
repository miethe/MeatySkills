---
schema_version: 2
doc_type: spec
title: "Workflow Authoring Spec — Master Contract"
status: active
created: 2026-06-01
owner: nick
related_documents:
  - .claude/plans/workflow-orchestration-integration-v1.md
  - .claude/rules/delegation-modes.md
  - .claude/rules/context-budget.md
  - .claude/specs/workflows/schemas/execution-graph.schema.json
  - .claude/specs/workflows/schemas/execution-report.schema.json
  - .claude/skills/dev-execution/orchestration/workflow-patterns.md
  - .claude/skills/council-review/references/output-contract.md
---

# Workflow Authoring Spec — Master Contract

Every SkillMeat workflow composes against this contract. Authors read this spec before writing or modifying any `.claude/workflows/*.js` file. The per-workflow specs (execute-plan, execute-contract, explore-spike, review-council) extend, never contradict, what is defined here.

**Anti-hallucination baseline**: the authoring primitives recorded in §1 are the complete real surface. Do not invent declarative hooks, `on_success:`, `condition:`, or `status_field` fields — these do not exist. The only primitives are `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `args`, `budget`, and `workflow()`.

---

## §1 — Authoring Primitives (real API, complete surface)

Workflows are **plain JavaScript** (not TypeScript). The script body uses only these hooks:

| Primitive | Semantics |
|---|---|
| `agent(prompt, opts?)` | Spawn one subagent. Returns final text, or (with `schema`) a validated object. `opts`: `{label, phase, schema, model, isolation:'worktree', agentType}`. Returns `null` when the user skips. |
| `parallel(thunks)` | Run thunks concurrently. **Barrier** — awaits all before continuing. A throwing thunk resolves to `null`, never rejects. Always `.filter(Boolean)` results before use. |
| `pipeline(items, ...stages)` | Run each item through all stages independently, **no barrier between stages**. Item A can be in stage 3 while B is in stage 1. A throwing stage drops that item to `null`. |
| `phase(title)` | Start a progress group. Subsequent `agent()` calls group under it in the `/workflows` TUI. Pass `{phase}` per-agent inside `parallel`/`pipeline` to avoid races on global phase state. |
| `log(msg)` | Narrator line above the progress tree. Use for wave/phase transition announcements. |
| `args` | Value passed to the Workflow tool's `args` verbatim. The canonical channel for the ExecutionGraph (§3). |
| `budget` | `{total, spent(), remaining()}` — token ceiling derived from the plan. Hard ceiling; fix-loops and any loop-until-dry patterns must guard on `budget.remaining()`. |
| `workflow(name, args)` | Run another saved workflow inline as a sub-step. **One level of nesting only.** |

---

## §2 — `meta` Conventions

Every workflow begins with a **pure literal** `meta` export — no computed values, no function calls, no expressions:

```js
export const meta = {
  name: 'execute-plan',                // kebab-case verb phrase; no skillmeat- prefix required
  description: 'One-sentence purpose and when to use this workflow.',
  phases: [                            // REQUIRED; titles displayed in /workflows TUI
    { title: 'Wave execution' },
    { title: 'Review' },
  ],
  whenToUse: 'Optional: trigger conditions for discoverability.',
}
```

Rules:
- `name`: kebab-case verb phrase; lowercase; hyphens; max 64 chars. Do not use a `skillmeat-` prefix; use kebab-case verb names (e.g. `execute-plan`, `review-council`, `explore-spike`).
- `description` and `phases`: **required**. Omitting either is a constraint violation (§6).
- `whenToUse`: optional but recommended for user-facing workflows.
- `meta` must be a **pure literal object**. No `Date.now()`, no `Math.random()`, no function calls inside `meta`. These break resume (§5, constraint 4).
- Phase titles in `meta.phases` must match the `phase()` calls in the script body exactly. Mismatches cause the TUI to show duplicate or ghost phase groups.

---

## §3 — The `args` Contract and ExecutionGraph Schema

Every execution-style workflow receives a typed `args` envelope. Opus builds this pre-flight from the plan's frontmatter and passes it when invoking the workflow. **The script never reads plan files itself** — that violates constraint 1 (no FS access from script).

**Canonical schema**: `.claude/specs/workflows/schemas/execution-graph.schema.json`

Top-level shape:
```
{
  waves:       Wave[]      // sequential dependency levels
  tier:        1 | 2 | 3   // execution tier
  plan_ref:    string       // path to source plan file (for agents to read)
  timestamp:   string       // ISO 8601 passed from Opus — never Date.now() in script
  budget_total: integer     // maps to budget.total
  dry_run:     boolean      // return parsed graph without spawning agents
}
```

Task-level fields inside `waves[].phases[].tasks[]`:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable identifier, e.g. `TASK-1.1`. Used as agent label and in progress YAML. |
| `prompt` | string | yes | Full agent prompt including Mode marker and file paths. Implementation agent prompts must include "Do NOT git add/commit/push/stash" explicitly. |
| `assigned_to` | string | yes | `agentType` string (see §4). |
| `model` | string | no | Model override. Omit to inherit session model. |
| `effort` | number | no | Story-point estimate from the plan. |
| `files_affected` | string[] | no | Relative paths expected to be modified. Used for file-ownership batching and Mode D detection. |
| `isolation` | `'worktree'` \| `'shared'` | no | Per-task override; inherits from `Phase.isolation`. |
| `mode` | A–E | no | Per-task override; inherits from `Phase.mode`. |

Phase-level fields inside `waves[].phases[]`:

| Field | Type | Notes |
|---|---|---|
| `mode` | A–E | `'D'` triggers the Mode-D boundary rule (§7). |
| `review_intensity` | `standard` \| `tier3` \| `council` | Determines reviewer agentType (§8). |
| `isolation` | `worktree` \| `shared` | Whether agents in this phase need git worktrees. |
| `phase_strategy` | `static` \| `adaptive` | `adaptive` triggers `agentType:'phase-owner'` fallback. |
| `fix_agent` | string | Override agentType for fix-loop. Defaults to first task's `assigned_to`. |
| `batches` | Task[][] | Precomputed by Opus. Each inner array is a batch of Task objects that can safely run in parallel (disjoint file ownership); batches are executed serially within the phase to honor file-ownership ordering. Matches the waveFanout pattern: `for (const batch of batches) { parallel(batch.map(t => agent(t.prompt, {agentType: t.assigned_to, model: t.model}))) }`. |

---

## §4 — Agent Registry Usage

**Prefer `agentType` over inline prompts.** Agent definitions in the registry carry tested `skills`, `permissionMode`, `disallowedTools`, and `model` defaults. Inlining prompts to write-capable agents bypasses those guardrails.

Key registered types relevant to workflows:

| agentType | Role | Notes |
|---|---|---|
| `python-backend-engineer` | Python/FastAPI implementation | `acceptEdits`, project memory |
| `ui-engineer-enhanced` | Frontend + artifact tracking | `acceptEdits`, project memory |
| `ui-engineer` | Frontend implementation | `acceptEdits` |
| `frontend-developer` | React/Next.js | `acceptEdits` |
| `backend-typescript-architect` | TypeScript backend | `acceptEdits` |
| `data-layer-expert` | DB/schema work | `acceptEdits` |
| `refactoring-expert` | Safe refactors | `acceptEdits` |
| `feature-sprint-executor` | Tier 1 sprint | `acceptEdits`, Mode C |
| `phase-owner` | Adaptive phase orchestration | Opus; fallback only (§3) |
| `codebase-explorer` | Read-only investigation | `plan`, Mode A |
| `artifact-tracker` | Progress YAML via CLI | Runs `update-batch.py` |
| `task-completion-validator` | Standard reviewer gate | `plan`, no edit tools, Mode E |
| `karen` | Tier-3 adversarial reviewer | `plan`, no edit tools, Mode E |
| `council-review` | ARC reviewer gate | `plan`, no edit tools, Mode E |
| `code-reviewer` | Diff-based reviewer | `plan`, no edit tools, Mode E |
| `senior-code-reviewer` | Deep code review | `plan`, no edit tools, Mode E |

**Reviewer agents are always edit-less.** Their agent definitions carry `disallowedTools` that prevents writes. Never inline-prompt a write-capable agent as a reviewer — the workflow cannot enforce read-only at the script level (constraint 3, §5).

---

## §5 — The Four Hard Constraints

Every workflow must pass this checklist before saving to `.claude/workflows/`. The `workflow-authoring` skill's validation step runs these checks.

### Constraint 1: No shell or filesystem access from the script itself

The workflow script has no `fs`, `child_process`, `exec`, `readFile`, or equivalent. All file reads and CLI commands are performed **by agents**. This means:

- The plan file cannot be read by the script body. Opus reads it pre-flight and passes the result as `args`.
- `git merge`, `update-batch.py`, and `manage-plan-status.py` must be run by agents or by Opus post-run.
- A tracker step (`agentType:'artifact-tracker'`) runs `update-batch.py` once per phase inside the workflow. Cross-wave merges and final progress writes stay with Opus.

Checklist item: **No `import fs`, `import path`, `exec`, `Deno.readFile`, or any FS/shell call in the script body.**

### Constraint 2: No mid-run human sign-off

The workflow cannot pause to wait for human approval inside its execution. Only tool-permission prompts can do this. The docs are explicit: *"For sign-off between stages, run each stage as its own workflow."*

Consequence: **Mode D (auth, payments, migrations, deletion, force-push, secret rotation) phases must be workflow boundaries.** The script detects them and returns early:

```js
const blocked = wave.phases.find(p => p.mode === 'D')
if (blocked) {
  return { status: 'blocked', reason: 'mode_d', blocked_phase: blocked.id, report }
}
```

Checklist item: **No phase with `mode:'D'` is executed inside the workflow. All Mode D phases trigger a `return { status:'blocked' }` before any agents are spawned for that phase.**

### Constraint 3: Workflow subagents always run `acceptEdits`

Regardless of the session permission mode, all agents spawned inside a workflow run with `acceptEdits`. Read-only enforcement is only possible via the agent's `disallowedTools` definition.

Consequence: **Reviewer agents must always be specified by an `agentType` whose definition carries `disallowedTools` blocking Write/Edit/MultiEdit.** Never inline-prompt a reviewer — the inline prompt cannot enforce read-only.

Checklist item: **All reviewer gate calls use `agentType` from the edit-less set: `task-completion-validator`, `karen`, `council-review`, `code-reviewer`, `senior-code-reviewer`.**

### Constraint 4: Resume is same-session only

If the user exits Claude Code, an in-flight workflow restarts fresh on the next launch (though cached results survive within a session via `scriptPath` + `resumeFromRunId`).

Consequence: **Commit as you go.** Each implementation agent commits its own work inside its worktree. Completed phases survive in git regardless of session interruption. Opus records `git rev-parse HEAD` wave checkpoints; on restart, Opus rebuilds `args` excluding committed waves.

Forbidden in scripts: `Date.now()`, `Math.random()`, argless `new Date()`. These produce different values on resume and break determinism. Pass timestamps via `args` (Opus sets `args.timestamp` pre-flight).

Checklist item: **No `Date.now()`, `Math.random()`, or argless `new Date()` in the script body.**

### Four-Constraints Checklist (copy into every PR / spec review)

```
[ ] No FS/shell access in script body
[ ] Mode D phases trigger early return, never executed
[ ] All reviewer agents use edit-less agentType
[ ] No Date.now() / Math.random() / new Date() in script body
[ ] meta is a pure literal object
[ ] phase() titles match meta.phases exactly
```

---

## §6 — ExecutionReport Schema

**Canonical schema**: `.claude/specs/workflows/schemas/execution-report.schema.json`

Every execution-style workflow returns a value conforming to this schema. Opus post-processes the result to perform cross-wave merges, progress YAML updates, plan-completion artifact authoring, and Mode D escalation.

Top-level shape:

```
{
  status:        'complete' | 'blocked' | 'needs_opus'
  reason?:       'mode_d' | 'reviewer_unresolved' | 'budget_exhausted'
  blocked_phase?: string    // present when status == 'blocked'
  report:        WaveResult[]
}
```

Status semantics:
- `complete`: all waves finished, all reviewer gates approved.
- `blocked`: a Mode D boundary was hit. `blocked_phase` names the phase. Opus runs it interactively, then may resume the remaining waves by relaunching with a trimmed `args.waves`.
- `needs_opus`: fix-loop cycles exhausted with reviewer still disapproving. Opus adjudicates the escalation.

Per-phase result includes: `tasks` (TaskResult with `id`, `assigned_to`, `status`, `commit_sha`, `summary`), `verdict` (ReviewerVerdict with `approved`, `reviewer_type`, optional `required_fixes`), `fix_cycles`, `escalate`, `files_touched`, `blockers`.

When `verdict.reviewer_type === 'council-review'`, the `verdict` includes a `council_artifacts` object with paths to all ARC run artifacts: `run_dir`, `findings_yaml`, `scorecard_json`, `risk_register_yaml`, `decision_record_md`, `validation_plan_md`.

---

## §7 — Governance Reconciliation

Reference: `.claude/rules/delegation-modes.md`

Workflows make some delegation-mode rules enforceable and some moot. The reconciliation:

| Mode | Workflow reality | Rule |
|---|---|---|
| **A — Exploration only** | Subagents run `acceptEdits`; script cannot force read-only. | Use read-only `agentType` (`codebase-explorer`, `Explore`) whose definition carries `disallowedTools`. |
| **B — Contract drafting** | Fine as a workflow stage (planner agents). | No special handling. |
| **C — Autonomous sprint** | Native fit — this is `execute-contract`. | The fix-loop is the sprint's review cycle in code. |
| **D — High-risk change** | No mid-run sign-off exists (constraint 2). | **Mode D = workflow boundary.** Detect via `phase.mode === 'D'` and return `{status:'blocked'}`. Cross-wave merges and pushes also stay with Opus. |
| **E — Reviewer** | Reviewers must remain edit-less (constraint 3). | Always `agentType` of an edit-less reviewer. Never an inline prompt to a write-capable agent. |

**New invariant** (supplements `delegation-modes.md`):
> Workflow agents always run `acceptEdits` and inherit the session tool allowlist. Mode boundaries are enforced by `agentType` selection (for read-only roles) and by returning control to Opus (for Mode D) — never by the workflow script's prompt text alone.

Additional governance rules:

- **Commit-as-you-go**: every implementation agent commits its own work inside its worktree. The script never performs git operations.
- **Worktree merge ownership**: Opus post-wave for all Phases 1–4. A background integrator agent is only evaluated after trust in the pattern is established.
- **Budget-guarded loops**: any `while` or loop-until-dry pattern must include `budget.remaining() > THRESHOLD` as a guard condition. Runaway fix loops are a budget risk.

---

## §8 — Reviewer Gate Routing

The reviewer `agentType` is determined by two inputs from the ExecutionGraph: `tier` (top-level) and `phase.review_intensity`.

| `review_intensity` | Reviewer agentType | Notes |
|---|---|---|
| `standard` | `task-completion-validator` | Default for Tier 2 phases. |
| `tier3` | `karen` | Adversarial reviewer; use for Tier 3 and core-path phases. |
| `council` | `council-review` | ARC run; use for architecture, auth, and core-path phases requiring multi-lens review. |

Reviewer selection in script — driven **purely by the per-phase `review_intensity` field**,
NOT by plan tier. Opus pre-flight sets `tier3` only on milestone phases; everything else stays
`standard`. (A prior `tier === 3 → karen` rule overrode the per-phase `standard` default and made
karen the reviewer for every tier-3 phase — removed 2026-06-02.)

```js
const reviewerType = p.review_intensity === 'council' ? 'council-review'
                   : p.review_intensity === 'tier3' ? 'karen'
                   : 'task-completion-validator'
```

**Fix-loop structure** (standard):

```js
let cycles = 0
while (!verdict.approved && cycles < 2 && budget.remaining() > 60_000) {
  await agent(fixPrompt(p, verdict.required_fixes), {
    phase: `Wave ${wave.id}`,
    agentType: p.fix_agent || taskOut[0]?.assigned_to,
    model: p.model,
  })
  verdict = await agent(reviewPrompt(p, taskOut), {
    phase: 'Review',
    agentType: reviewerType,
    schema: VERDICT_SCHEMA,
  })
  cycles++
}
return { ...phaseResult, fix_cycles: cycles, escalate: !verdict.approved }
```

Fix-loop caps at 2 cycles. If `verdict.approved` is still false after 2 cycles, `escalate: true` propagates to the wave result and triggers `status: 'needs_opus'`.

### §8b — Verdict robustness: a gate that could not run is not a gate that passed

Every reviewer dispatch in every workflow MUST satisfy all five:

1. **The verdict is a validated tool call** — `schema:` on the reviewer `agent()` call, always. Never
   accept a free-text `APPROVED` / `CHANGES_REQUESTED` string and parse it. Without a schema nothing
   forces a decision to exist, so the reviewer can end mid-thought and the caller infers approval
   from tone.
2. **A null verdict is converted, loudly.** `agent()` returns `null` when the subagent dies after
   retries or the user skips it. `verdict?.approved` correctly reads false — but `?? {approved:false}`
   alone loses *why*. Synthesize a verdict tagged `verdict_source: 'gate_failure'` with a named
   reason and `log()` it.
3. **"Did not run" is distinguishable from "said no."** They are different next actions: a rejection
   goes to the fix loop, a gate failure goes to re-dispatch or an explicit operator override. Sending
   a fix loop after a phantom defect burns a fix cycle on nothing and then re-reviews the unchanged
   code.
4. **No `||` fallback reviewer.** An unmapped lens/intensity resolves to a gate failure, not a default
   agent. A `||` fallback to a non-existent agent is how a "5-lens" council silently reviewed 4
   (2026-08-03 agent-roster-drift AAR); `tests/test_workflow_agent_roster.py` now catches the phantom,
   but the silent-fallback *shape* is what let one name take out two lenses.

5. **An unverified approval is not an approval** (R3, 2026-08-06 workflow-v41 delegate retro).
   `VERDICT_SCHEMA` MUST require a `verification_path` object (`established`, `kind`,
   `production_entrypoint`, `evidence`), and the workflow MUST convert an approving verdict whose
   path is not established — or whose `kind` is not one of `live-smoke`, `path-equivalence`,
   `real-endpoint-field-check`, `production-callsite-trace` — into a
   `verdict_source: 'gate_integrity_failure'` with `gate_ran: false`. Its next action matches
   clause 3's gate failure (re-dispatch or an explicit override, never a fix cycle): the verdict
   exists but cannot be trusted, and what did not finish is the reviewer. Separately, any entry in
   `self_reported_claims` MUST downgrade an approval to an ordinary rejection — that one IS
   fix-loop work, because the missing artifact is the implementer's to produce. Enforcement must sit
   at **every** point a verdict lands, including each fix-cycle re-review; a gate that enforces only
   the first pass lets a fix cycle end on an unverified approval. Rationale: in the seven days to
   2026-08-06 the dominant delegate defect was a green suite exercising a path production does not
   take (8 findings, five with the same signature in one program) and the second was legs
   self-reporting side effects they never performed (5 findings). Both classes produce reports that
   satisfy every instruction they were given, so prompt text alone cannot gate them.

**What this does not provide: a wall-clock timeout.** `agent()` exposes no deadline and a script
cannot impose one. What the workflow form buys against a slow reviewer is that the wait is
*observable and out-of-line* — a stalled stage sits in `/workflows` progress under a named phase
instead of freezing the main loop — not that it is bounded. Do not write specs, docs, or prompts
that imply a reviewer is killed after N seconds.

The reference implementation is `.claude/workflows/reviewer-gate.js` (spec:
`reviewer-gate-workflow-spec.md`). Any gate outside `execute-plan`/`execute-contract` should invoke
it rather than re-deriving the pattern; those two keep their own inline reviewer stages, which
already satisfy this section.

---

## §9 — Council-Review Gate Embedding

When a phase declares `review_intensity: 'council'`, the reviewer gate routes to `agentType: 'council-review'`. This embeds the Agent Review Council as a deterministic phase step rather than a separately invoked manual process.

The `council-review` skill (`council-review/SKILL.md`) produces a full ARC run under `runs/<date>-<slug>/`. The required artifacts per the skill's output contract:

- `evidence_pack.md` — source artifacts, constraints, evidence gaps
- `findings.yaml` — structured findings with id, title, claim, finding_type, severity, confidence, evidence, recommendation
- `scorecard.json` — numeric scoring
- `risk_register.yaml` — risk items
- `decision_record.md` — accepted / rejected / disputed / watchlist disposition buckets
- `validation_plan.md` — validation steps for accepted and disputed findings

The reviewer verdict schema carries a `council_artifacts` object with paths to all six files. Opus post-run reads these paths from the ExecutionReport and uses the decision_record to gate cross-wave merges and inform the plan-completion artifact.

**Codified lesson** (from memory: `[Pair adversarial reviewer with AC validator]`): a checklist validator rationalized real concurrency/caching/auth bugs; a code-tracing adversarial reviewer caught them. Using `review_intensity: 'council'` on core-path phases makes this pairing deterministic rather than reliant on Opus remembering to double-review.

Trigger `council` review for:
- Phases touching auth, payments, or data deletion pathways
- Architecture-changing phases (new routers, schema migrations, cross-domain refactors)
- Any phase where `tier === 3` and `mode === 'C'` and `files_affected` includes API contracts

---

## §10 — Budget Conventions

`budget.total` maps from the plan's `effort_estimate`. Derive it in Opus pre-flight and set `args.budget_total`. The script consumes it as the floor for all budget guards.

Guidance:
- Allocate ~25–30K tokens per phase for a Tier 2/3 plan (52K baseline + 148K working budget per session).
- Fix-loop guard threshold: `budget.remaining() > 60_000` (enough for one more fix + review cycle).
- Loop-until-dry patterns (e.g., `completenessCritic`) must guard on `budget.remaining() > THRESHOLD` before spawning the next iteration.
- Budget is not a quality substitute — it is a runaway guard. Don't tune the threshold to shorten fix loops; tune it only to prevent infinite loops.

Model routing for budget efficiency (mirrors the tier model matrix):

| Stage | Recommended model |
|---|---|
| Mechanical search / extraction | `haiku` |
| Implementation, review | `sonnet` (session default) |
| Deep reasoning, plan building | `opus` |
| Council adjudication | inherit session model (typically `opus`) |

Set `/model` before launching a large run. Route per-agent via `task.model` in the ExecutionGraph.

---

## §11 — Pattern-Selection Guide

Detailed, copy-paste-ready JS implementations of each pattern are in `.claude/skills/dev-execution/orchestration/workflow-patterns.md`. Use this guide to pick the right primitive; go to the pattern library for the implementation.

| Situation | Primitive | Notes |
|---|---|---|
| N independent tasks all needed before moving on | `parallel(thunks)` | Barrier — use for file-ownership batches within a phase; all must complete before reviewer gate runs. |
| N items through multi-stage transform, no inter-item barrier | `pipeline(items, ...stages)` | Item A can advance to stage 3 while B is still in stage 1. Use for parallel investigation legs (explore/spike). |
| Sequential dependency between phases | `for` loop | Waves run sequentially; use `for (const wave of waves)`. |
| Validate → fix → re-validate | `while` loop + budget guard | The fix-loop pattern (§8). Cap at 2 cycles; guard on `budget.remaining()`. |
| Detect high-risk boundary and stop | Early `return` | Mode D boundary detection (§5 constraint 2). Return `{status:'blocked'}` before spawning any agents for that phase. |
| Progress YAML update (no FS in script) | `agent({agentType:'artifact-tracker'})` | Tracker step runs `update-batch.py` via a tiny agent; one per phase. |

**When to prefer `parallel` over `pipeline`**:
- Use `parallel` when all N results are needed together before the next step (reviewer gate, synthesis, merge).
- Use `pipeline` when items are independent and you want maximum throughput without waiting for stragglers (exploration legs, audit sweeps).

**Pattern library reference**: `.claude/skills/dev-execution/orchestration/workflow-patterns.md`

Named patterns available there: `waveFanout`, `reviewerGate`, `fixLoop`, `councilEscalation`, `exploreLegs`, `adversarialVerify`, `judgePanel`, `loopUntilDry`, `completenessCritic`, `modeBoundary`, `trackerStep`.

---

## §12 — Operational Facts

- **Concurrency cap**: `min(16, cores-2)` concurrent agents; 1000 agents total per run.
- **Invocation**: the word `workflow` in a prompt; `/effort ultracode` (auto-workflow per task); a saved `/<name>` command. Saved to `.claude/workflows/` (project) or `~/.claude/workflows/` (personal).
- **Monitoring**: `/workflows` TUI shows phases, agent counts, token totals, elapsed time. Pause/resume, stop/restart agents, `s` to save a run as a command. This replaces the need for SubagentStop-hook telemetry during Phases 1–5.
- **Approval**: per-run prompt in default/acceptEdits modes; "don't ask again" per workflow per project; `bypassPermissions`/`claude -p`/SDK never prompt.
- **Resume**: same-session only. `scriptPath` + `resumeFromRunId` resumes within a session. Across sessions: commit-as-you-go (constraint 4); Opus rebuilds `args` excluding committed waves on restart.

---

## §13 — OQ-5 Decision: Native Telemetry vs. SubagentStop-hook Capture

**Open question resolved (Phase 5, 2026-06-01).**

OQ-5 in `workflow-orchestration-integration-v1.md` §10 asked: does native `/workflows` telemetry
subsume the deferred SubagentStop-hook capture work from `workflow-capability-utilization-spec.md`
Wave 6?

**Decision: yes — rely on native `/workflows` telemetry; SubagentStop-hook capture is superseded.**

Rationale:

1. **Native telemetry is sufficient for the monitored use cases.** The `/workflows` TUI provides
   phases, agent counts, token totals, elapsed time, pause/resume, per-agent stop/restart, and
   run-save (`s`). This covers the same observability surface the SubagentStop hooks were intended
   to provide (per-agent outcomes, token deltas, run summaries).

2. **CCDash ingestion of run summaries is the forward path, not hook capture.** If run summaries
   need to land in CCDash (for cross-project workflow metrics or the dashboard), the integration
   point is consuming the structured `ExecutionReport` Opus already collects post-run — not
   instrumenting the SubagentStop lifecycle event inside the workflow runtime.

3. **SubagentStop-hook plumbing is complex and fragile.** The hooks require per-session
   configuration, fire asynchronously, and are not surfaced in the workflow `args`/return-value
   contract. Re-implementing hook capture would duplicate telemetry that the runtime already
   provides in a cleaner form.

**Implementation impact**:

- Wave 6 hook-capture work in `workflow-capability-utilization-spec.md` is deferred indefinitely.
  Mark the relevant Wave 6 tasks as `will-not-fix` when that spec is reviewed in Phase 6.
- If CCDash integration is wanted in the future, the integration point is the `ExecutionReport`
  (structured JSON Opus receives from every workflow run), not a new hook.
- The `/workflows` TUI + optional Opus-driven run-summary persistence to `.claude/worknotes/`
  is sufficient for now.

**No action required** to implement this decision. The absence of SubagentStop hook wiring
in all workflow scripts is correct and intentional.

---

## §14 — Workflow Registry

All SkillMeat workflows are registered in `.claude/specs/workflows/workflow-registry.md`. When authoring a new workflow, invoke `Skill("workflow-authoring")` which operationalizes the full procedure. Registry summary:

| Name | Script | Spec | Status |
|---|---|---|---|
| `execute-plan` | `.claude/workflows/execute-plan.js` | `execute-plan-workflow-spec.md` | active |
| `execute-contract` | `.claude/workflows/execute-contract.js` | `execute-contract-workflow-spec.md` | active |
| `explore` | `.claude/workflows/explore.js` | `explore-spike-workflow-spec.md` | active |
| `spike` | `.claude/workflows/spike.js` | `explore-spike-workflow-spec.md` | active |
| `review-council` | `.claude/workflows/review-council.js` | `review-council-workflow-spec.md` | active |
| `reviewer-gate` | `.claude/workflows/reviewer-gate.js` | `reviewer-gate-workflow-spec.md` | active |

See registry for future candidates (`release`, `migrate-sweep`, `audit`, `docs-sync`, `symbols-refresh`).

---

## §16 — Durability & Terminal-Output Robustness

Workflows run on isolated worktree branches. Resume caches agent **return values**, not filesystem state. Re-running a failed workflow replays cached results but does NOT re-apply file edits — so uncommitted work is lost if the worktree is disturbed (squash-merge, `git reset`, session exit). Committing per agent is the durability mechanism.

### Core rules

1. **Resume caches results, not files.** Committed work survives a session interruption or mid-run crash; uncommitted edits do not. Never assume a resumed run will re-apply edits — only `git` state persists reliably.

2. **Implementation/sprint/fix agents MUST commit checkpoints to their isolated worktree branch.** Each logical unit of work → one commit, immediately after the unit is complete. Format: `feat(<slug>): <what was done>`. Do NOT push, merge, stash, or touch other branches. Reviewer, tracker, and structurer agents NEVER commit (they are edit-less or read-only by design).

3. **Heavy top-level executor agents MUST NOT carry a terminal schema directly.** A single large executor (e.g., `feature-sprint-executor`) running a full sprint as a top-level `await agent(..., {schema})` call will crash the whole workflow if the agent completes all work but misses the final `StructuredOutput` call. Use **two-stage structuring** instead:
   - **Stage A (heavy executor)**: no `schema` option. Agent commits checkpoints and writes a Completion Report to a deterministic path BEFORE returning. Final message is a human summary.
   - **Stage B (cheap structurer)**: small agent (typically `haiku` / `general-purpose`), `schema: <RESULT_SCHEMA>`. Reads the on-disk report + `git log`/`git diff` to fill structured fields. Schema miss here degrades gracefully (fallback result) rather than crashing the run.
   This decouples the durable work (Stage A commits) from the structured-output contract (Stage B). A Stage B failure never discards Stage A's committed work.

4. **Write the durable report BEFORE any terminal structured step.** The Completion Report (or equivalent artifact) must be on disk before Stage B structurer runs. If Stage B fails, Opus can still inspect the report manually.

5. **Run-in-worktree is a precondition for these workflows.** Opus sets up the worktree pre-flight (or ensures the sprint runs on an isolated branch). The script asserts this only via documentation — the runtime does not enforce isolation automatically.

6. **Per-task fallback structurer** (execute-plan pattern): wrap each static per-task `agent(..., {schema})` in try/catch. On throw (schema miss), dispatch a haiku `general-purpose` structurer that reads `git log -1`/`git rev-parse HEAD` and emits a minimal `TASK_RESULT_SCHEMA` result. This prevents silent task-drop in `parallel()` (which resolves throwing thunks to `null`) while keeping the happy path single-agent.

### Durability checklist

```
[ ] Commit-checkpoints present: every implementation/sprint/fix prompt includes the DURABILITY footer
[ ] Report written pre-schema: Completion Report written to deterministic path before Stage B structurer
[ ] Heavy agents two-staged: no top-level await agent({schema}) for long-running executor agents
[ ] Reviewers edit-less/no-commit: reviewer, tracker, structurer agents never git add/commit/push
[ ] Fallback on structure miss: try/catch around schema calls; minimal result rather than null/crash
[ ] run-in-worktree precondition documented in args spec for each workflow
```

---

## §15 — Authoring Checklist

Invoke `Skill("workflow-authoring")` to run this checklist interactively. When authoring or reviewing any `.claude/workflows/*.js` file:

```
Pre-authoring:
[ ] Read this spec (workflow-authoring-spec.md)
[ ] Read the per-workflow spec (if it exists)
[ ] Read workflow-patterns.md for the relevant patterns

During authoring:
[ ] meta is a pure literal — no computed values, no function calls
[ ] meta.phases titles match every phase() call in the body
[ ] No FS/shell access in script body (constraint 1)
[ ] Mode D boundary detection in place — return {status:'blocked'} (constraint 2)
[ ] All reviewer agents use edit-less agentType (constraint 3)
[ ] No Date.now() / Math.random() / new Date() (constraint 4)
[ ] args validated against execution-graph.schema.json (if execution-style)
[ ] Return value conforms to execution-report.schema.json (if execution-style)
[ ] Budget guard present in every while/loop-until-dry pattern
[ ] Reviewer agentType selection follows §8 routing table
[ ] All implementation agent prompts include "Do NOT git add/commit/push/stash"
[ ] agentType used for all agents (not inline prompts for known agent types)
[ ] If a workflow agent nests (§18), read-only enforcement is in the child's disallowedTools, not prompt text

Post-authoring:
[ ] Syntax check passed: node .claude/skills/workflow-authoring/syntax-check-helper.js .claude/workflows/<name>.js
[ ] Registered in workflow-registry.md
[ ] Per-workflow spec authored or updated
[ ] Dry-run mode tested (args.dry_run === true returns parsed graph)
```

---

## §17 — Self-Modification (Bootstrap) Exception

Tier 2/3 plans default to the `execute-plan` workflow path (`/dev:execute-plan` → `.claude/workflows/execute-plan.js`). The manual wave-driven phase-owner loop is the **deprecated fallback** for the general case.

**Exception — use the manual wave loop, not the `execute-plan` workflow, when any plan phase edits the workflow orchestrator scripts themselves** (`.claude/workflows/*.js`, especially `execute-plan.js` or `execute-contract.js`).

**Rationale**: the workflow runtime loads the orchestrator script at launch and relies on a longest-unchanged-prefix cache for same-session resume (constraint 4, §5). Editing the running orchestrator mid-plan rewrites the very script driving the run — invalidating the resume cache and risking inconsistent execution state (a wave can be dispatched by one version of the script and resumed by another). The workflow would be self-modifying its own runtime.

For this narrow **bootstrap** case the manual wave loop is a **legitimate, non-deprecated** path — Opus dispatches `Task()` per wave directly, so no long-lived workflow runtime is in flight to be invalidated. This is distinct from the general "deprecated fallback" framing of the manual loop: bootstrap self-modification is a *first-class* reason to choose it, not a degraded fallback.

**Detection signal**: any phase whose `files_affected` (or planned diff) touches `.claude/workflows/*.js`. If the plan modifies the orchestrator scripts that would run it, route to the manual loop.

---

## §18 — Subagent Nesting Within Workflows

A workflow-spawned agent MAY spawn its own children via the `Agent` tool — e.g. a phase-owner nesting implementers, or a research leg nesting sub-probes. Nesting is governed, not banned. **Full rules are canonical in `.claude/specs/subagent-nesting-spec.md`; this section records only the workflow-specific interactions.**

- **OQ-5 resolution — orthogonal to `workflow()` re-entry.** Nesting via `Agent` is independent of the one-level `workflow()` re-entry cap in §1. A spawned agent may nest via `Agent` to arbitrary (self-budgeted) depth, but `workflow()` re-entry remains capped at one level. Do not conflate the two mechanisms.

- **Four-constraints interaction.** Constraint 3 (§5) propagates to depth: nested children ALSO run `acceptEdits` (Phase 0 OQ-4 confirmed `permissionMode` propagation). Therefore read-only enforcement for a nested child must live in that child's agent-definition `disallowedTools`, NEVER in prompt text — exactly as for direct workflow subagents. Mode D at depth remains a workflow boundary handled by bubble-up to Opus (constraint 2, §5); nested agents are prohibited from Mode-D work outright. Per the Claude-primary-only rule, workflow agents that nest run on the primary subscription — router-offloaded executors stay flat and never nest.

- **Durability.** A workflow caches a phase-owner's FINAL result only; from the workflow's view a nested subtree is one `agent()` call. A mid-nest blow-up re-runs the whole phase — there is no partial-subtree resume. Keep nests shallow and bounded per the nesting spec's "Per-Level Context Budget".

**Canonical reference**: `.claude/specs/subagent-nesting-spec.md` (OQ-5, "Mode-D at Depth", "Claude-Primary-Only Nesting", "Per-Level Context Budget", "Durability Contract").
