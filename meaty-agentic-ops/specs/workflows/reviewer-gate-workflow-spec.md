---
schema_version: 2
doc_type: spec
title: "reviewer-gate Workflow Spec — the mandatory gate as a schema'd stage"
status: active
phase: 8
created: 2026-08-03
owner: nick
related_documents:
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/specs/workflows/review-council-workflow-spec.md
  - .claude/skills/dev-execution/SKILL.md
  - .claude/skills/dev-execution/references/gate-risk-classes.md
  - .claude/skills/dev-execution/references/execution-doctrine.md
  - .claude/skills/dev-execution/validation/completion-criteria.md
  - .claude/skills/dev-execution/orchestration/workflow-patterns.md
script: .claude/workflows/reviewer-gate.js
---

# reviewer-gate Workflow Spec

Per-workflow contract for `.claude/workflows/reviewer-gate.js`. Extends, never contradicts,
`workflow-authoring-spec.md`.

---

## Purpose

`reviewer-gate` runs the **mandatory reviewer gate** as a schema'd workflow stage, for every gate
that is not already inside `execute-plan` or `execute-contract`.

Those two workflows already run their reviewer with `schema: VERDICT_SCHEMA`. Every other gate in
the engine did not. The Tier-0 close (`modes/quick-execution.md` §3.1), the scaffold close
(`modes/scaffold-execution.md` §5.1), the plan-level whole-tree pass
(`modes/plan-execution.md` step 4) and every ad-hoc milestone gate were specified as a bare
in-session dispatch returning free text:

```
Task("task-completion-validator", "Tier 0 review: ... Verdict: APPROVED or CHANGES_REQUESTED")
```

That form has three failure modes, all observed on live runs:

1. **The orchestrator blocks in-line.** A bare Agent call is awaited by the main loop. A reviewer
   that goes slow or silent stalls the session, and a stalled gate is indistinguishable from a
   gate that is thinking.
2. **The verdict is unparsed prose.** Nothing forces a decision to exist. The reviewer can ramble,
   exhaust its turns, or stop mid-thought, and the orchestrator infers approval from tone.
3. **A dead reviewer looks like a quiet one.** "No verdict" and "rejected with nothing useful" are
   the same observable, so a gate that never ran can pass for a gate that passed.

## What this fixes, and what it does not

**It does not add a timeout.** `agent()` exposes no deadline and a workflow script cannot impose
one. Anyone reading "fails loudly instead of hanging" as "the reviewer is killed after N seconds"
is reading something this does not do. What it actually changes:

| Failure mode | Mechanism |
|---|---|
| Unparsed / absent decision | `schema: VERDICT_SCHEMA` forces a StructuredOutput call; the tool layer makes the agent retry on mismatch. A reviewer cannot finish without emitting a verdict. |
| Dead reviewer reads as a pass | `agent()` returns `null` when the subagent dies after retries. Null becomes an explicit `verdict_source: 'gate_failure'` verdict — `approved: false`, a named `gate_failure_reason`, and a `log()` line. Never absorbed into an approval. |
| Dead reviewer reads as a rejection | `verdict_source` and the envelope's `gate_ran` separate *the gate did not run* from *the gate said no*. The first is not something the implementer can fix; conflating them sends a fix loop after a phantom defect. |
| In-line hang | Workflows run in the background. A stalled lens sits visibly in `/workflows` progress under the `Review` phase instead of freezing the main loop, and the orchestrator keeps its context. |
| Silent lens disappearance | An unmapped lens name is a gate failure, never a `||` default reviewer. A `||` fallback to a non-existent agent is how a "5-lens" council silently reviewed 4 (2026-08-03 agent-roster-drift AAR). |

## Args

| Field | Type | Required | Meaning |
|---|---|---|---|
| `lenses` | `string[]` | **yes** | Lens names from the vocabulary below. Chosen per `gate-risk-classes.md` §2 — one lens by default, a second only with a named trigger. An empty/absent array is a **gate failure**, not an approval. |
| `scope` | `{id, title, kind, tier?}` | recommended | What is being gated. `kind` ∈ `tier0-change`, `scaffold`, `phase`, `plan`, `sprint`, `milestone`. |
| `acceptance_criteria` | `string[]` | recommended | The ACs actually in question. Absent → the reviewer reports them as `unverifiable` rather than inventing them. |
| `files_changed` | `string[]` | recommended | The review scope. The reviewer is told not to widen it. |
| `failure_summary` | `string` | re-pass only | Presence switches the prompt to re-pass mode. This is the **delta** (`execution-doctrine.md` rule 2) — never the full plan, cumulative diff, or progress file. |
| `evidence_refs` | `string[]` | optional | Evidence the implementer offered, to be verified rather than trusted. |
| `evidence_artifacts` | `(string \| {path, claim?})[]` | optional | Files the **orchestrator staged BEFORE the gate ran**, each holding the verbatim artifact (command transcript, row, response body, diff hunk). Reading one is **first-hand verification** for the claim it carries, so a claim it substantiates does not belong in `self_reported_claims`. Distinct from `evidence_refs`, which is the implementer's word and is to be distrusted. See § The staged-artifact escape. |
| `gate_lens_reason` | `string` | required with 2 lenses | `untrusted-input` \| `authz-boundary` \| `irreversible-outward` \| `ambiguity-tie`. Advisory here (classification lives in the plan) but logged, so an unjustified second lens is auditable. |
| `plan_ref`, `timestamp`, `notes` | `string` | optional | Passed through into the prompt. Timestamps come from args — the script may not call `new Date()` (constraint 4). |

## Lens vocabulary → reviewer

Every value is an edit-less agent present in `.claude/agents/` (constraint 3);
`tests/test_workflow_agent_roster.py` fails the build on a phantom name.

| Lens | Reviewer `agentType` | Good at |
|---|---|---|
| `validator` | `task-completion-validator` | AC-mapping; catching a fabricated or absent transcript |
| `security` | `senior-code-reviewer` | Adversarial code-traced defect-finding |
| `karen` | `karen` | Whole-tree reality-check vs claimed completion |
| `karen-final-tree-only` | `karen` | The same lens at its one end-of-feature placement |

A full ARC council is **not** a lens here — it is the `review-council` workflow, invoked in its own
right. This script never calls `workflow()`, so it can be nested by a top-level workflow without
consuming that workflow's one nesting level.

## Return envelope

```
{
  approved:        boolean   // true only if EVERY lens returned an approving verdict AND zero gate failures
  gate_ran:        boolean   // false when no lens produced a real verdict — the gate is ABSENT, not negative
  scope, lenses, gate_lens_reason
  verdicts:        Verdict[] // each tagged verdict_source: 'reviewer' | 'gate_failure', plus `lens`
  gate_failures:   [{lens, reviewer_type, reason}]
  defect_classes:  string[]  // this round's classes, for the same-class stop rule
  blocking_fixes:  string[]  // flattened required_fixes across non-approving lenses
  unverifiable:    string[]  // criteria no lens could judge
  summary:         string
}
```

**Caller obligations.** `approved: false` with `gate_ran: false` means re-dispatch or record an
explicit operator override — it does **not** mean enter a fix loop. `approved: false` with
`gate_ran: true` is an ordinary rejection: fix, then re-invoke with `failure_summary` set.
Do not commit or mark complete on either.

## Fix loop

`reviewer-gate` deliberately owns **no fix loop**. It is one gate evaluation, so it composes with
whatever loop the caller already has: `execute-plan`/`execute-contract` have their own budgeted
`fixLoop`, and an in-session caller applies the gate budget from
`dev-execution/SKILL.md` (max 2 re-passes per scope × lens, then re-scope) plus the same-class stop
rule using `defect_classes` from the envelope. Embedding a second, differently-budgeted loop here
would give one scope two competing budgets.

## Four constraints

1. **No FS/shell in the script body** — prompts are pure string construction; all file reading
   happens inside the reviewer agents.
2. **No mid-run human sign-off** — the script returns a verdict envelope; the operator acts on it
   afterwards.
3. **Reviewer agents are edit-less** — enforced by `LENS_REVIEWER_MAP` + the roster test. The
   prompt also states it, since a reviewer that edits is no longer an independent lens.
4. **No `Date.now()` / `Math.random()` / argless `new Date()`** — timestamps arrive via
   `args.timestamp`.

Mode D is not applicable: this workflow spawns only edit-less reviewers and mutates nothing.

## Not covered

- **No wall-clock deadline** (see above). If a reviewer is genuinely stuck, the operator sees it in
  `/workflows` and stops the task; the workflow cannot self-terminate a stage.
- **No lens invention.** The script routes only the four lenses above; adding one is a change to
  both this spec and `gate-risk-classes.md` §1's vocabulary table, together.

## The staged-artifact escape (`evidence_artifacts`)

R3 downgrades any approving verdict carrying `self_reported_claims`, and that rule is
deliberately **not** capability-aware: `applyEvidenceRules` returns on `if (claims.length)`
before any `LENS_EXECUTION_CAPABILITY` check. A missing artifact is implementer work, so an
ordinary rejection is the right next action — that is by design, not an oversight.

But it composes badly with a lens that cannot execute. The `security` lens maps to
`senior-code-reviewer`, defined `disallowedTools: Write, Edit, MultiEdit, Bash`. For any
criterion whose evidence IS an execution — a test run, a mutation proof, a reproduced
vulnerability — that lens cannot re-derive the fact, must record it as a self-reported claim,
and thereby cannot return `approved: true` however correct the work is. Observed on skillmeat
P1 of modular-context-activation with all ACs met and zero substantive required fixes, and
again over three non-converging rounds on registrar-hardening M0
(`node_01M08FAYAGN5QYF77C1ZVA146B`, `node_01KZHCYD1KZFF5NXSH9Q2RCX1H`).

`evidence_artifacts` is the sanctioned way out, and it **weakens nothing**: no enforcement
branch changed. The SELF-REPORT RULE already names "the file on disk" as valid evidence; this
contract simply lets the orchestrator declare *which* files those are, so the reviewer can
Read them instead of guessing that staged evidence exists. Reading a file is a direct
observation available to an edit-less, Bash-less lens.

**Caller obligation.** Stage the artifacts *before* invoking the gate — write the verbatim
output to disk and pass the paths. Staging after the gate runs is too late, and the reviewer
cannot ask for them mid-run.

**What it is not.** A path in this list is a pointer, never a promise. The script cannot read
the filesystem (constraint: no FS access in a workflow script) and asserts nothing about the
file existing or supporting its claim. An artifact that is missing, empty, unreadable, or that
does not show what its claim says returns the claim to `self_reported_claims` exactly as
before — the reviewer is told this explicitly in the STAGED-ARTIFACT RULE.
