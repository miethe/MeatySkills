# Model Selection Guide

Decision tree and routing reference for multi-model SDLC orchestration.
Config: `.claude/config/multi-model.toml`

---

## Decision Flow

```
Task arrives at orchestrator (Opus)
│
├─ Creative/visual task?
│   ├─ Image needed?
│   │   ├─ Resolution > 2K → Nano Banana Pro (4K native)
│   │   └─ Resolution ≤ 2K → config: preferred_image_provider (default: NBP)
│   ├─ SVG/animation?
│   │   ├─ Complex (multi-element, animated) → Gemini 3.1 Pro
│   │   └─ Simple (icons, basic shapes) → Claude Sonnet
│   └─ Video? → Sora 2
│
├─ Review/validation task?
│   ├─ User requested cross-validation → route to specified model
│   ├─ Files changed > 10 → suggest Codex review
│   ├─ Security patterns detected (auth/crypto/token/etc.) → suggest Codex review
│   ├─ Architecture change → suggest Gemini codebase analysis
│   └─ Standard → Claude (senior-code-reviewer)
│
├─ Research task?
│   ├─ Needs current web info → Gemini 3.1 Pro (Google Search grounding)
│   ├─ Context > 200K tokens → Gemini 3.1 Pro (~1M window)
│   └─ Codebase patterns → Claude (codebase-explorer)
│
├─ Debug escalation?
│   ├─ 2+ failed cycles with Claude → Codex (xhigh reasoning, sandbox)
│   ├─ Environment-specific → Codex sandbox isolation
│   └─ Standard → Claude (ultrathink-debugger)
│
├─ Privacy-sensitive?
│   └─ Local LLM (if configured) or Claude only — never route externally
│
└─ Default: Claude Sonnet (implementation) | Haiku (search/docs)
```

---

## Interaction Patterns

**Pattern A — Orchestrator suggests, user confirms** (`checkpoints.*: "ask"`):
```
Opus: "This plan touches 14 files including auth middleware.
       Recommend Codex plan review before implementation. Run? [y/N]"
User: "y" → Codex reviews read-only → Opus incorporates feedback
```

**Pattern B — Auto with configured provider** (`checkpoints.*: "auto"`):
```
Config: image_generation = "nano-banana-pro"
Task: "Create hero illustration"
→ Opus routes directly to NBP; falls back to Gemini 3.1 Pro on failure
```

**Pattern C — Explicit user request** (always honored, no config check):
```
User: "Get Gemini's opinion on this architecture"
→ Opus invokes gemini-orchestrator directly
```

**Pattern D — Self-assessed escalation** (always `ask`, never auto):
```
ultrathink-debugger: Failed cycle 2, no root cause
Opus: "Debug stalled after 2 cycles. Options:
       1. Continue with Claude (different approach)
       2. Escalate to Codex (xhigh reasoning, sandbox)
       3. Escalate to Gemini (codebase_investigator)
       [1/2/3]"
```

---

## Effort Policy Quick Reference

| Task Type | Claude | Codex | Gemini |
|-----------|--------|-------|--------|
| Architecture decisions | adaptive | xhigh | 3.1 Pro |
| Plan generation | adaptive | high | 3.1 Pro |
| Plan review | adaptive | medium | 3.1 Pro |
| Implementation | adaptive | medium | 3.1 Pro |
| Code review | adaptive | medium | Flash |
| Debugging (initial) | adaptive | high | 3.1 Pro |
| Debugging (escalated) | extended | xhigh | 3.1 Pro |
| Simple search | adaptive | low | Flash |
| Documentation | adaptive | low | Flash |
| Formatting/mechanical | adaptive | none | Flash |

**Escalation rule**: Only escalate to `extended`/`xhigh` when **blocked** with concrete artifacts (failing tests, stack traces, conflicting requirements). `escalation_requires_artifacts = true` enforces this. "Hard problem" alone is not sufficient.

---

## Unique Capability Map

Capabilities exclusive to or significantly better on specific models:

| Capability | Primary | Notes |
|------------|---------|-------|
| Real-time web search | Gemini 3.1 Pro | Google Search grounding; only native search in this architecture |
| Image generation | Nano Banana Pro | NBP for quality; Gemini for code+image combos |
| Image editing | Nano Banana Pro | NBP for precision; Gemini for context-aware edits |
| SVG/animation code | Gemini 3.1 Pro | Can visually preview + generate code simultaneously |
| Video generation | Sora 2 | Only option; synced audio support |
| Sandboxed execution | Codex (GPT-5.3-Codex) | True isolated sandbox with filesystem access |
| Large context (>200K) | Gemini 3.1 Pro | ~1M window; prefer targeted injection over "dump and pray" |
| Codebase-wide analysis | Gemini (`codebase_investigator`) | Complementary to Claude's codebase-explorer |
| Offline/private | Local LLMs | When data cannot leave the machine |
| Parallel isolated threads | Claude Teams | No cross-contamination between threads |

---

## Codex Model Line Distinction

OpenAI Codex is a **specialized agentic coding line**, distinct from general GPT models:

| Task | Model |
|------|-------|
| Coding, execution, file editing, sandbox | GPT-5.3-Codex (default) or Codex-Spark (simple/fast) |
| Review, analysis, open-ended reasoning | GPT-5.2 (general_model) |

---

## Configuration Reference

All routing is controlled by `.claude/config/multi-model.toml`:

- `[models]` — enable/disable external integrations
- `[models.defaults]` — default model per task category
- `[models.effort_policy]` — effort levels per task type per provider
- `[checkpoints]` — `"ask"` | `"auto"` | `"off"` per SDLC checkpoint
- `[thresholds]` — numeric triggers for self-assessed cross-validation
- `[asset_pipeline]` — provenance tracking for AI-generated assets

**Asset output structure**: `assets/ai-gen/{date}/{model}/{filename}` with `.prompt.txt` and `.meta.json` siblings stored alongside every generated asset.
