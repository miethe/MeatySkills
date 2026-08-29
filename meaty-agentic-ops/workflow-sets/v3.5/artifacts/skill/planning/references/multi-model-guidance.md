# Multi-Model Routing Guidance

> **Model policy:** [`docs/agentic-operator/MODEL-ROUTING.md`](../../../../docs/agentic-operator/MODEL-ROUTING.md) (§1.5 scorecard) is canonical. Model/effort tables in this file are derived convenience copies — when they disagree, MODEL-ROUTING wins; update it first, then re-derive here. Resolve provider/model per leg via the `delegation-router` skill; the platform skills (`ica-delegate`, `codex`, `gemini-cli`) only execute the decision.

Reference for assigning tasks to external models. Configuration: `.claude/config/multi-model.toml`

## Model Routing Decision Tree

```
START: What is the task type?

Is the task image/asset generation?
  YES → nano-banana-pro (quality mode for final assets)
  NO  → Continue

Is the task UI wireframing, SVG animation, or complex visuals?
  Is it structural (layout, component hierarchy, interaction states, data tables)?
    YES → gemini-3.5-flash SVG wireframe (machine-readable, editable, deterministic labels)
  Is it aesthetic (color exploration, visual feel, high-fidelity stakeholder preview)?
    YES → nano-banana-pro raster mockup (quality mode for finals, standard for iteration)
  Need both? → Gemini SVG first (structure), then Nano Banana (aesthetic target)
  NO  → Continue

Does the task require current web information (post-Feb 2025)?
  YES → gemini-3.5-flash (web search capability)
  NO  → Continue

Is this a debug escalation (2+ failed Claude cycles)?
  YES → gpt-5.6-terra (xhigh effort)
  NO  → Continue

Is this a plan review checkpoint (opt-in)?
  YES → gpt-5.6-terra (medium effort)
  NO  → Continue

Is this documentation, exploration, or simple search?
  YES → haiku (adaptive effort)
  NO  → Continue

DEFAULT: Implementation, code review, or standard development
  → sonnet (adaptive effort)
```

## Orchestrator Model Escalation

The decision tree above routes the **delegate / task `model`** — who implements inside a phase's `Task()` dispatches. The **`orchestrator_model`** is a separate axis: it names the session / main-loop model that drives the orchestration loop for a plan or phase. Route it independently.

- **Default the plan's `orchestrator_model` to the operator's standard spine (Opus 5).** Set `wave_plan.orchestrator_model` once at the plan level; it cascades to every phase. This is the common case — most plans set only this. (Opus 5 is the flagship spine as of 2026-07-24; Opus 4.8 is now legacy but still selectable.)
- **Escalate a specific phase's `orchestrator_model` (e.g. to Fable 5) only for high-novelty / open-architectural-question phases** in Tier 3 or large Tier 2 plans, via `wave_plan.phases[].orchestrator_model`. Do not escalate routine phases.
- **The model choice moves few tokens on its own** — orchestrator output is a small fraction of the run's total tokens — so escalate wherever a wrong foundational design decision would cascade irrecoverably. The cost of a better orchestrator is negligible against the cost of an unrecoverable architectural mistake.

Keep this distinct from delegate / task `model` routing (the decision tree above): `orchestrator_model` chooses who orchestrates the loop; `model` chooses who implements. The two are set independently and follow separate cascades (see `wave-plan-guidance.md` § Orchestrator model precedence).

## Canonical Effort Vocabulary

Source of truth: `.claude/config/multi-model.toml` § `[models.effort_levels]`

| Model family | Models | Valid Effort values | Default |
|---|---|---|---|
| claude | opus, sonnet, haiku | `adaptive`, `extended` | `adaptive` |
| codex | gpt-5.6-terra | `none`, `low`, `medium`, `high`, `xhigh` | `medium` |
| gemini | gemini-3.5-flash, gemini-3.1-pro-preview | `none`, `low`, `medium`, `high` | `medium` |
| nano_banana | nano-banana-pro | `standard`, `quality` | `standard` |

**Effort is a model-keyed reasoning budget, not a size estimate.** Task size (story points, hours) belongs in the `Estimate` column of the phase task table, never in `Effort`.

### Common Mistakes

- **Numeric story points in Effort** (e.g., `"3pts"`, `"2"`): Use `Estimate` for size; set `Effort` to a valid text level like `adaptive`.
- **Hours or duration in Effort** (e.g., `"2h"`, `"0.5d"`): Hours are an estimate, not a reasoning budget. Move them to `Estimate`; use the model's default effort or specify a text level.
- **Codex effort values on a claude task** (e.g., `Model: sonnet, Effort: medium`): `medium` is not a valid Claude effort level. Claude only accepts `adaptive` or `extended`. Use `adaptive` unless explicitly escalating.

---

## Effort Level Reference

| Model | Valid Levels | Default | Use When |
|-------|--------------|---------|----------|
| **Claude** (sonnet/opus/haiku) | `adaptive`, `extended` | `adaptive` | standard tasks; `extended` only when blocked with concrete artifacts |
| **GPT-5.6** (terra/sol/luna) | `none`, `low`, `medium`, `high`, `xhigh` (+ `ultra` on sol/terra) | `medium` | high-complexity tasks (use `xhigh` for deep analysis, `none` for formatting; `gpt-5.5` superseded) |
| **Gemini 3.5 Flash** / **Gemini 3.1 Pro Preview** | `none`, `low`, `medium`, `high` | `medium` | visual reasoning or web research |
| **Nano Banana Pro** | `standard`, `quality` | `standard` | `standard` for drafts/iteration; `quality` for final deliverables |

> These values are reproduced from the Canonical Effort Vocabulary table above. The canonical table is the authoritative reference; if they disagree, the canonical table wins.

## External Model Pre-Work Batching

External model tasks should group as **batch_0** (before main implementation) when outputs feed downstream work:

```yaml
parallelization:
  batch_0:
    # External models first (images, research, wireframes)
    - task: IMAGE-1.1
      assigned_to: nano-banana-pro
      effort: quality

    - task: RESEARCH-1.1
      assigned_to: gemini-3.5-flash
      effort: medium

  batch_1:
    # Implementation consuming batch_0 outputs
    - task: IMPL-1.1
      assigned_to: sonnet
      effort: adaptive
      depends_on: [IMAGE-1.1, RESEARCH-1.1]

  batch_2:
    # Dependent implementation
    - task: IMPL-1.2
      assigned_to: sonnet
      effort: adaptive
      depends_on: [IMPL-1.1]
```

## Task Type Examples

| Task | Model | Effort | Rationale |
|------|-------|--------|-----------|
| Generate app icon (final) | nano-banana-pro | quality | visual asset generation at max quality |
| Research Next.js 15 patterns | gemini-3.5-flash | medium | web search + synthesis needed |
| Implement user profile API | sonnet | adaptive | standard implementation |
| Debug auth flow (3rd attempt) | gpt-5.6-terra | xhigh | escalated debugging (threshold: 2 cycles) |
| Write component documentation | haiku | adaptive | documentation is cheap (haiku optimized) |
| UI wireframe (layout/hierarchy) | gemini-3.5-flash | medium | SVG wireframe — machine-readable, editable, precise labels |
| UI mockup (aesthetic/feel) | nano-banana-pro | standard | raster mockup — visual aesthetics, color exploration |
| UI mockup (stakeholder preview) | nano-banana-pro | quality | high-fidelity raster for sign-off |

## Checkpoint Policies

- **Plan Review**: Opt-in checkpoint via `multi-model.toml`. Route to gpt-5.6-terra at medium effort for second opinion.
- **PR Cross-Review**: Opt-in checkpoint. Gemini 3.5 Flash for security-sensitive code (auth, crypto patterns).
- **Debug Escalation**: Auto-trigger after `suggest_codex_debug_after_cycles` (default: 2) failed attempts.
- **Privacy-Sensitive**: Route to local LLM (if enabled) instead of external services.
