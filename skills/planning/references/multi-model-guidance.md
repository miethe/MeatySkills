# Multi-Model Routing Guidance

Reference for assigning tasks to external models. Configuration: `.claude/config/multi-model.toml`

## Model Routing Decision Tree

```
START: What is the task type?

Is the task image/asset generation?
  YES → nano-banana-pro (quality mode for final assets)
  NO  → Continue

Is the task UI wireframing, SVG animation, or complex visuals?
  Is it structural (layout, component hierarchy, interaction states, data tables)?
    YES → gemini-3.1-pro SVG wireframe (machine-readable, editable, deterministic labels)
  Is it aesthetic (color exploration, visual feel, high-fidelity stakeholder preview)?
    YES → nano-banana-pro raster mockup (quality mode for finals, standard for iteration)
  Need both? → Gemini SVG first (structure), then Nano Banana (aesthetic target)
  NO  → Continue

Does the task require current web information (post-Feb 2025)?
  YES → gemini-3.1-pro (web search capability)
  NO  → Continue

Is this a debug escalation (2+ failed Claude cycles)?
  YES → gpt-5.3-codex (xhigh effort)
  NO  → Continue

Is this a plan review checkpoint (opt-in)?
  YES → gpt-5.3-codex (medium effort)
  NO  → Continue

Is this documentation, exploration, or simple search?
  YES → haiku (adaptive effort)
  NO  → Continue

DEFAULT: Implementation, code review, or standard development
  → sonnet (adaptive effort)
```

## Effort Level Reference

| Model | Valid Levels | Default | Use When |
|-------|--------------|---------|----------|
| **Claude** (sonnet/opus/haiku) | adaptive, extended | adaptive | standard tasks; extended only when blocked with concrete artifacts |
| **GPT-5.3-Codex** | none, low, medium, high, xhigh | medium | high-complexity tasks (use xhigh for deep analysis, none for formatting) |
| **Gemini 3.1** | none, low, medium, high | medium (Pro), low (Flash) | visual reasoning or web research |
| **Nano Banana Pro** | standard, quality | standard | standard for drafts/iteration; quality for final deliverables |

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
