# ICA Gateway Model Inventory

Model reference for the IBM ICA gateway (`https://api.nextgen-beta.ica.ibm.com/ica`).
Accessed via `~/ica-claude.sh --model <identifier>`. Standard models have a 200k context ceiling. Claude models with the `[1m]` suffix (e.g. `opus[1m]`, `claude-opus-4-8[1m]`, `sonnet-4-6[1m]`) provide ~1M context — confirmed 2026-06-09 via the authoritative `modelUsage.<id>.contextWindow` field (never trust the model's self-report). The `opus[1m]` alias routes to `claude-opus-4-8[1m]`. Script default is `claude-opus-4-8[1m]`.

---

## Full Model Inventory

| Display Name | Model Identifier | Cost Tier | Notes |
|---|---|---|---|
| Claude Haiku 4.5 | `claude-haiku-4-5` | Free | Best free-tier option for Claude-quality mechanical work |
| Gemma 4 26B Preview | `gemma-4-26b-a4b-it` | Free | Google; good for simple extraction and classification |
| Llama 4 Maverick 17B Instruct | `meta-llama/llama-4-maverick-17b-128e-instruct-fp8` | Free | Meta; fast, lightweight reasoning |
| Granite 4 Small | `ibm/granite-4-h-small` | Free | IBM; smallest model, fastest response |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | Token Limited | Script default; strong general-purpose |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Token Limited | Newer Sonnet; prefer over 4.5 for new work |
| OpenAI GPT-4o | `gpt-4o` | Token Limited | OpenAI multimodal; alternative reasoning style |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | Token Limited | Google; long-context strength |
| Claude Opus 4.6 | `claude-opus-4-6` | Token Limited | Deep reasoning, architecture decisions |
| Claude Opus 4.7 | `claude-opus-4-7` | Token Limited | Stronger reasoning than 4.6 |
| Claude Opus 4.6 (1M variant) | `claude-opus-4-6[1m]` | Token Limited | 1M context variant; same format as confirmed variants — untested but expected to work |
| Claude Opus 4.7 (1M variant) | `claude-opus-4-7[1m]` | Token Limited | **Confirmed 1M** — 224k inline token test passed 2026-06-08; self-reports 200k (ignore). |
| Claude Opus 4.8 (1M variant) | `claude-opus-4-8[1m]` | Token Limited | **Confirmed 1M (2026-06-09)** — `modelUsage` reports `contextWindow: 1000000`. **Preferred 1M model + script default.** (Earlier "401" note was stale — 4.8[1m] is now live on the gateway.) |
| Opus alias (1M variant) | `opus[1m]` | Token Limited | **Confirmed 1M** — short alias; `modelUsage` shows it routes to `claude-opus-4-8[1m]`. |
| Claude Sonnet 4.6 (1M variant) | `sonnet-4-6[1m]` | Token Limited | **Confirmed 1M** — gateway accepts and routes to 1M context backend. |
| Claude Opus 4.8 | `claude-opus-4-8` | Token Limited | Latest and most capable Opus (200k variant) |
| OpenAI GPT-5.1 | `gpt-5.1-chat-gus` | Token Limited | OpenAI frontier |
| OpenAI GPT-5.4 | `gpt-5.4-gus` | Token Limited | OpenAI latest frontier |

---

## Tier Summary

| Tier | Models | Cost | Default Pick |
|---|---|---|---|
| Free | Haiku 4.5, Gemma 4, Llama 4 Maverick, Granite 4 Small | $0 (unlimited) | `claude-haiku-4-5` |
| Standard | Sonnet 4.5, Sonnet 4.6, GPT-4o, Gemini 3.1 Pro | Token-limited | `claude-sonnet-4-6` |
| Premium | Opus 4.6, Opus 4.7, Opus 4.8, GPT-5.1, GPT-5.4 | Token-limited (expensive) | `claude-opus-4-8` |
| 1M Context | Opus 4.8[1m], opus[1m] alias (→4.8[1m]), Opus 4.7[1m], Sonnet 4.6[1m], Opus 4.6[1m] | Token-limited | `claude-opus-4-8[1m]` |

---

## Selection Heuristics

| Task Characteristic | Recommended Tier | Default Model | Rationale |
|---|---|---|---|
| Boilerplate / scaffolding | Free | `claude-haiku-4-5` | Claude-quality at zero cost |
| Summarization / extraction | Free | `claude-haiku-4-5` | Haiku excels at following structured instructions |
| Simple classification / Q&A | Free | `gemma-4-26b-a4b-it` | Lightweight, fast |
| High-volume batch (>10 calls) | Free | `claude-haiku-4-5` | Zero cost per call; accept minor quality tradeoff |
| Code generation (single file) | Standard | `claude-sonnet-4-6` | Balances quality and token budget |
| Multi-file refactoring | Standard | `claude-sonnet-4-6` | Needs cross-file coherence |
| Code review / bug finding | Standard | `claude-sonnet-4-6` | Needs nuance but not max depth |
| Second opinion / alternative approach | Standard | `gpt-4o` | Different model family provides genuine diversity |
| Complex architecture decisions | Premium | `claude-opus-4-8` | Deep reasoning required |
| Novel algorithm design | Premium | `claude-opus-4-8` | Benefits from strongest reasoning |
| Context-heavy tasks (>100k input) | Standard+ | `claude-sonnet-4-6` | Free-tier quality degrades with long context |
| Very large context tasks (>200k input) | 1M Context | `claude-opus-4-8[1m]` | Standard models hard-capped at 200k; `[1m]` variants confirmed up to ~800k practical ceiling |

**Decision shortcut:** Default to Free (`claude-haiku-4-5`) for anything mechanical. Use Standard (`claude-sonnet-4-6`) for tasks requiring judgment. Escalate to Premium only when Standard output is demonstrably insufficient.

**Cross-family diversity:** When seeking a second opinion or alternative reasoning, prefer a different model family (e.g., use `gpt-4o` or `gemma-4-26b-a4b-it` if the primary session is Claude). Different training produces genuinely different perspectives.

---

## Context Budget Guidelines

| Guideline | Value |
|---|---|
| Hard ceiling | 200,000 tokens (standard models); ~1,000,000 tokens for `[1m]` variants (`opus[1m]` → `claude-opus-4-8[1m]`, `sonnet-4-6[1m]`) — confirmed 2026-06-09 via `modelUsage` |
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
| 200k context cap (standard models) | Cannot use full native context windows on standard models | Use `[1m]` variants (`opus[1m]` → `claude-opus-4-8[1m]`, `sonnet-4-6[1m]`) for up to ~800k tokens; chunk for standard models |
| Faster context consumption | Effective usable context is lower than 200k | Budget conservatively |
| Gateway latency | Higher TTFB than direct API | Expect 2-5s additional overhead per call |
| Model availability fluctuates | Some models may be temporarily unavailable | Fall back to next available in same tier |
| Non-Claude models have different tool-use support | May not support `--allowedTools` cleanly | Use single-shot for non-Claude models |
| Token budget is shared across all token-limited models | Heavy Opus use depletes budget for Sonnet too | Prefer free tier when acceptable |
| **Agent tool rejects dated model IDs** | Default subagent model (Haiku) uses `claude-haiku-4-5-20251001` which is NOT in the gateway's `global-models` group → 401 error | Always specify `model: "sonnet"` or `model: "opus"` for Agent tool subagents. Or delegate via `~/ica-claude.sh` Bash calls instead. |
| **`[1m]` models self-report 200k but actually provide ~1M context** | `claude-opus-4-8[1m]` (preferred/default), `opus[1m]` (alias → `claude-opus-4-8[1m]`), `claude-opus-4-7[1m]`, and `sonnet-4-6[1m]` are accepted by the gateway and provide ~1M context. **Verify only via the JSON `modelUsage.<id>.contextWindow` field** (`--output-format json`): `claude-opus-4-8[1m]` and `opus[1m]` both report `contextWindow: 1000000` (re-confirmed 2026-06-09). The model's *self-report* of its context window / identity is unreliable — it returned "Sonnet 4.5 / 200000" while `modelUsage` showed `claude-opus-4-8[1m]` at 1M. **NOTE:** an earlier (2026-06-08) test recorded `claude-opus-4-8[1m]` as 401; it is now live — opus-4.8's 1M variant came online since. The bracket-less dash form `claude-opus-4-8-1m` still does not route. | Default to `claude-opus-4-8[1m]` (or the `opus[1m]` alias) for tasks requiring >100k context. The bracket `[1m]` suffix on a full `claude-*` id is honored by the gateway; the script default (`~/ica-claude.sh`) is `claude-opus-4-8[1m]`. |

---

## Pending Information

- [ ] Exact rate limits (requests/min, tokens/min per tier)
- [ ] Whether vision/multimodal works through the gateway
- [ ] Tool use / function calling support for non-Claude models (GPT, Gemini)
- [ ] Streaming behavior differences from direct API
- [ ] Token counting accuracy (does gateway report match actual usage?)
- [ ] Whether `--output-format json` works reliably for all models
- [ ] Specific token budget allocation and refresh period for token-limited tier
