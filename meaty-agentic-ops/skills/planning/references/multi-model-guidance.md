# Multi-Model Routing Guidance

Reference for assigning tasks to external models. Configuration: `.claude/config/multi-model.toml`

## Model Routing Decision Procedure

For the authoritative model selection and provider routing decision procedure, see `.claude/specs/provider-routing-spec.md §3`. This document retains the Canonical Effort Vocabulary (below) as the single authoritative source for valid effort values and defaults per model family.

## Canonical Effort Vocabulary

Source of truth: `.claude/config/multi-model.toml` § `[models.effort_levels]`

| Model family | Models | Valid Effort values | Default |
|---|---|---|---|
| claude | opus, sonnet, haiku | `adaptive`, `extended` | `adaptive` |
| codex | gpt-5.3-codex | `none`, `low`, `medium`, `high`, `xhigh` | `medium` |
| gemini | gemini-3.1-pro, gemini-3.1-flash | `none`, `low`, `medium`, `high` | `medium` |
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
| **GPT-5.3-Codex** | `none`, `low`, `medium`, `high`, `xhigh` | `medium` | high-complexity tasks (use `xhigh` for deep analysis, `none` for formatting) |
| **Gemini 3.1** (Pro/Flash) | `none`, `low`, `medium`, `high` | `medium` | visual reasoning or web research |
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
      assigned_to: gemini-3.1-pro
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
| Research Next.js 15 patterns | gemini-3.1-pro | medium | web search + synthesis needed |
| Implement user profile API | sonnet | adaptive | standard implementation |
| Debug auth flow (3rd attempt) | gpt-5.3-codex | xhigh | escalated debugging (threshold: 2 cycles) |
| Write component documentation | haiku | adaptive | documentation is cheap (haiku optimized) |
| UI wireframe (layout/hierarchy) | gemini-3.1-pro | medium | SVG wireframe — machine-readable, editable, precise labels |
| UI mockup (aesthetic/feel) | nano-banana-pro | standard | raster mockup — visual aesthetics, color exploration |
| UI mockup (stakeholder preview) | nano-banana-pro | quality | high-fidelity raster for sign-off |

## Checkpoint Policies

- **Plan Review**: Opt-in checkpoint via `multi-model.toml`. Route to gpt-5.3-codex at medium effort for second opinion.
- **PR Cross-Review**: Opt-in checkpoint. Gemini 3.1 Pro for security-sensitive code (auth, crypto patterns).
- **Debug Escalation**: Auto-trigger after `suggest_codex_debug_after_cycles` (default: 2) failed attempts.
- **Privacy-Sensitive**: Route to local LLM (if enabled) instead of external services.
