---
# Thin Tier 2/3 implementation plan (Claude-5 doctrine).
# Target: <=150 lines TOTAL, frontmatter included. If you are over, cut prose — not AC.
# Doctrine: .claude/skills/planning/references/plan-doctrine.md
it_schema: 1
feature_slug: [feature-slug]
title: "[Feature Name] — implementation plan"
doc_type: implementation_plan
status: draft
tier: [2|3]
priority: [P0|P1|P2|P3]
points: [N]
risk_level: [low|medium|high]
context_class: [C1|C2|C3|C4]   # sizes AGENT CONTEXT, not behavior — see plan-doctrine.md
created: [YYYY-MM-DD]
related_documents:
  - [path to PRD — owns narrative AC]
acceptance_criteria:
  - "[Observable, checkable. The AC -> command -> evidence matrix below is the detail.]"
open_questions:
  - "[Unknown that would change the design if answered differently. Name them; do not guess.]"
decisions:
  - decision: "[what was decided]"
    rationale: "[why]"
    status: accepted
routing_constraints:               # CONSTRAINTS, never model ids — resolved at dispatch time
  - "[e.g. merge-path correctness MUST stay claude-primary]"
  - "[e.g. mechanical sweeps are offload-eligible]"

# EXECUTION BINDING — required, and thin by design.
# One phase entry per plan milestone. This is what /dev:execute-plan builds its ExecutionGraph
# from, and what IntentTree materializes as phase container nodes + DEPENDS_ON edges. Dropping it
# makes the plan unexecutable. Note what is NOT here: no model, provider, profile, or
# orchestrator_model — routing resolves at dispatch time from routing_constraints above.
# `waves` groups milestones that may run concurrently; sequential is the safe default.
wave_plan:
  waves: [["M1"], ["M2"], ["M3"]]
  phases:
    - id: M1
      title: "[Milestone 1 name]"
      depends_on: []
      exit_criteria: ["[the AC that makes M1 reviewable]"]
      # GATE — one lens is the default. Add `security` (and a gate_lens_reason) ONLY when this
      # milestone's surface parses untrusted input, is an authorization/identity boundary, or has
      # an irreversible/outward-facing effect. Most milestones keep [validator] — that is correct,
      # not under-specified. Ruleset: dev-execution/references/gate-risk-classes.md §2
      gate_lens: [validator]
    - id: M2
      title: "[Milestone 2 name]"
      depends_on: ["M1"]
      exit_criteria: ["[...]"]
      # Example of a triggered milestone. gate_lens_reason is REQUIRED when gate_lens has 2+
      # entries: untrusted-input | authz-boundary | irreversible-outward | ambiguity-tie
      gate_lens: [security, validator]
      gate_lens_reason: authz-boundary
    - id: M3
      title: "[Milestone 3 name]"
      depends_on: ["M2"]
      exit_criteria: ["[...]"]
      gate_lens: [validator]
---

# Implementation Plan — [Feature Name]

[Two or three sentences: what state the system is in now, what state it should be in when this
is done. No implementation narrative — that is the executor's job.]

## Scope boundary

**In:** [the surfaces this plan changes]

**Out (stated, not silently dropped):** [anything a reader would reasonably expect to be here,
with the reason it is not — a separate repo, a dependent initiative, an explicit deferral]

## Rubric — what "good" looks like

[How a reviewer judges this work when the AC are all technically satisfiable in more than one
way. This replaces step-by-step prescription: describe the quality bar, not the route to it.
An executor that reads only the AC and this rubric should make the same choices you would.]

## Named risks

- **[Risk, sharpest first].** [Why it bites, and what the executor should do about it.]
- **[Risk].** [...]

## References

[Code paths first, mockups second, prose last. Point at the thing, do not describe it.
For cross-repo work include a <=30-line inlined context digest here rather than a stack of
required-reading refs every leg must re-fetch.]

## Milestones

> A milestone is a **reviewable state of the system**, not a batch of tasks. Aim for 3-4.
> Give the executor the whole milestone. Enumerate tasks only where sequencing is load-bearing,
> and say why at the point of enumeration.

### M1 — [Name]

[What state the system is in when this milestone is done, in prose.]

**AC:** [what must be true — checkable]

### M2 — [Name]

[...]

**AC:** [...]

### M3 — [Name]

[...]

**AC:** [...]

## AC -> command -> evidence

The single home for verification detail. The PRD owns narrative AC; this matrix owns proof.

| AC | Command | Evidence of pass |
|---|---|---|
| [AC-1] | `[exact command]` | [what output proves it] |
| [AC-2] | `[exact command]` | [what output proves it] |

## Sequencing (only if load-bearing)

[DELETE THIS SECTION unless order genuinely matters. If it does, name the reason —
migration, serialization barrier, cross-repo handshake — and order only what needs ordering.]

## Execution ledger

Deviations and conservative choices are logged with rationale to
`.claude/worknotes/[feature-slug]/implementation-notes.md` and reviewed at each milestone
boundary — rather than halting on them.

**Blockers still stop** (work that cannot correctly proceed: a failing test on current work, an
unsatisfiable declared artifact, exhausted recovery). Beyond those, mid-milestone halts are only
for: destructive action, real scope change, or input only the operator has.

**Mode-D boundaries are unchanged and non-negotiable** — these always halt for explicit human
approval, whatever this plan says: **auth · payments/billing · schema migrations · data deletion ·
secret rotation · infrastructure**. If a milestone touches one, say so in its AC.

<!--
DELIBERATELY ABSENT — do not add back:
  - Phase Summary prose table  (duplicated wave_plan; deleted. The execution binding lives in
                                frontmatter `wave_plan`, which IS required — see above.)
  - per-task Model / Effort    (no plan-time model pins; delegation-router resolves at dispatch)
  - per-task Subagent(s)       (no plan-time agent pins)
  - orchestrator_model         (advisory, never read; deleted)
  - 8 standard phases          (milestones replace them)
  - duplicated AC prose        (PRD owns narrative AC; this file owns the matrix)
-->
