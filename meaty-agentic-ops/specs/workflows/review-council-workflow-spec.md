---
schema_version: 2
doc_type: spec
title: "review-council Workflow Spec — Agent Review Council (ARC) Wrapper"
status: active
phase: 4
created: 2026-06-01
owner: nick
related_documents:
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/plans/workflow-orchestration-integration-v1.md
  - .claude/skills/council-review/SKILL.md
  - .claude/skills/council-review/references/output-contract.md
  - .claude/skills/council-review/references/run-workflow.md
  - .claude/skills/dev-execution/orchestration/workflow-patterns.md
  - .claude/specs/workflows/execute-plan-workflow-spec.md
  - .claude/rules/delegation-modes.md
script: .claude/workflows/review-council.js
---

# review-council Workflow Spec

Per-workflow contract for `.claude/workflows/review-council.js`. Extends, never contradicts,
`workflow-authoring-spec.md`. Authors: read the master contract first, then the
`council-review` skill output contract at `references/output-contract.md`.

---

## Purpose

`review-council` wraps the Agent Review Council (ARC) — defined in the `council-review` skill —
as a **deterministic, resumable workflow step**. It fans out N diverse-lens reviewers plus one
adversarial code-tracer in `parallel`, adjudicates their findings, and produces the full ARC
artifact set as schema-valid structured output.

This workflow codifies the lesson recorded in project memory
(`[Pair adversarial reviewer with AC validator]`): a checklist validator rationalized real
concurrency, caching, and auth bugs; a code-tracing adversarial reviewer caught them. Embedding
the council as a workflow step makes this pairing **deterministic** for every
`review_intensity: council` phase, rather than relying on Opus to remember to double-review
core-path phases.

**Two consumption modes**:

1. **Standalone**: invoked directly as `/review-council <target>` for architecture reviews,
   core-path PRs, security audits, and any run requiring multi-lens independent passes.
2. **Embedded gate**: invoked from `execute-plan` via `workflow('review-council', ...)` when a
   phase declares `review_intensity: 'council'`. The returned verdict is consumed by the
   `execute-plan` fix-loop, and `council_artifacts` paths surface in the `ExecutionReport` for
   Opus post-run.

**NOT a replacement for the standard reviewer gate.** Routine phases use
`task-completion-validator` or `karen` (per `councilEscalation`). Reserve `review-council` for
phases where the cost of a missed bug — auth, payments, data deletion, architecture-changing
changes, API contract modifications — exceeds the cost of the extra reviewer fan-out.

---

## `args` Contract

The script handles `args` arriving as a JSON string or object (`typeof args === 'string'`
→ `JSON.parse` at the top).

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | object | yes | What is being reviewed. Shape: `{type, ref, description}`. |
| `target.type` | string | yes | One of `'diff'`, `'branch'`, `'commit-range'`, `'pr'`, `'phase-taskout'`. |
| `target.ref` | string | yes | Git ref, PR number, commit range (`A..B`), or phase ID (for embedded mode). |
| `target.description` | string | no | Human-readable summary of what is under review. |
| `lens_set` | string[] | no | Lens names to activate. Defaults to `['correctness', 'security', 'concurrency', 'performance', 'contract']`. |
| `intensity` | string | no | `'standard'` (3 reviewers + 1 adversarial) or `'deep'` (5 reviewers + 1 adversarial). Default `'standard'`. |
| `plan_ref` | string | no | Path to the source plan file, passed to reviewers for acceptance-criteria context. |
| `phase_id` | string | no | Phase identifier for embedded mode (used in run slug and artifact paths). |
| `task_summaries` | string | no | Serialized task results from `execute-plan` for embedded mode context. |
| `run_dir_prefix` | string | no | Prefix for the run directory (default: `runs/`). |
| `timestamp` | string | yes | ISO 8601 timestamp — set by Opus pre-flight. Never `Date.now()` in script. |
| `dry_run` | boolean | no | If `true`, return parsed args without spawning agents. |

### Lens set defaults

The default lens set covers the five most common failure modes for SkillMeat phases. Each lens
maps to a specific reviewer persona (see Agent Routing below). Override via `args.lens_set` to
narrow scope (e.g., `['security', 'contract']` for an auth-only review) or widen it
(`['correctness', 'security', 'concurrency', 'performance', 'contract', 'observability']`).

| Lens | Focus | Default reviewer agentType |
|---|---|---|
| `correctness` | Logic correctness, acceptance criteria, edge cases | `task-completion-validator` |
| `security` | Auth, injection, data exposure, RBAC violations | `senior-code-reviewer` |
| `concurrency` | Race conditions, cache invalidation, locking | `karen` |
| `performance` | N+1 queries, unbounded loops, response times | `code-reviewer` |
| `contract` | API schema alignment, OpenAPI conformance, type drift | `senior-code-reviewer` |
| `observability` | Logging gaps, missing metrics, error swallowing | `code-reviewer` |

The adversarial code-tracer (`senior-code-reviewer` with code-trace prompt) always runs,
regardless of `lens_set`. It is the dedicated adversarial pass.

---

## Phases

```
review-council
├── Phase: Evidence collection    (1 agent: build evidence_pack.md from target)
├── Phase: Reviewer fan-out       (N parallel lensed reviewers + 1 adversarial code-tracer)
├── Phase: Adjudication           (1 agent: synthesize, deduplicate, assign dispositions)
└── Phase: Decision record        (1 agent: produce schema-valid ARC artifacts)
```

### Phase 1 — Evidence collection

One `code-reviewer` agent reads the target (diff, branch, PR, or task summaries) and produces
a structured `evidence_pack` object. This is passed as context to all reviewer agents in Phase 2.
The agent does NOT write files — it returns the evidence pack as a structured schema object.

The evidence pack includes:
- Source artifacts and files under review.
- Acceptance criteria (from `plan_ref` if provided).
- Known constraints and assumptions.
- Deterministic checks already run (e.g., typecheck results if provided in task summaries).
- Open questions and evidence gaps.

### Phase 2 — Reviewer fan-out

All reviewers run in `parallel` — a barrier that waits for all before adjudication begins.
This is the ARC "independent pass" principle: reviewers must not see each other's findings
until adjudication.

Fan-out count per `intensity`:
- `standard`: lens_set reviewers (up to 5) + 1 adversarial code-tracer = max 6 agents.
- `deep`: lens_set reviewers (up to 6) + 1 adversarial code-tracer = max 7 agents.

**All reviewer agents are edit-less by `agentType` definition** (constraint 3). The specific
agentTypes used — `task-completion-validator`, `karen`, `code-reviewer`, `senior-code-reviewer`
— all carry `disallowedTools` preventing Write/Edit/MultiEdit. The workflow cannot enforce
read-only at the script level; it is enforced only by the agent definitions.

The adversarial code-tracer always uses `agentType: 'senior-code-reviewer'` with a prompt
that instructs it to trace execution paths through the changed code looking for logic errors,
security gaps, and runtime failures — not just static pattern matching.

Each reviewer returns a structured `ReviewerOutput` with:
- `lens`: which lens was applied
- `findings`: array of finding objects (id, title, claim, finding_type, severity, confidence,
  evidence, recommendation)
- `reviewer_type`: the agentType used

### Phase 3 — Adjudication

One `karen` agent (adversarial by nature — appropriate for adjudication) receives all reviewer
outputs and the evidence pack, then:
- Deduplicates overlapping findings across lenses.
- Preserves dissent and unresolved disputes.
- Assigns final severity and confidence using evidence quality.
- Rejects findings that are unsupported, out of scope, or only stylistic.
- Moves plausible but unproven observations to watchlist.

Returns a structured `AdjudicatedFindings` object with findings sorted into disposition buckets
(`accepted`, `rejected`, `disputed`, `watchlist`).

### Phase 4 — Decision record

One `task-completion-validator` agent takes the adjudicated findings and produces all six ARC
artifact files under `runs/<timestamp-slug>/`:

- `evidence_pack.md` — the evidence pack written to disk
- `findings.yaml` — all findings (all dispositions preserved)
- `scorecard.json` — numeric scoring
- `risk_register.yaml` — risk items from accepted and disputed findings
- `decision_record.md` — disposition buckets with rationale
- `validation_plan.md` — validation steps for accepted and disputed findings

Returns a `CouncilVerdict` object with `approved`, `required_fixes` (from accepted findings),
and `council_artifacts` (paths to all six files).

---

## Agent Routing

**ALL agents in this workflow are edit-less.** This is a non-negotiable constraint.
`review-council` is a Mode E workflow — its purpose is to produce findings and recommendations,
never to implement changes.

| Phase | agentType | Model | Edit-less? |
|---|---|---|---|
| Evidence collection | `code-reviewer` | `sonnet` | yes — `disallowedTools` in definition |
| Lens reviewers (per lens) | see lens table above | `sonnet` | yes |
| Adversarial code-tracer | `senior-code-reviewer` | `sonnet` | yes |
| Adjudicator | `karen` | `sonnet` | yes |
| Decision record writer | `task-completion-validator` | `sonnet` | yes |

The decision record agent writes ARC artifacts to disk (the only write operation in the
workflow). This is acceptable because `task-completion-validator` writes only to the
`runs/<date>-<slug>/` directory, not to source files.

**Never route any step to a write-capable implementation agent** (`python-backend-engineer`,
`ui-engineer-enhanced`, `frontend-developer`, etc.). The workflow boundary between review and
fix is enforced by keeping `review-council` entirely edit-less.

---

## Outputs

### CouncilVerdict (schema — inline in script, constraint 1)

The workflow returns a `CouncilVerdict` conforming to the `COUNCIL_VERDICT_SCHEMA`:

```js
{
  approved: boolean,          // true if no accepted findings require immediate blocking action
  reviewer_type: 'council-review',
  required_fixes: string[],   // derived from accepted findings with severity >= 'high'
  council_artifacts: {
    run_dir: string,           // relative path to runs/<slug>/
    findings_yaml: string,     // findings.yaml path
    scorecard_json: string,    // scorecard.json path
    risk_register_yaml: string,
    decision_record_md: string,
    validation_plan_md: string,
  },
  summary: {
    total_findings: number,
    accepted: number,
    rejected: number,
    disputed: number,
    watchlist: number,
    blocking_count: number,    // accepted findings with severity >= 'high'
  },
}
```

`approved: true` means: no accepted findings with severity `high` or `critical`. Watchlist and
disputed findings do not block. Opus post-run reviews the full decision_record before merging
worktrees.

### ARC artifact files (written by decision-record agent)

The six files required by `council-review/references/output-contract.md` are written to
`runs/<timestamp-slug>/` by the Phase 4 agent. Paths are returned in `council_artifacts`.

The decision-record agent runs `uv run arc validate runs/<slug>` and reports the result in its
return value. Opus post-run acts on any validation failure before merging.

---

## Two Consumption Modes

### Standalone invocation

```
/review-council {"target":{"type":"branch","ref":"development","description":"Phase 3 changes"},"timestamp":"2026-06-01T12:00:00Z"}
```

Returns the `CouncilVerdict` with all artifact paths. Opus reviews the `decision_record.md` and
`validation_plan.md` before deciding to merge or request fixes.

### Embedded gate in `execute-plan`

When `execute-plan` encounters a phase with `review_intensity: 'council'`, it calls:

```js
const verdict = await workflow('review-council', {
  target: { type: 'phase-taskout', ref: p.id, description: p.title },
  task_summaries: JSON.stringify(taskOut),
  plan_ref: planRef,
  phase_id: p.id,
  timestamp: graph.timestamp,
  intensity: 'standard',
})
```

The returned `verdict` is consumed by the `reviewerGate` / `fixLoop` logic exactly as a
`task-completion-validator` verdict would be — `verdict.approved` gates the fix-loop;
`verdict.required_fixes` seeds the fix prompts; `verdict.council_artifacts` surfaces in
the `ExecutionReport` for Opus post-run.

**One level of nesting**: `execute-plan` is the top-level workflow; `review-council` is the
sub-workflow. This respects the `workflow(name, args)` one-nesting-only constraint.

---

## Extension Points

### Adding a lens

Add a new entry to the lens table and a case in the `buildReviewerThunks` function in the
script. The new lens needs:
1. A lens name string (add to `lens_set` defaults or pass explicitly via args).
2. A reviewer `agentType` from the edit-less set.
3. A lens-specific prompt focus description.

No other changes are required. The `parallel` fan-out is built dynamically from the active
lens set.

### Increasing reviewer depth

Pass `intensity: 'deep'` to activate the extended lens set (up to 6 lenses) or pass a custom
`lens_set` array. The adversarial code-tracer always runs regardless of intensity.

### Custom run directory

Pass `run_dir_prefix` to write artifacts under a non-default location (e.g.,
`'.claude/reviews/'` for ad-hoc reviews separate from skill runs).

---

## Four-Constraints Checklist

```
[x] No FS/shell access in script body — all file writes via decision-record agent
[x] Mode D phases trigger early return — N/A (review-council has no Mode D phases of its own;
    it is invoked AFTER implementation; if the target is a Mode D change, Opus approved it first)
[x] All reviewer agents use edit-less agentType — task-completion-validator, karen,
    code-reviewer, senior-code-reviewer only
[x] No Date.now() / Math.random() / new Date() in script body — timestamp from args
[x] meta is a pure literal object
[x] phase() titles match meta.phases exactly
[x] Budget guard in adjudication if council run is nested inside execute-plan fix-loop
```

---

## Phase 4 Exit Gate

Per `workflow-orchestration-integration-v1.md` §7 Phase 4:

> Standalone run produces valid ARC artifacts; embedded gate catches a seeded core-path bug a
> single validator misses.

Before marking Phase 4 complete:
1. Run `review-council` standalone against a recent diff or branch.
2. Verify the `runs/<slug>/` directory contains all six ARC artifacts.
3. Run `uv run arc validate runs/<slug>` — must pass.
4. Seed a known bug into a test branch; verify the embedded gate in `execute-plan` catches it
   where `task-completion-validator` alone would not.
