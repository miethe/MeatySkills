# Mode — Plan Optimization (risk-classed reviewer-gate selection)

A pre-dispatch planning pass that runs **once per plan, at the plan/execute boundary — before the
first implementer is dispatched.** It reads a plan's `wave_plan`, classifies each phase's risk class,
and emits a per-phase gate plan (which reviewer lens, and how many), a duplicate-lens report,
shared-gate merges, a front-loaded defect checklist for implementer prompts, a cheap pre-gate sweep
instruction, and a cost projection with an inversion warning.

It turns gate-economics reasoning that currently happens ad hoc, mid-run, inside an orchestrator's
head — after the review tokens are already spent — into a repeatable pass that runs every time, with
the plan in hand, before the money is spent.

**Ruleset, defect checklist, and cost calibration live in
[`../references/gate-risk-classes.md`](../references/gate-risk-classes.md).** This file owns the
procedure; that file owns the data. Load both to run the pass.

## When to run

At the **plan/execute boundary** — the same moment `hooks/seed-dossier.sh` and
`hooks/provision-artifacts.sh` already fire: *before* the `ExecutionGraph` / wave loop is built
(`modes/plan-execution.md` pre-flight, or `/dev:execute-plan` §"Workflow Path" pre-flight). Run it
once, on a plan that already has a `wave_plan`.

## What it is NOT

- **Not a plan author.** It consumes an existing `wave_plan`; it never proposes phases, scope, or tier.
  Tier is `planning`'s job (`plan:plan-feature`).
- **Not a reviewer, and not a gate.** It is a pre-dispatch planning pass with no authority to mark a
  phase reviewed, approve, or waive anything. The Mandatory Reviewer Gates in `../SKILL.md` still run.
- **Not a lens-cutter.** It never recommends dropping the *only* lens a phase's risk class requires —
  only a *duplicate*. See the hard invariant in the reference file. Cutting a distinct security lens is
  prohibited, structurally.

## Inputs

- `wave_plan.phases[]` — per phase: `id`, `depends_on`, `isolation`, `parallelizable`, `model`,
  `effort`, `files_affected`, and any existing gate assignment.
- `wave_plan.serialization_barriers` — file-ownership serialization groups (for shared-gate detection).
- The risk-class ruleset + defect checklist + cost calibration in `../references/gate-risk-classes.md`.

## Outputs (gate keys written back onto the plan + three reports)

The pass writes these **additive** keys onto each `wave_plan.phases[]` entry — already load-bearing in
the RF operator-mcp plan, so these are the canonical names:

- `gate_lens: [security | validator | karen | karen-final-tree-only, ...]` — non-empty for every phase;
  **one entry by default**.
- `gate_lens_reason: untrusted-input | authz-boundary | irreversible-outward | ambiguity-tie` —
  **required whenever `gate_lens` has ≥2 entries**, absent otherwise.
- `gate_shared_with: <phase-id> | null` — set on the later phase of a shared-gate merge.

All three are now registered in `planning/references/plan-frontmatter-schema.md` §5.4 and the
cross-app contract, and `gate_lens` is **read at dispatch** by `councilEscalation` — these are no
longer advisory-only keys.

…plus three emitted reports (duplicate-lens, defect-checklist text, cost projection).

## Procedure

Run these steps in order. Steps 1–4 are the emitter; 5–6 are the wiring; 7 is the economics check.

### 1. Classify each phase

For each phase in `wave_plan.phases[]`, run the **two-step tier** in `gate-risk-classes.md` §2.
**For every phase, record which rule matched** (e.g. "P2 → R7 durability/atomicity") — the
classification must be justifiable by citing the matched rule, not asserted.

- **Step 1 — the default, one lens.** F1 (ordinary product surface: CRUD, UI, reporting, read path,
  internal API shaping, test-only) or M1–M3 → `[validator]`. A phase matching **no row** also gets
  `[validator]`. Step 1 has no path to two lenses.
- **Step 2 — the second-lens test.** Add `security` (non-removable) **only** on one of three named
  triggers, and record the trigger as `gate_lens_reason`:
  - `untrusted-input` → R8
  - `authz-boundary` → R1, R2, R3, R4, R6
  - `irreversible-outward` → R5, R7, R9
- **Ambiguity resolves to a question, not a second reviewer.** If a phase might reach an R-surface
  but you cannot confirm it, assign **one** lens and state the named unknown — which value, caller,
  or surface you could not rule out — then resolve it by reading the code. Do **not** escalate to
  two lenses by tie-break. (The old D1 "more expensive lens wins" rule is **retired**; it was the
  largest source of default-two-lens inflation.)
- `karen` is the **one whole-tree pass per feature**: last phase → `karen-final-tree-only`. Add a
  plan-milestone-boundary `karen` only when `context_class` is C3/C4.

### 2. Emit the duplicate-lens report

One row per phase whose *original* gate assignment included two lenses. Columns: phase · original
lenses · kept · cut · one-line rationale. Only ever cut a lens whose coverage another assigned lens
subsumes — **never** a phase's only security lens. (Format: `gate-risk-classes.md` §5 worked example.)

### 3. Emit shared-gate merges

For phases serialized by file-ownership (same `serialization_barriers` entry or overlapping
`files_affected`) whose review is the same body of work, set `gate_shared_with: <earlier-phase-id>`
on the later phase. Do not merge if the shared review would not genuinely cover both.

### 4. Confirm every phase carries a lens

No phase may exit the pass with an empty `gate_lens[]`. A phase with no matched rule defaults to
`[validator]` — one lens, never to "no review" and never to two.

**And no phase may exit with 2+ lenses and no `gate_lens_reason`.** That combination is a
classification error, not a cautious default: go back to step 1 and either name the trigger or drop
to one lens. `validate-plan-frontmatter.py` reports it as an advisory conditional-required gap.

### 5. Emit the front-loaded defect checklist

Emit the literal four-item defect-checklist text from `gate-risk-classes.md` §3 — **ready to paste
verbatim into every implementer `Task()` prompt**, not a pointer the orchestrator must go re-derive.
This is an output the pass hands the orchestrator, not a reference.

### 6. Emit a pre-gate dispatch instruction for every security-lens phase

**Only for phases whose `gate_lens` includes `security`** — i.e. only phases with a named step-2
trigger. **Never emit a pre-gate for a one-lens phase.** The pre-gate is the cheap first rung of the
*second* lens, not an extra step bolted onto the default path; an ordinary F1/M phase's gate is
exactly one validator pass and nothing before it.

For each such phase, emit — to run **first**, before the expensive Opus-class security lens — a cheap
pre-gate sweep instruction:

- **Agent / model:** Sonnet-class (cheap), per MODEL-ROUTING §1.5.
- **Budget:** ~30k tokens (fixed first-pass default; P3's cost model may size it per-phase once more
  retros calibrate it — see the reference file's Do-Not-Say note).
- **Checklist scope:** the fail-open (§3 item 1) and layer-below (§3 item 2) classes.
- **Escalation:** only what survives the pre-gate escalates to the full security lens.

Emit these in order: **pre-gate first, then the escalation lens.**

### 7. Emit cost projection + inversion warning

Using `effort` + `model` + lens count as inputs, calibrated against the actuals in
`gate-risk-classes.md` §4, produce a per-phase estimate of projected implementation vs projected
review cost. **Flag any phase where projected review > projected implementation** — that is the signal
the gate structure is wrong for that phase — and name which lens to cut or merge to correct it. A
phase carrying `security` should assume ≥2 review rounds in its estimate (the retro needed two).

## Hand-off

The emitted gate plan is input to the execution engine: the orchestrator threads each phase's
`gate_lens` into which reviewer(s) run at that phase's Mandatory Reviewer Gate, pastes the §5 defect
checklist into every implementer prompt, and dispatches the pre-gate sweep before each security lens
(and **only** there). **The pass itself dispatches nothing and gates nothing** — but its output is no
longer inert: `councilEscalation` in the live `execute-plan.js` selects the reviewer from `gate_lens`
before anything else, so a `security` assignment here becomes a `council-review` dispatch there.

## Do Not Say

- Do **not** claim the F1 / R8 / R9 rows or the retired-D1 behaviour are measured. They are
  **doctrine** (gate-tiering v4.1), added to close surfaces the ruleset had no row for. Only the cost
  model (§4) and defect checklist (§3) rest on the labelled retro.
- Do **not** claim the risk classifier is validated. Its cost calibration is against exactly one
  labelled retro (n=1 — RF Operator MCP P1). It has not been validated against a plan whose actual review
  outcome diverged from its prediction; on that one plan, the rule and the human judgment already
  disagreed on P1 (see the reference file's §5 "one divergence"). Treat its output as a strong default
  an orchestrator reviews, not an authority.
- Do **not** describe the pre-gate budget as tuned. ~30k is a fixed first-pass default, not a
  per-phase-sized figure — that sizing is deferred to the cost model once more retros exist.
