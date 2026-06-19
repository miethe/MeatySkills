# Multi-Model Usage Spec

**Version**: 1.0
**Purpose**: Rules and patterns for multi-model SDLC integration
**Token Target**: ~300 lines
**Format**: Dense, structured, AI-optimized

---

## Core Invariants

1. **Claude Opus is the sole orchestrator.** External models are execution targets, never orchestrators.
2. **All external integrations are opt-in.** Without configuration, everything works exactly as today.
3. **All external model output is validated by Claude** before integration into the codebase.
4. **Tests decide disagreements**, not model preference. CI is the neutral arbiter.
5. **Effort/thinking is a budgeted policy**, not a vibe. Escalate only when blocked with concrete artifacts.

---

## Configuration

**File**: `.claude/config/multi-model.toml`

### Reading Configuration

```toml
# Check if a model is enabled
[models]
codex_enabled = true       # GPT-5.3-Codex for plan review, debug escalation
gemini_enabled = true      # Gemini 3.1 Pro for PR review, web research, creative
nano_banana_enabled = true # Image generation
sora_enabled = true        # Video generation
local_llm_enabled = false  # Privacy-sensitive tasks (requires setup)
claude_teams_enabled = false # Parallel Claude instances (Phase 4)
```

### Checkpoint Behavior

```toml
[checkpoints]
plan_review = "ask"              # "auto" | "ask" | "off"
pr_cross_review = "ask"          # "auto" | "ask" | "off"
debug_escalation = "ask"         # Always "ask" recommended
creative_model_selection = "ask" # "auto" | "ask" | "off"
```

| Value | Behavior |
|-------|----------|
| `"ask"` (default) | Opus suggests, user confirms |
| `"auto"` | Proceed automatically when thresholds met |
| `"off"` | Never trigger this checkpoint |

### Effort Policy

```toml
[models.effort_policy]
# Format: { claude = "adaptive|extended", codex = "none|low|medium|high|xhigh" }
architecture_decisions = { claude = "adaptive", codex = "xhigh" }
implementation          = { claude = "adaptive", codex = "medium" }
debugging_escalated     = { claude = "extended", codex = "xhigh" }
escalation_requires_artifacts = true  # MUST have failing tests/traces to escalate
```

**Rule**: Start with default effort. Only escalate when:
1. Task is **blocked** (not just hard)
2. You have **concrete artifacts** (failing tests, stack traces, conflicting requirements)
3. Default effort was attempted first

**Deprecated**: `budget_tokens` on Opus 4.6. Use adaptive/extended thinking + effort controls.

### Thresholds

```toml
[thresholds]
files_changed_suggest_review = 10
security_sensitive_patterns  = ["auth", "crypto", "token", ...]
suggest_gemini_for_context_above = 150000  # tokens → Gemini
suggest_codex_debug_after_cycles = 2       # failed cycles → Codex
```

### Asset Pipeline

```toml
[asset_pipeline]
output_dir     = "assets/ai-gen"
structure      = "{date}/{model}/{filename}"  # e.g., 2026-02-25/nbp/hero.png
store_prompts  = true  # Save prompt alongside output
store_seeds    = true  # Save seeds for reproducibility
store_metadata = true  # Provenance metadata (model, params, timestamp)
```

---

## Model Selection Decision Procedure

For the authoritative model and provider selection procedure, including decision trees and per-task-class routing policy, see `.claude/specs/provider-routing-spec.md §3`. This spec retains the Effort/Checkpoint Policy section below as the single authoritative source for reasoning budget controls across all models.

---

## Workflow Patterns

### Pattern 1: Checkpoint Review

```
1. Opus detects checkpoint trigger (plan generated, PR ready)
2. Read config: checkpoints.{type}
3. If "off" → skip
4. If "ask" → present suggestion to user with rationale
5. If "auto" or user confirms → invoke external model
6. Collect structured output (PASS/CONCERN/BLOCK or LGTM/ISSUES)
7. Opus synthesizes findings — never auto-apply
```

### Pattern 2: Debug Escalation

```
1. ultrathink-debugger reports failure after N cycles
2. Opus presents options: continue Claude / escalate Codex / escalate Gemini
3. User selects
4. If Codex: full error context + already-tried approaches + "re-check against repo reality"
5. Opus evaluates root cause analysis
6. Delegate fix implementation to Claude agent (NOT Codex)
```

### Pattern 3: Creative Task Routing

```
1. Opus identifies creative need (image, SVG, video, mockup)
2. Check config: models.defaults.{type} for preferred provider
3. If configured → route directly
4. If not configured → ask user preference
5. Generate with external model
6. Claude validates/integrates output into codebase
```

### Pattern 4: Disagreement Resolution

```
1. Two models produce conflicting output
2. Existing tests? → Run both, winner = passes tests (simpler diff breaks ties)
3. No tests? → Write minimal tests first, then compare
4. Design disagreement? → Reversible: pick either. Irreversible: Opus decides.
5. Never auto-pick based on model reputation
```

---

## Codex Model Line

OpenAI treats Codex models as a specialized agentic coding line:

| Line | Models | Use For |
|------|--------|---------|
| **Codex** (coding) | GPT-5.3-Codex, Codex-Spark | Tool use, file editing, sandbox execution |
| **General** (reasoning) | GPT-5.2, GPT-5.2-mini | Open-ended reasoning, review, analysis |

Default: GPT-5.3-Codex for coding tasks. GPT-5.2 for non-coding review.

**Known hazard**: Codex can overfit to its own generated plan. Always include "re-check against repo reality" instruction in debug/implementation prompts.

---

## Gemini Output Discipline

- Context: ~1M input / 65K output
- **Always** use `-o text` flag to avoid JSON envelope overhead
- Chunk requests expecting >32K output tokens
- For long diffs: split by file, not by arbitrary size
- Flash (gemini-3-flash) for simple tasks; Pro (gemini-3.1-pro) for complex

---

## Asset Provenance

All AI-generated assets follow this structure:

```
assets/ai-gen/{date}/{model}/
  {filename}.png           # Output
  {filename}.prompt.txt    # Exact prompt
  {filename}.meta.json     # Model, params, seed, timestamp, watermark
```

Enables: reproducibility (re-generate), attribution (which model), auditability (metadata/watermarks).

---

## Reference Map

| Topic | File |
|-------|------|
| Configuration | `.claude/config/multi-model.toml` |
| Model selection tree | `.claude/skills/dev-execution/orchestration/model-selection-guide.md` |
| Cross-model review | `.claude/skills/dev-execution/orchestration/cross-model-review.md` |
| Escalation rules | `.claude/skills/dev-execution/orchestration/escalation-protocols.md` |
| Disagreement protocol | `.claude/skills/dev-execution/orchestration/disagreement-protocol.md` |
| Creative workflows | `.claude/skills/dev-execution/orchestration/creative-workflows.md` |
| Codex skill | `.claude/skills/codex/SKILL.md` |
| Gemini skill | `.claude/skills/gemini-cli/SKILL.md` |
| Gemini templates | `.claude/skills/gemini-cli/templates-creative.md` |
| NBP skill | `.claude/skills/nano-banana-pro/SKILL.md` |
| Sora skill | `.claude/skills/sora/SKILL.md` |
| Architecture report | `docs/project_plans/reports/multi-model-sdlc-integration.md` |
