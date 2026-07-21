# ICA Gateway Model Inventory

Model reference for the IBM ICA gateway (`https://api.nextgen-beta.ica.ibm.com/ica`).
Accessed via `~/ica-claude.sh --model <identifier>`. The gateway **caps the plain id at 200k** — even for models that are natively 1M (Sonnet 5, Gemini 3.x). Models with the `[1m]` suffix (Claude Opus/Sonnet AND Gemini — e.g. `opus[1m]`, `claude-opus-4-8[1m]`, `claude-sonnet-5[1m]`, `gemini-3.5-flash[1m]`) provide ~1M context — confirmed via the authoritative `modelUsage.<id>.contextWindow` field (never trust the model's self-report): Claude 2026-06-09, and Sonnet 5 + Gemini `[1m]` on 2026-07-08. The `opus[1m]` alias routes to `claude-opus-4-8[1m]`. Script default is `claude-opus-4-8[1m]`; **preferred Sonnet on ICA is now `claude-sonnet-5[1m]`** (Sonnet 5 landed on the gateway 2026-07-08, superseding `claude-sonnet-4-6[1m]`).

> ⚠️ **`[1m]` ids must keep the `claude-` prefix.** The bare `sonnet-5[1m]` / `sonnet-4-6[1m]` (no prefix) **401s** on teams scoped to the `global-models` group — the gateway strips `[1m]`, is left with `sonnet-5` / `sonnet-4-6`, which is not in the group, and rejects it (observed 2026-06-10). Use `claude-sonnet-5[1m]`. Also **quote the model arg in zsh** (`--model 'claude-sonnet-5[1m]'`) — the `[1m]` glob otherwise aborts the command with `no matches found`.

---

## Full Model Inventory

| Display Name | Model Identifier | Cost Tier | Notes |
|---|---|---|---|
| Claude Haiku 4.5 | `claude-haiku-4-5` | Free | Best free-tier option for Claude-quality mechanical work |
| Gemma 4 26B Preview | `gemma-4-26b-a4b-it` | Free | Google; good for simple extraction and classification |
| Llama 4 Maverick 17B Instruct | `meta-llama/llama-4-maverick-17b-128e-instruct-fp8` | Free | Meta; fast, lightweight reasoning |
| Granite 4 Small | `ibm/granite-4-h-small` | Free | IBM; smallest model, fastest response |
| Claude Sonnet 5 | `claude-sonnet-5` | Token Limited | **Current-gen Sonnet; landed on ICA 2026-07-08.** Preferred ICA workhorse — use the `[1m]` variant. Plain id caps at 200k. |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Token Limited | Older Sonnet; now a fallback below Sonnet 5 |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | Token Limited | Legacy; strong general-purpose |
| OpenAI GPT-4o | `gpt-4o` | Token Limited | OpenAI multimodal; alternative reasoning style |
| Gemini 3.5 Flash | `gemini-3.5-flash` | Token Limited | Google; fast cross-family lens. Plain id caps at 200k — use `[1m]`. NOT Search-grounded on the gateway. |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | Token Limited | Google; long-context strength. Plain id caps at 200k — use `[1m]`. |
| Claude Opus 4.6 | `claude-opus-4-6` | Token Limited | Deep reasoning, architecture decisions |
| Claude Opus 4.7 | `claude-opus-4-7` | Token Limited | Stronger reasoning than 4.6 |
| Claude Opus 4.6 (1M variant) | `claude-opus-4-6[1m]` | Token Limited | 1M context variant; same format as confirmed variants — untested but expected to work |
| Claude Opus 4.7 (1M variant) | `claude-opus-4-7[1m]` | Token Limited | **Confirmed 1M** — 224k inline token test passed 2026-06-08; self-reports 200k (ignore). |
| Claude Opus 4.8 (1M variant) | `claude-opus-4-8[1m]` | Token Limited | **Confirmed 1M (2026-06-09)** — `modelUsage` reports `contextWindow: 1000000`. **Preferred 1M model + script default.** (Earlier "401" note was stale — 4.8[1m] is now live on the gateway.) |
| Opus alias (1M variant) | `opus[1m]` | Token Limited | **Confirmed 1M** — short alias; `modelUsage` shows it routes to `claude-opus-4-8[1m]`. |
| Claude Sonnet 5 (1M variant) | `claude-sonnet-5[1m]` | Token Limited | **Confirmed 1M (2026-07-08)** — `modelUsage` reports `contextWindow: 1000000` (plain `claude-sonnet-5` = 200000). **Preferred Sonnet on ICA.** MUST keep the `claude-` prefix. |
| Claude Sonnet 4.6 (1M variant) | `claude-sonnet-4-6[1m]` | Token Limited | **Confirmed working 2026-06-10** (returns output normally); older fallback below `claude-sonnet-5[1m]`. MUST keep the `claude-` prefix — the bare `sonnet-4-6[1m]` **401s** on `global-models`-scoped teams. |
| Gemini 3.5 Flash (1M variant) | `gemini-3.5-flash[1m]` | Token Limited | **Confirmed 1M (2026-07-08)** — `modelUsage` reports `1000000` (plain = 200000). The ICA `[1m]` rule applies to Gemini too. Not Search-grounded on the gateway. |
| Gemini 3.1 Pro Preview (1M variant) | `gemini-3.1-pro-preview[1m]` | Token Limited | **Confirmed 1M (2026-07-08)** — `modelUsage` reports `1000000` (plain = 200000). |
| Claude Opus 4.8 | `claude-opus-4-8` | Token Limited | Latest and most capable Opus (200k variant) |
| OpenAI GPT-5.1 | `gpt-5.1-chat-gus` | Token Limited | OpenAI frontier |
| OpenAI GPT-5.4 | `gpt-5.4-gus` | Token Limited | OpenAI latest frontier |

---

## Tier Summary

| Tier | Models | Cost | Default Pick |
|---|---|---|---|
| Free | Haiku 4.5, Gemma 4, Llama 4 Maverick, Granite 4 Small | $0 (unlimited) | `claude-haiku-4-5` |
| Standard | Sonnet 5, Sonnet 4.6, Sonnet 4.5, GPT-4o, Gemini 3.5 Flash, Gemini 3.1 Pro | Token-limited | `claude-sonnet-5[1m]` |
| Premium | Opus 4.6, Opus 4.7, Opus 4.8, GPT-5.1, GPT-5.4 | Token-limited (expensive) | `claude-opus-4-8[1m]` |
| 1M Context | Sonnet 5[1m], Opus 4.8[1m], opus[1m] alias (→4.8[1m]), Opus 4.7[1m], Sonnet 4.6[1m], Opus 4.6[1m], Gemini 3.5 Flash[1m], Gemini 3.1 Pro[1m] | Token-limited | `claude-sonnet-5[1m]` (Opus for hardest) |

> **Opus/Sonnet/Gemini default to `[1m]` on ICA.** For ICA Claude Opus/Sonnet **and** ICA Gemini, always pick the `[1m]` variant — same token pool and cost tier, strictly larger context. The plain 200k IDs (`claude-sonnet-5`, `claude-opus-4-8`, `gemini-3.5-flash`) are fallback-only on the ICA path. This is why the Standard/Premium default picks above are the `[1m]` forms. (Native gemini-cli needs no suffix — it's 1M by default.)

---

## Selection Heuristics

| Task Characteristic | Recommended Tier | Default Model | Rationale |
|---|---|---|---|
| Boilerplate / scaffolding | Free | `claude-haiku-4-5` | Claude-quality at zero cost |
| Summarization / extraction | Free | `claude-haiku-4-5` | Haiku excels at following structured instructions |
| Simple classification / Q&A | Free | `gemma-4-26b-a4b-it` | Lightweight, fast |
| High-volume batch (>10 calls) | Free | `claude-haiku-4-5` | Zero cost per call; accept minor quality tradeoff |
| Code generation (single file) | Standard | `claude-sonnet-5[1m]` | Balances quality and token budget; 1m = no truncation risk |
| Multi-file refactoring | Standard | `claude-sonnet-5[1m]` | Needs cross-file coherence + headroom |
| Code review / bug finding | Standard | `claude-sonnet-5[1m]` | Needs nuance but not max depth |
| Second opinion / alternative approach | Standard | `gpt-4o` | Different model family provides genuine diversity |
| Complex architecture decisions | Premium | `claude-opus-4-8[1m]` | Deep reasoning required |
| Novel algorithm design | Premium | `claude-opus-4-8[1m]` | Benefits from strongest reasoning |
| Context-heavy tasks (>100k input) | Standard+ | `claude-sonnet-5[1m]` | Free-tier quality degrades with long context |
| Very large context tasks (>200k input) | 1M Context | `claude-opus-4-8[1m]` | Standard models hard-capped at 200k; `[1m]` variants confirmed up to ~800k practical ceiling |

**Decision shortcut:** Default to Free (`claude-haiku-4-5`) for anything mechanical. Use Standard (`claude-sonnet-5[1m]`) for tasks requiring judgment. Escalate to Premium (`claude-opus-4-8[1m]`) only when Standard output is demonstrably insufficient. For Opus/Sonnet/Gemini always take the `[1m]` form on ICA — never the plain 200k ID except as a fallback.

**Cross-family diversity:** When seeking a second opinion or alternative reasoning, prefer a different model family (e.g., use `gpt-4o` or `gemma-4-26b-a4b-it` if the primary session is Claude). Different training produces genuinely different perspectives.

---

## Context Budget Guidelines

| Guideline | Value |
|---|---|
| Hard ceiling | 200,000 tokens (standard models); ~1,000,000 tokens for `[1m]` variants (`opus[1m]` → `claude-opus-4-8[1m]`, `claude-sonnet-4-6[1m]`) — confirmed 2026-06-09 via `modelUsage` |
| Practical safe ceiling | ~150k tokens (standard); ~800k tokens for `[1m]` variants |
| Observed consumption rate | ~1.2-1.5x direct API (gateway overhead) |
| Recommended prompt budget | Keep input under ~50k for free tier; ~100k for standard/premium |
| Tool-use overhead per round | ~1-3k tokens of framing per tool call/response |

**Implications:**
- A task that fits in 180k on direct Anthropic API may exhaust context at ~130-140k effective input on ICA.
- Chunk large contexts rather than sending monolithic prompts.
- Prefer explicit extraction over "read everything and answer" patterns.
- Monitor for truncation — the gateway may silently clip rather than error.
- Free-tier models (especially Gemma, Granite) degrade faster with long context than Claude models.

---

## Known Limitations

| Limitation | Impact | Workaround |
|---|---|---|
| 200k context cap (standard models) | Cannot use full native context windows on standard models | Use `[1m]` variants (`opus[1m]` → `claude-opus-4-8[1m]`, `claude-sonnet-4-6[1m]`) for up to ~800k tokens; chunk for standard models |
| Faster context consumption | Effective usable context is lower than 200k | Budget conservatively |
| Gateway latency | Higher TTFB than direct API | Expect 2-5s additional overhead per call |
| Model availability fluctuates | Some models may be temporarily unavailable | Fall back to next available in same tier |
| Non-Claude models have different tool-use support | May not support `--allowedTools` cleanly | Use single-shot for non-Claude models |
| Token budget is shared across all token-limited models | Heavy Opus use depletes budget for Sonnet too | Prefer free tier when acceptable |
| **Agent tool rejects dated model IDs** | Default subagent model (Haiku) uses `claude-haiku-4-5-20251001` which is NOT in the gateway's `global-models` group → 401 error | Always specify `model: "sonnet"` or `model: "opus"` for Agent tool subagents. Or delegate via `~/ica-claude.sh` Bash calls instead. |
| **Plain ids silently cap at 200k; `[1m]` unlocks ~1M — and this now covers Gemini** | `claude-opus-4-8[1m]` (preferred Opus/default), `opus[1m]` (alias), `claude-opus-4-7[1m]`, `claude-sonnet-5[1m]` (preferred Sonnet), `claude-sonnet-4-6[1m]` (older fallback), **`gemini-3.5-flash[1m]`, and `gemini-3.1-pro-preview[1m]`** are accepted by the gateway and provide ~1M context. **Verify only via the JSON `modelUsage.<id>.contextWindow` field** (`--output-format json`). Confirmed 2026-07-08: `claude-sonnet-5[1m]`=1M / plain `claude-sonnet-5`=200k; `gemini-3.5-flash[1m]`=1M / plain=200k; `gemini-3.1-pro-preview[1m]`=1M / plain=200k (Claude Opus re-confirmed 2026-06-09). The model's *self-report* of its window/identity is unreliable. The bracket-less dash form (`...-1m`) does not route. **The `[1m]` rule is ICA-gateway-specific for Gemini — native gemini-cli is 1M without a suffix.** | On ICA, use `[1m]` for Claude Opus/Sonnet **and** Gemini. Default Sonnet = `claude-sonnet-5[1m]`; default Opus = `claude-opus-4-8[1m]` (script default). |

---

## Reasoning & structured output (Claude 5 family via Claude Code)

| Behavior | Status | Notes |
|---|---|---|
| Extended thinking on `claude-sonnet-5[1m]` | ✅ **Works via Claude Code** (revalidated 2026-07-20) | CC 2.1.215 emits `thinking.type: adaptive` + `output_config.effort`; ICA Sonnet 5 reasons end-to-end. Legacy `thinking.type: enabled` now **400s** (was silently no-op'd pre-CC-fix, the basis of the stale 2026-07-09 "no reasoning" finding). `effort` scales depth: low → ~1,116 think tokens, max → 6,000 capped. Reasoning-dependent offload to `claude-sonnet-5[1m]` is fine behind a reviewer gate. |
| `output_config.format` (structured-JSON schema) | ⚠️ **Silently dropped by the gateway** | The ICA gateway forwards `effort` but **not** `format` → you get prose, not schema-constrained JSON. Use a forced **tool-call** for structured output on the ICA lane. |
| Gemini (`gemini-3.5-flash`, `gemini-3.1-pro-preview`) reasoning | ⚠️ Not surfaced as thinking blocks | Reachable via both `/v1/messages` and `/chat/completions` + the CC `[1m]` path; tool use works. Gemini's internal reasoning is not exposed as Anthropic thinking blocks via ICA, and Google-Search grounding is native-key-only (not via ICA). |

## Pending Information

- [ ] Exact rate limits (requests/min, tokens/min per tier)
- [ ] Whether vision/multimodal works through the gateway
- [ ] Tool use / function calling support for non-Claude models (GPT, Gemini)
- [ ] Streaming behavior differences from direct API
- [ ] Token counting accuracy (does gateway report match actual usage?)
- [ ] Whether `--output-format json` works reliably for all models
- [ ] Specific token budget allocation and refresh period for token-limited tier
