# Plan Doctrine (Claude-5 generation)

> The authoring half of the Claude-5-generation doctrine. Execution half:
> `.claude/skills/dev-execution/references/execution-doctrine.md`. Long form + evidence:
> `docs/project_plans/design-specs/claude5-plan-doctrine-v1.md`.
>
> Applies to **new** Tier 2/3 plans. In-flight plans finish under the rules they were authored on.

## Why this exists

Plans were tuned for 2025-era models: enumerate every task, pin an agent and a model to each,
lock phase boundaries, gate every hop. Measured against six real plans, that structure *caused*
cost rather than controlling it — burn spread from 18M to 138M tokens-in per point at near-equal
per-task estimates. Every plan in that corpus was 100% pinned, so pins are an artifact of the era,
not the discriminator within it. Frontier models degrade under prescription density. Plan for a
capable executor, not a task queue.

## The four authoring rules

**1. Spec the destination, not the route.** A plan carries intent, acceptance criteria, rubrics,
named risks, decisions-to-surface, and references (code > mockups > prose). Enumerate tasks
*only* where sequencing is load-bearing — migrations, serialization barriers, cross-repo
handshakes — and say so explicitly at the point of enumeration. If you cannot name why the order
matters, do not order it.

**2. Milestones, not phases.** Three to four coarse milestones with AC replace six to ten
sequential phases. A milestone is **a reviewable state of the system**, not a batch of tasks.
Hand an executor a whole milestone; it starts at the top of its difficulty range.

> **Terminology.** This is a *fourth* sense of "milestone" in the stack. It is not the
> `milestone:` frontmatter release marker, not the IntentTree `node_type: milestone`, and not
> "a batch boundary inside a phase" (dev-execution's older usage). When ambiguity is possible,
> write **plan milestone**.

> **"Hand an executor a whole milestone" is an authoring claim, not a dispatch instruction.** A
> milestone is the unit a *plan* is written in and the unit a *reviewer* judges; it is not
> necessarily the unit one agent is handed. A mid-tier executor receives a **leg contract** —
> one file-ownership boundary, real interface and field names, a named verification path — composed
> at dispatch time, and a milestone spanning more than one boundary is split into several
> (`dev-execution/references/execution-doctrine.md` rule 6 + § "Leg scoping"). Reading this rule as
> "one milestone = one dispatch" put a whole C3 milestone — 16 files, 87 tests, 4 API modules — on one
> leg, at ~1.5–2.0× the `gate-risk-classes.md` §4 implementer band for its scope. (That overrun was
> originally reported as "20×" against a resident-context-window figure; see § "Leg scoping"'s
> correction note — the scoping failure is unchanged, the multiplier was a unit error.) Nothing about
> that changes what the plan says; it changes who the plan is addressed to.

**3. No plan-time model or agent pins.** Plans carry *constraints*, not identities: which classes
must stay claude-primary, what is offload-eligible, and the capability bar per milestone. The
orchestrator resolves provider and model at dispatch time via `delegation-router` against the
live registry. Plans that pinned models were obsolete within days of authoring.

> A plan MAY pin where the constraint is contractual ("never offload merge-path correctness") —
> phrased as a constraint, never as a model id.

**4. Plan mass is a budget.** Target **<=150 lines** for a Tier 3 plan, frontmatter included.
Decisions live in the plan (one file), not spread across sibling worknotes every leg must
re-read. AC prose appears once — the PRD owns narrative AC; the plan owns the AC -> command ->
evidence matrix. Cross-repo plans carry a <=30-line inlined context digest instead of a stack of
required-reading refs.

## Context class

Points size human-scale scope; they do not size agent context. Each milestone additionally
declares a **context class**, which is what actually predicts burn.

| class | shape | expected burn | execution posture |
|---|---|---|---|
| **C1** | bounded, single-module | <=50M | economy/workhorse model, single session |
| **C2** | cross-module, one repo | <=200M | workhorse, 1-2 sessions, notes-forward |
| **C3** | cross-repo or migration | <=600M | frontier orchestrator, decomposed contexts, gate budget 2 |
| **C4** | cross-repo + adversarially gated + novel | explicit budget required | frontier + fresh-context verifiers; operator checkpoint at every milestone boundary |

Weigh six drivers when assigning: write-risk surfaces, shared hot files and serialization
barriers, validation fan-out scope, unresolved design uncertainty, expected context footprint per
dispatch, and expected retry probability. The working model is
**expected dispatches x bounded context packet x review/retry rounds** — which is why gate
budgets and delta-context dispatch are the levers that move it, not tighter estimates.

Context class generalizes H7 (`estimation-heuristics.md`): a task touching a >2K-line file costs
>=2x its points because of *context*, not behavior. Realized-vs-declared burn is reviewed weekly
from the CCDash token rollup; two consecutive misses on a class recalibrates **the class table**,
not the individual estimate. Points were non-predictive in the retro — an 18M-138M spread per
point across six plans with near-equal per-task estimates.

## Design rule — surface reduction before guard proliferation

**Ask "what can the caller even say?" before "is every input guarded?"** When a plan names a risk that
is really about unsafe input, unsafe state, or an unsafe call path, spec the destination as a *narrower
surface*, not as a longer list of checks.

The order is:

1. **Make the unsafe state unrepresentable** — a narrower type, a closed enum instead of a free
   string, a required parameter instead of an optional one with a permissive default, one constructor
   instead of five. If the caller cannot express the unsafe thing, there is nothing to guard.
2. **Route every caller through one choke point** — one primitive all writes go through, with the raw
   path inaccessible or statically detectable. Then one bounded review covers it.
3. **Only then, guard what remains.** Guards are the residue after 1 and 2, not the opening move.

This is an **authoring** lever, which is why it lives here: a plan that specs a choke point produces
one reviewable surface, while a plan that specs "validate all inputs" produces N call sites, N guards,
and a standing obligation to remember the guard at site N+1. It is also the counter-move to the
recurrence trigger in `dev-execution/references/execution-doctrine.md` rule 1 — when two review rounds
find the same defect class, **this** is what the required design change is.

> From the 2026-07-24 cross-AAR review: "Turn cross-cutting invariants into non-bypassable routes …
> when every operation of type X must go through seam Y, land Y first and fail CI if anything bypasses
> it." Its verdict line is the argument in one sentence: **"Review is finding the defects. Architecture
> should prevent their class."**

Surface reduction also lowers the gate cost of the plan: a milestone whose unsafe states are
unrepresentable may stop matching a second-lens trigger at all
(`dev-execution/references/gate-risk-classes.md` §2, §3b).

## Model-conditional expansion

The doctrine is itself model-conditional. Economy-class executors may still need an expanded task
list — but it is **generated at dispatch time by the orchestrator from the milestone AC**, never
stored in the plan. The plan stays thin; expansion is a render.

The **leg contract** for a mid-tier executor is the same kind of render, and the measured evidence
says it is the one that matters: under thin plans, delegates did not build the wrong feature (zero
AARs) — they shipped code whose tests exercised a path production never takes. The granularity a
mid-tier executor needs is therefore *not* more plan prose but precise files, interfaces, field
names, and a named verification path, resolved against the tree at dispatch. Fields and rationale:
`dev-execution/references/execution-doctrine.md` rule 6. Evidence:
`docs/project_plans/reports/workflow-v41-delegate-retro-2026-08-06.md`.

> Which means a plan gets **thinner**, not thicker, in response to this finding. If you are tempted
> to pre-write the leg contracts into the plan, you are re-importing plan mass (rule 4) and pinning
> names that may not survive to dispatch.

## What does not change

Worktree -> PR -> squash protocol, IntentTree binding, DoD and SkillMeat registration, changelog
discipline. None of these were burn drivers; they are cheap, high-value bookkeeping. Keep them.

## Failure mode this doctrine accepts

Under-specification on genuinely novel work. Mitigated by surfacing *unknowns* during planning
(blind-spot pass + interview step, which replace the effort previously spent enumerating tasks)
and by C4's explicit operator checkpoints. If a plan cannot name its unknowns, it is not thin —
it is vague, and thinning it further is the wrong move.
