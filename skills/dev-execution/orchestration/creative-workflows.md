# Creative Workflow Orchestration

Unified routing reference for creative and visual tasks. Read when Opus must decide which model to invoke for image, SVG, UI mockup, or video generation.

## Creative Task Routing

```
Creative task arrives at Opus
│
├─ Image generation needed?
│   ├─ Check config: models.defaults.image_generation
│   │   ├─ "nano-banana-pro" (default) → NBP script
│   │   ├─ "gemini-3.1-pro" → Gemini inline generation
│   │   └─ "claude" → text description fallback
│   ├─ Resolution requirement?
│   │   ├─ > 2K → NBP (supports 4K natively)
│   │   └─ ≤ 2K → configurable
│   └─ Needs code context? → Gemini 3.1 Pro (understands surrounding code)
│
├─ SVG/animation needed?
│   ├─ Simple (icons, basic shapes) → Claude Sonnet (no external call)
│   ├─ Complex (multi-element, animated) → Gemini 3.1 Pro
│   └─ CSS animations → Gemini 3.1 Pro (can verify visual result)
│
├─ UI mockup needed?
│   ├─ Gemini 3.1 Pro generates: visual mockup + React/TSX + Tailwind
│   ├─ User reviews mockup → approves or iterates
│   └─ Claude Sonnet integrates into codebase with project conventions
│
├─ Video needed?
│   └─ Sora 2 (only option) → 4-12s clips with synced audio
│       ├─ Standard quality → sora-2
│       └─ Premium quality → sora-2-pro
│
└─ Not configured? → Ask user for provider preference
```

## Workflow: UI Design and Component Generation

1. User describes desired UI component.
2. Invoke Gemini 3.1 Pro via `gemini-cli` skill with template from `gemini-cli/templates-creative.md`.
3. Gemini generates: visual mockup (image) + React/TSX code + Tailwind styling.
4. Present mockup to user for approval.
5. If approved: delegate to `ui-engineer-enhanced` to integrate with project conventions.
6. If rejected: iterate with Gemini using user feedback.

Advantage: Gemini shows what it's building visually before committing to code.

## Workflow: SVG and Animation Generation

| Complexity | Model | Examples |
|-----------|-------|---------|
| Simple | Claude Sonnet | Icons, basic shapes, simple logos |
| Complex | Gemini 3.1 Pro | Multi-element illustrations, animated SVGs |
| CSS animations | Gemini 3.1 Pro | Keyframes, transitions, multi-stage sequences |

For complex SVG:
1. Invoke Gemini with template from `gemini-cli/templates-creative.md`.
2. Gemini generates SVG code with visual preview capability.
3. Validate: `xmllint --noout output.svg`.
4. Claude Sonnet refines for project integration.

## Workflow: Image Asset Generation

| Use Case | Model | Resolution | Notes |
|----------|-------|-----------|-------|
| Marketing / hero art | NBP | 4K | Single generation, high quality |
| UI mockups with code | Gemini 3.1 Pro | Varies | Context-aware, understands code |
| Icon sets | NBP | 1K→2K | Draft at 1K, iterate, final at 2K |
| OG images / favicons | NBP | 1K-2K | Standard generation |
| Batch variants | NBP | Sequential | Consistent style prefix across variants |

All outputs follow asset pipeline structure: `assets/ai-gen/{date}/{model}/{filename}`.
Provenance tracked per `[asset_pipeline]` config.

## Workflow: Demo Video Generation

1. User describes desired video (product demo, feature showcase, marketing).
2. Invoke `sora` skill with structured prompt.
3. Sora 2 generates 4-12s clip with synced audio.
4. Review output before publishing.
5. Download in preferred format (MP4 + thumbnail + spritesheet).

Generation latency is significant — always review outputs before use.

## Configuration Reference

All creative workflows read from `.claude/config/multi-model.toml`:

| Key | Purpose |
|-----|---------|
| `[models.defaults].image_generation` | Image provider selection |
| `[models.defaults].svg_generation` | SVG provider selection |
| `[models.defaults].video_generation` | Video provider (always `sora-2`) |
| `[checkpoints.creative_model_selection]` | `"ask"` (default) or `"auto"` |
| `[asset_pipeline]` | Output directory, provenance settings |

When `creative_model_selection = "ask"`, confirm provider with user before generating.
When `creative_model_selection = "auto"`, use routing table above without confirmation.

## Cross-References

- Model selection guide: `model-selection-guide.md`
- Gemini templates: `gemini-cli/templates-creative.md`
- NBP skill: `nano-banana-pro/SKILL.md`
- Sora skill: `sora/SKILL.md`
