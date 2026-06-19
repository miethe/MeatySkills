---
schema_version: 2
doc_type: spec
title: "<name> Workflow Spec — <one-line description>"
status: draft
phase: <N>
created: <YYYY-MM-DD>
owner: nick
related_documents:
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/plans/workflow-orchestration-integration-v1.md
  - .claude/specs/workflows/schemas/execution-graph.schema.json
  - .claude/specs/workflows/schemas/execution-report.schema.json
  - .claude/skills/dev-execution/orchestration/workflow-patterns.md
  - .claude/rules/delegation-modes.md
  - .claude/rules/context-budget.md
script: .claude/workflows/<name>.js
---

# <name> Workflow Spec

Per-workflow contract for `.claude/workflows/<name>.js`. Extends, never contradicts,
`workflow-authoring-spec.md`. Authors: read the master contract first.

---

## Purpose

_One paragraph: what orchestration problem this workflow solves, what it replaces,
and what it produces._

Replaces: _what manual or imperative mechanism this supersedes_
Fallback: _what remains available until this workflow is piloted and validated_

---

## `args` Contract

**Canonical schema**: `.claude/specs/workflows/schemas/execution-graph.schema.json`

_Describe which top-level fields from the ExecutionGraph schema this workflow uses,
plus any workflow-specific extensions. Note which fields Opus builds pre-flight vs.
which are computed by a first-stage agent._

**The script never reads plan files itself** (constraint 1 — no FS access from script).
The script handles the case where `args` arrives as a JSON string:
`const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args`

### Top-level fields used

| Field | Type | Required | Description |
|---|---|---|---|
| `waves` | `Wave[]` | yes (if execution-style) | Sequential dependency levels |
| `tier` | `1 \| 2 \| 3` | yes | Determines reviewer routing |
| `plan_ref` | string | yes | Path to source plan; passed to agents |
| `timestamp` | string | yes | ISO 8601 from Opus — never Date.now() in script |
| `budget_total` | integer | yes | Maps to budget.total |
| `dry_run` | boolean | no | Return parsed graph without spawning agents |
| `progressFile` | string | no | Resolved path to phase progress YAML |
| _add workflow-specific fields_ | | | |

---

## Phases

_List every `phase()` call the script makes. These must match `meta.phases` exactly._

| Phase title | What happens |
|---|---|
| `<title matching meta.phases[0].title>` | Description |
| `<title matching meta.phases[1].title>` | Description |

---

## Agent Routing

_Document which `agentType` values the script uses, their roles, and which are edit-less._

| agentType | Role | edit-less? | Notes |
|---|---|---|---|
| `<implementation-agent>` | Implementation | No | Mode C sprint worker |
| `<reviewer-agent>` | Reviewer gate | Yes | Must be edit-less (constraint 3) |
| `artifact-tracker` | Progress YAML update | Partial | Bash-capable, no source edits |

---

## Mode D Handling

_Describe explicitly how Mode D phases are detected and handled in this workflow._

```js
// Explicit flag
const blocked = wave.phases.find(p => p.mode === 'D')
if (blocked) return { status: 'blocked', reason: 'mode_d', blocked_phase: blocked.id, report }
```

_List any workflow-specific high-risk `files_affected` patterns beyond the default
`modeBoundary` HIGH_RISK_PATTERNS (auth, payment, billing, migration, alembic, delete,
drop_table, secret, token)._

---

## Dry-Run Mode

`args.dry_run === true`: return `{ status: 'dry_run', parsed_args: parsedArgs }` immediately
without spawning any agents. Used by Opus pre-flight to validate the execution graph before
committing to a full run.

---

## Pre-conditions

_What must be true before Opus invokes this workflow:_

- [ ] Plan frontmatter valid (`wave_plan` or equivalent) and readable by Opus pre-flight
- [ ] No uncommitted local changes in files touched by Phase 1 (unless isolation: worktree)
- [ ] `args.progressFile` resolved and the progress YAML exists for Phase 1
- [ ] _Add workflow-specific pre-conditions_

---

## Post-conditions / Exit Gates

_What Opus verifies from the returned `ExecutionReport` before marking the run complete:_

- [ ] `status === 'complete'`
- [ ] All phases have `verdict.approved === true`
- [ ] No `escalate: true` phases in `report`
- [ ] `trackerStep` confirmed all tasks as `completed` in progress YAML
- [ ] _Add workflow-specific exit gates_

---

## Return Value

This workflow returns an `ExecutionReport` conforming to
`.claude/specs/workflows/schemas/execution-report.schema.json`.

| `status` | Meaning | Opus action |
|---|---|---|
| `complete` | All waves done, all gates approved | Worktree merge, plan completion |
| `blocked` | Mode D boundary hit | Run `blocked_phase` interactively, relaunch with trimmed `args.waves` |
| `needs_opus` | Fix-loop cycles exhausted | Adjudicate escalation; decide fix or close |

---

## Patterns Used

_Reference which named patterns from `workflow-patterns.md` this workflow composes:_

- `waveFanout` — primary wave/phase/batch dispatch
- `modeBoundary` — per-wave Mode D detection
- `reviewerGate` + `fixLoop` — phase reviewer gate with fix-loop
- `councilEscalation` — reviewer `agentType` routing
- `trackerStep` — progress YAML update per phase
- _add or remove as appropriate_

---

## Extension Points

_Where future authors can safely add new behavior without breaking the core contract:_

- **New phase strategy**: add a branch in the phase dispatch when `phase.phase_strategy === '<new>'`
- **New reviewer type**: add a case to `councilEscalation()` for a new `review_intensity` value
- **New Mode D heuristic**: add a pattern to `HIGH_RISK_PATTERNS` in `modeBoundary()`
- _workflow-specific extension points_

---

## Four-Constraints Checklist (workflow-specific verification)

```
[ ] No FS/shell access in script body
[ ] Mode D phases trigger early return, never executed
[ ] All reviewer agents use edit-less agentType
[ ] No Date.now() / Math.random() / new Date() in script body
[ ] meta is a pure literal object
[ ] phase() titles match meta.phases exactly
[ ] Budget guard present in every while / loop-until-dry pattern
[ ] Implementation agent prompts include "Do NOT git add/commit/push/stash"
[ ] args.dry_run handled
[ ] args parsed at top (typeof args === 'string' ? JSON.parse : identity)
```
