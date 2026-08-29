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

## Outputs (advisory keys written back onto the plan + three reports)

The pass writes two **additive advisory keys** onto each `wave_plan.phases[]` entry — already
load-bearing in the RF operator-mcp plan, so these are the canonical names:

- `gate_lens: [security | validator | karen | karen-final-tree-only, ...]` — non-empty for every phase.
- `gate_shared_with: <phase-id> | null` — set on the later phase of a shared-gate merge.

…plus three emitted reports (duplicate-lens, defect-checklist text, cost projection).

## Procedure

Run these steps in order. Steps 1–4 are the emitter; 5–6 are the wiring; 7 is the economics check.

### 1. Classify each phase

For each phase in `wave_plan.phases[]`, match `files_affected` + title/description against the
risk-class table (`gate-risk-classes.md` §2), top to bottom. Assign a non-empty `gate_lens[]`.
**For every phase, record which rule matched** (e.g. "P2 → R7 durability/atomicity") — the
classification must be justifiable by citing the matched rule, not asserted.

- Any R1–R7 match → `security` is assigned and is **non-removable** for the rest of the pass.
- M1–M3 only → `validator`.
- Ambiguous, or an M-row that also reaches an R-surface (D1) → the more expensive lens wins:
  `[security, validator]`. Log the tie.
- Last phase's karen → `karen-final-tree-only`; keep per-phase `karen` only where a foundational
  phase warrants an end-of-phase reality-check.

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
`validator` (mechanical), never to "no review".

### 5. Emit the front-loaded defect checklist

Emit the literal four-item defect-checklist text from `gate-risk-classes.md` §3 — **ready to paste
verbatim into every implementer `Task()` prompt**, not a pointer the orchestrator must go re-derive.
This is an output the pass hands the orchestrator, not a reference.

### 6. Emit a pre-gate dispatch instruction for every security-lens phase

For each phase whose `gate_lens` includes `security`, emit — to run **first**, before the expensive
Opus-class security lens — a cheap pre-gate sweep instruction:

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

The emitted gate plan is advisory input to the execution engine: the orchestrator threads each phase's
`gate_lens` into which reviewer(s) run at that phase's Mandatory Reviewer Gate, pastes the §5 defect
checklist into every implementer prompt, and dispatches the pre-gate sweep before each security lens.
The pass itself dispatches nothing and gates nothing.

## Do Not Say

- Do **not** claim the risk classifier is validated. It is calibrated against exactly one labelled
  retro (n=1 — RF Operator MCP P1). It has not been validated against a plan whose actual review
  outcome diverged from its prediction; on that one plan, the rule and the human judgment already
  disagreed on P1 (see the reference file's §5 "one divergence"). Treat its output as a strong default
  an orchestrator reviews, not an authority.
- Do **not** describe the pre-gate budget as tuned. ~30k is a fixed first-pass default, not a
  per-phase-sized figure — that sizing is deferred to the cost model once more retros exist.
