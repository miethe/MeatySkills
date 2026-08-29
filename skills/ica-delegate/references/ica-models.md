# ICA Gateway Model Inventory

Model reference for the IBM ICA gateway (`https://api.nextgen-beta.ica.ibm.com/ica`, the "beta"
lane; the sibling "ccx" gateway is covered where noted below).
Accessed via `~/ica-claude.sh --model <identifier>`.

⚠️ **SUPERSEDED 2026-08-26 — read this before anything else in the file.** Everything below about
"the gateway caps the plain id at 200k, always use `[1m]`" and "`claude-opus-5[1m]` is the
preferred ICA Opus / spine-offload lane" is **retracted**, measured across both gateways (beta and
ccx) and all 11 keys:

- **The `[1m]` suffix is retired.** Every `[1m]`-suffixed and dated id now returns **403 on every
  transport, including the Claude Code client path** — there is no longer a transport on which it
  succeeds. **Use bare ids everywhere.**
- **Bare ids now carry each model's native context, for free.** Measured via
  `usage.prompt_tokens`: bare `claude-sonnet-5` accepted 600,007 tokens on beta and 950,007 on ccx;
  `gemini-3.7-flash` accepted 950,002. Bare `claude-haiku-4-5` accepted 190,008 and rejected
  250,000 — that is Haiku's own real 200k model limit, not a gateway cap. Dropping `[1m]` costs
  nothing.
- **There is no ICA Opus lane.** `claude-opus-5`, `claude-opus-4-8`, and `claude-opus-4-6` all
  return 403 on every one of the 11 keys, on both gateways — a tenancy-wide entitlement revocation,
  not auth or key exhaustion (`claude-sonnet-5` returns 200 on those same keys). Do not route
  spine-offload, or anything else, to an ICA Opus id. The offload workhorse is bare
  `claude-sonnet-5`.

The rest of this document was written while the old behavior was live and is kept as a historical
record with the sections that are now dead marked inline — **do not follow an instruction to use
`[1m]` or an ICA Opus id anywhere below.** Receipts:
`agentic_meta_dev/docs/audits/ica-lane-findings-2026-08-26.md` (F1/F2) and
`agentic_meta_dev/docs/agentic-operator/ICA-CCX-LANE-MATRIX.md`.

<details>
<summary>Historical — the original `[1m]`/Opus intro and prefix/quoting gotchas (superseded, do not follow)</summary>

The gateway **caps the plain id at 200k** — even for models that are natively 1M (Opus 5, Sonnet 5, Gemini 3.x). Models with the `[1m]` suffix (Claude Opus/Sonnet AND Gemini — e.g. `opus[1m]`, `claude-opus-5[1m]`, `claude-opus-4-8[1m]`, `claude-sonnet-5[1m]`, `gemini-3.5-flash[1m]`) provide ~1M context — confirmed via the authoritative `modelUsage.<id>.contextWindow` field (never trust the model's self-report): Claude 2026-06-09, Sonnet 5 + Gemini `[1m]` on 2026-07-08, and **Opus 5 on 2026-07-31**. Script default is `claude-opus-5[1m]`; **preferred ICA Opus is now `claude-opus-5[1m]`** (Opus 5 landed on the gateway by 2026-07-31 — it was absent on the 2026-07-24 and 2026-07-27 probes; `claude-opus-4-8[1m]` is demoted to the spine-offload **fallback**, still enabled and still usable). **Preferred Sonnet on ICA is `claude-sonnet-5[1m]`** (Sonnet 5 landed on the gateway 2026-07-08, superseding `claude-sonnet-4-6[1m]`). The `opus[1m]` short alias still routes to `claude-opus-4-8[1m]` — its target was **not** re-tested for Opus 5, so use the explicit `claude-opus-5[1m]` id.

> ⚠️ **`[1m]` ids must keep the `claude-` prefix.** The bare `sonnet-5[1m]` / `sonnet-4-6[1m]` (no prefix) **401s** on teams scoped to the `global-models` group — the gateway strips `[1m]`, is left with `sonnet-5` / `sonnet-4-6`, which is not in the group, and rejects it (observed 2026-06-10). Use `claude-sonnet-5[1m]`. Also **quote the model arg in zsh** (`--model 'claude-sonnet-5[1m]'`) — the `[1m]` glob otherwise aborts the command with `no matches found`. And **`[1m]` belongs only on the Claude Code path** — raw `/v1/messages` / `/chat/completions` calls must send the plain id or they 403 with `team_model_access_denied` (see the gotcha row in Known Limitations).

</details>

---

## What the gateway actually is — a LiteLLM proxy over Bedrock

Not the Anthropic API. Knowing this predicts most of its quirks instead of discovering them one
403 at a time. Verified 2026-08-07:

| Evidence | Observation | What it explains |
|---|---|---|
| Response ids | `msg_bdrk_01Cefyx3ZVQzLomk2j9jFs9Q` | Upstream is **Amazon Bedrock**. Model ids carry no `anthropic.`/`us.anthropic.` prefix, so the proxy normalizes them. |
| `GET /v1/models` shape | every entry `{"object":"model","owned_by":"openai"}` — including the Claude and Gemini ids | A **LiteLLM**-style proxy with an OpenAI-shaped model registry. `owned_by:"openai"` is a LiteLLM default, **not** a statement about the model's vendor. |
| `[1m]` absent from the catalog | 0 of 22 ids contain `[1m]` | `[1m]` was a **Claude Code client-side hint**, never a gateway model id. ⚠️ **Superseded 2026-08-26:** it is no longer reachable from any transport — `[1m]` ids 403 on the Claude Code path too now, not only raw transports. |
| Top-level unknown fields | accepted and dropped (see Known Limitations) | Proxy envelope parsing, not Anthropic's strict schema. |

⚠️ **Do not extrapolate a "Bedrock feature mask" without probing.** Reasoning by analogy from
Bedrock's usual gaps produced two **wrong** predictions here, both corrected by probe:

| Feature | Predicted (from Bedrock) | **Actually observed 2026-08-07** |
|---|---|---|
| Explicit prompt caching (`cache_control`) | unavailable | ✅ **Works.** Call 1: `cache_creation_input_tokens=5502`, `cache_read=0`. Call 2 (identical): `cache_creation=0`, **`cache_read=5502`**. Fully honored. |
| Models API (`GET /v1/models`) | unavailable | ✅ **Works.** Returns the full 22-model catalog. |

Caveat on the caching probe: a *first* attempt showed `cache_creation=0` at 2,409 input tokens —
that was the **minimum-cacheable-prefix threshold**, not a mask. Below the floor, caching is a
silent no-op with no error. Re-probing at 5,502 tokens is what distinguished the two. Both a
too-small prefix and an unsupported feature look identical in one call, so **always probe caching
with two identical calls above the floor and read `cache_read_input_tokens` back.**

Still genuinely unprobed here (assume nothing): Batches API, Files API, automatic (implicit)
caching, server-side web search/fetch, code execution. Probe before designing on any of them.

---

## Full Model Inventory

| Display Name | Model Identifier | Cost Tier | Notes |
|---|---|---|---|
| Claude Haiku 4.5 | `claude-haiku-4-5` | Free | Best free-tier option for Claude-quality mechanical work |
| Gemma 4 26B Preview | `gemma-4-26b-a4b-it` | Free | Google; good for simple extraction and classification |
| Llama 4 Maverick 17B Instruct | `meta-llama/llama-4-maverick-17b-128e-instruct-fp8` | Free | Meta; fast, lightweight reasoning |
| Granite 4 Small | `ibm/granite-4-h-small` | Free | IBM; smallest model, fastest response |
| OpenAI GPT-5.6 Luna | `gpt-5.6-luna-dzus` | Free | **Added to the free tier 2026-08-26.** Cheap/fast GPT-5.6-line model; see the reachability caveat below — completes reliably only via a raw CODEX-key `/chat/completions` call with `reasoning_effort` omitted, not yet via `ica-claude.sh`/Claude Code. |
| Claude Sonnet 5 | `claude-sonnet-5` | Token Limited | **Current-gen Sonnet; landed on ICA 2026-07-08. Preferred ICA workhorse and the ICA offload lane, full stop.** ⚠️ Superseded 2026-08-26: use this **bare** id — it now carries native context (950,007 prompt tokens measured on ccx, 600,007 on beta); the old "plain id caps at 200k, use `[1m]`" guidance is dead, and `[1m]` 403s. |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Token Limited | Older Sonnet; now a fallback below Sonnet 5 |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | Token Limited | Legacy; strong general-purpose |
| OpenAI GPT-4o | `gpt-4o` | Token Limited | OpenAI multimodal; alternative reasoning style |
| Gemini 3.5 Flash | `gemini-3.5-flash` | Token Limited | Google; fast cross-family lens. ⚠️ Superseded 2026-08-26: use the **bare** id — native context confirmed (`gemini-3.7-flash` measured 950,002 prompt tokens bare); `[1m]` 403s. NOT Search-grounded on the gateway. |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | Token Limited | Google; long-context strength. ⚠️ Superseded 2026-08-26: use the **bare** id (see Sonnet 5 row above); `[1m]` 403s. |
| Claude Opus 4.6 | `claude-opus-4-6` | Token Limited | ⚠️ **Superseded 2026-08-26: 403 tenancy-wide (all 11 keys, both gateways) — no ICA Opus lane exists.** Row kept for the historical "deep reasoning" note only; do not route here. |
| Claude Opus 4.7 | `claude-opus-4-7` | Token Limited | Stronger reasoning than 4.6 (historical note; not individually re-probed 2026-08-26, assume dead under the same Opus-tenancy revocation until re-verified) |
| Claude Opus 4.6 (1M variant) | `claude-opus-4-6[1m]` | Token Limited | ⚠️ Superseded 2026-08-26 — `[1m]` ids 403 everywhere now; row is dead history. |
| Claude Opus 4.7 (1M variant) | `claude-opus-4-7[1m]` | Token Limited | ⚠️ Superseded 2026-08-26 — `[1m]` ids 403 everywhere now; row is dead history. |
| Claude Opus 5 (1M variant) | `claude-opus-5[1m]` | Token Limited | ⚠️ **Superseded 2026-08-26 — RETRACTED. There is no ICA Opus lane.** The "preferred ICA Opus + spine-offload lane" claim below is a dated verification that has since been contradicted: `claude-opus-5` (with or without `[1m]`) now 403s on all 11 keys, both gateways — a tenancy-wide entitlement revocation, distinct from the `[1m]` retirement. Do not route spine-offload here; use bare `claude-sonnet-5`. Historical detail (no longer actionable): confirmed live + 1M (2026-07-31) via `modelUsage.contextWindow: 1000000`; tool use, thinking, and `output_config.format` all worked at the time; `maxOutputTokens` was 64000. |
| Claude Opus 4.8 (1M variant) | `claude-opus-4-8[1m]` | Token Limited | ⚠️ Superseded 2026-08-26 — RETRACTED. `claude-opus-4-8` 403s tenancy-wide now (both gateways, all 11 keys); the "spine-offload fallback" role is void, and `[1m]` also 403s independently. No ICA Opus lane, primary or fallback, exists. |
| Opus alias (1M variant) | `opus[1m]` | Token Limited | ⚠️ Superseded 2026-08-26 — `[1m]` 403s everywhere and every Opus id it could route to also 403s tenancy-wide. This alias is dead on ICA regardless of what it targets. |
| Claude Sonnet 5 (1M variant) | `claude-sonnet-5[1m]` | Token Limited | ⚠️ **Superseded 2026-08-26 — RETRACTED.** `[1m]` ids 403 on every transport now, including Claude Code. Use bare `claude-sonnet-5` — it carries the same (or greater) context for free; see the plain-id row above. |
| Claude Sonnet 4.6 (1M variant) | `claude-sonnet-4-6[1m]` | Token Limited | ⚠️ Superseded 2026-08-26 — `[1m]` ids 403 everywhere now; row is dead history. |
| Gemini 3.5 Flash (1M variant) | `gemini-3.5-flash[1m]` | Token Limited | ⚠️ Superseded 2026-08-26 — `[1m]` ids 403 everywhere now; use bare `gemini-3.5-flash` (or newer `gemini-3.7-flash`, see `ICA-CCX-LANE-MATRIX.md`). |
| Gemini 3.1 Pro Preview (1M variant) | `gemini-3.1-pro-preview[1m]` | Token Limited | ⚠️ Superseded 2026-08-26 — `[1m]` ids 403 everywhere now; use bare `gemini-3.1-pro-preview`. |
| Claude Opus 4.8 | `claude-opus-4-8` | Token Limited | Previous-gen Opus (200k variant); below Opus 5. ⚠️ Superseded 2026-08-26: also 403s tenancy-wide now, same as Opus 5 — see next row. |
| Claude Opus 5 | `claude-opus-5` | Token Limited | Current-gen Opus; was confirmed present on the gateway 2026-07-31. ⚠️ **Superseded 2026-08-26 — RETRACTED.** Now returns 403 on all 11 keys, both gateways (beta: `team not allowed to access model`; ccx: `403: Model not available - E002`) while `claude-sonnet-5` returns 200 on the same keys — an Opus-specific tenancy entitlement revocation. There is no ICA Opus lane, plain or `[1m]`, primary or fallback. Do not re-enable without re-probing `ica-key verify <NAME> --model claude-opus-5` first. |
| OpenAI GPT-5.5 | `gpt-5.5-gus` | Token Limited | **NEW (2026-07)** OpenAI reasoning model. Works with tools+reasoning on raw `/chat/completions`, `/responses` (effort scales), and `/messages` — but ❌ **400s via `ica-claude.sh`/Claude Code** (`Unknown parameter: 'output_config'` — Azure rejects CC's effort param). Reachable only from a raw client that omits the reasoning-control param. See the ⚠️ note below. |
| OpenAI GPT-5.1 | `gpt-5.1-chat-gus` | Token Limited | ❌ **REGRESSED — not servable** (2026-07-21): `LLM Provider NOT provided` on all keys. Superseded by `gpt-5.5-gus`. |
| OpenAI GPT-5.4 | `gpt-5.4-gus` | Token Limited | ❌ **REGRESSED — not servable** (2026-07-21): 404 / `LLM Provider NOT provided` on all keys. Superseded by `gpt-5.5-gus`. |

---

## Tier Summary

| Tier | Models | Cost | Default Pick |
|---|---|---|---|
| Free | Haiku 4.5, Gemma 4, Llama 4 Maverick, Granite 4 Small, GPT-5.6 Luna | $0 (unlimited) | `claude-haiku-4-5` |
| Standard | Sonnet 5, Sonnet 4.6, Sonnet 4.5, GPT-4o, Gemini 3.5 Flash, Gemini 3.1 Pro | Token-limited | `claude-sonnet-5` |
| Premium | ⚠️ **RETIRED 2026-08-26 — no ICA Opus lane exists** (Opus 5, 4.8, 4.7, 4.6 all 403 tenancy-wide, both gateways). Nothing routes here; escalate above ICA (primary subscription Opus) instead. | — | — |
| 1M Context | ⚠️ **RETIRED 2026-08-26 — the whole `[1m]` id family 403s on every transport now.** Native context is carried by the bare ids in the Standard tier above (see below), so this tier no longer has a distinct member set. | Token-limited | `claude-sonnet-5` |

> ⚠️ **Superseded 2026-08-26 — this blockquote's `[1m]`-first instruction is inverted, do not follow it.** `[1m]` ids now 403 on every transport, including Claude Code, so there is no lane on which the suffix works. **Use the bare/plain id everywhere** — `claude-sonnet-5`, `gemini-3.5-flash`, etc. now carry native (measured ~600k–950k token) context with no suffix needed, at no cost. Historical text, kept for context only: *"Opus/Sonnet/Gemini default to `[1m]` on ICA... always pick the `[1m]` variant on the Claude Code path — same token pool and cost tier, strictly larger context... the plain 200k IDs are fallback-only... except on raw transports, where the plain id is mandatory."* None of that holds any more.

> ⚠️ **ICA GPT models reject the client's reasoning-control param (2026-07-21).** The gateway's
> Azure-backed GPT deployments (`gpt-5.5-gus`, the `gpt-5.6-*-dzus` codex ids) 400 when the standard
> client attaches its reasoning-control param — `output_config` on the Anthropic `/messages` path
> that `ica-claude.sh`/Claude Code use, or `reasoning_effort` on `/chat/completions`. **Strip that
> param and the working models complete** (effort then defaults server-side to LiteLLM's `high`).
> Consequence: `gpt-5.5-gus` is fully usable from a raw curl/OpenAI-SDK client but **NOT via
> `ica-claude.sh`** yet (CC always sends `output_config`). `gpt-5.6-luna-dzus` completes only via a
> raw CODEX-key `/chat/completions` call with `reasoning_effort` omitted; `gpt-5.6-terra-dzus` is
> dead on every route. Do not route real delegation waves to these GPT lanes until a param-strip
> proxy or CC setting exists — the router keeps them `enabled: false`. Full probe:
> `delegation-router/scripts/probe-ica-models.sh` (servability drift-detector).

---

## Selection Heuristics

| Task Characteristic | Recommended Tier | Default Model | Rationale |
|---|---|---|---|
| Boilerplate / scaffolding | Free | `claude-haiku-4-5` | Claude-quality at zero cost |
| Summarization / extraction | Free | `claude-haiku-4-5` | Haiku excels at following structured instructions |
| Simple classification / Q&A | Free | `gemma-4-26b-a4b-it` | Lightweight, fast |
| High-volume batch (>10 calls) | Free | `claude-haiku-4-5` | Zero cost per call; accept minor quality tradeoff |
| Code generation (single file) | Standard | `claude-sonnet-5` | Balances quality and token budget; bare id now carries native context, no truncation risk |
| Multi-file refactoring | Standard | `claude-sonnet-5` | Needs cross-file coherence + headroom |
| Code review / bug finding | Standard | `claude-sonnet-5` | Needs nuance but not max depth |
| Second opinion / alternative approach | Standard | `gpt-4o` | Different model family provides genuine diversity |
| Complex architecture decisions | ⚠️ was Premium (retired) | `claude-sonnet-5`, or escalate off-ICA to primary-subscription Opus | No ICA Opus lane exists (2026-08-26) — see Full Model Inventory |
| Novel algorithm design | ⚠️ was Premium (retired) | `claude-sonnet-5`, or escalate off-ICA to primary-subscription Opus | Same — no ICA Opus lane |
| Context-heavy tasks (>100k input) | Standard | `claude-sonnet-5` | Bare id carries native context now; free-tier quality still degrades with long context |
| Very large context tasks (>200k input) | ⚠️ was "1M Context" (retired) | `claude-sonnet-5` (bare) | Bare `claude-sonnet-5` measured up to 950,007 prompt tokens on ccx / 600,007 on beta — no `[1m]` suffix needed or usable |

**Decision shortcut (superseded 2026-08-26):** Default to Free (`claude-haiku-4-5`) for anything mechanical. Use Standard (`claude-sonnet-5`, bare id) for tasks requiring judgment, including very-large-context tasks. There is no ICA Premium/Opus escalation any more — escalate off-ICA to the primary-subscription Opus when Standard output is demonstrably insufficient. Never use a `[1m]` id; it 403s on every transport now.

**Cross-family diversity:** When seeking a second opinion or alternative reasoning, prefer a different model family (e.g., use `gpt-4o` or `gemma-4-26b-a4b-it` if the primary session is Claude). Different training produces genuinely different perspectives.

---

## Context Budget Guidelines

| Guideline | Value |
|---|---|
| Hard ceiling (input) | ⚠️ **Superseded 2026-08-26.** The `[1m]`-variant figures below are dead (no `[1m]` id is reachable any more). Current measurement: bare `claude-sonnet-5` accepted 600,007 prompt tokens on beta and 950,007 on ccx; bare `gemini-3.7-flash` accepted 950,002. Bare `claude-haiku-4-5` caps at its real 200k model limit (accepted 190,008, rejected 250,000) — that is Haiku's own ceiling, not a gateway cap. Historical (dead): 200,000 tokens (plain ids); ~1,000,000 tokens for `[1m]` variants — confirmed via `modelUsage.<id>.contextWindow`: Claude Opus 4.x 2026-06-09, Sonnet 5 + Gemini 2026-07-08, `claude-opus-5[1m]` = 1,000,000 / plain `claude-opus-5` = 200,000 on 2026-07-31. |
| Hard ceiling (output) | ⚠️ **Unverifiable as of 2026-08-26** — the lane this was measured on (`claude-opus-5[1m]`/ICA Opus) no longer exists. Historical (dead): `maxOutputTokens` reported 64,000 on the ICA `claude-opus-5` lane (2026-07-31), below the 128,000 first-party ceiling. Do not assume this figure applies to `claude-sonnet-5`; re-probe before relying on an output ceiling. |
| Practical safe ceiling | ~150k tokens (standard, still applicable); the "~800k for `[1m]` variants" figure is dead — no `[1m]` id is reachable. Use the bare `claude-sonnet-5` figures in the input-ceiling row above instead. |
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
| ~~200k context cap (plain ids)~~ — RETRACTED 2026-08-26 | Was believed to cap plain ids at 200k | Bare ids now carry each model's native context for free (600k–950k measured on `claude-sonnet-5`); do not use a `[1m]` id, it 403s everywhere |
| ~~64k max output on the ICA Opus 5 lane~~ — lane retired 2026-08-26 | `maxOutputTokens` was 64000 (2026-07-31) on a lane that no longer exists (no ICA Opus) | N/A — unverifiable on `claude-sonnet-5`; re-probe before assuming an output ceiling |
| Faster context consumption | Was believed lower than the (now-retracted) 200k plain-id cap | Superseded 2026-08-26 — bare ids carry native context; budget conservatively regardless |
| Gateway latency | Higher TTFB than direct API | Expect 2-5s additional overhead per call |
| Model availability fluctuates | Some models may be temporarily unavailable | Fall back to next available in same tier |
| Non-Claude models have different tool-use support | May not support `--allowedTools` cleanly | Use single-shot for non-Claude models |
| Token budget is shared across all token-limited models | Heavy Opus use depletes budget for Sonnet too | Prefer free tier when acceptable |
| **Agent tool rejects dated model IDs** | Default subagent model (Haiku) uses `claude-haiku-4-5-20251001` which is NOT in the gateway's `global-models` group → 401 error | Always specify `model: "sonnet"` or `model: "opus"` for Agent tool subagents. Or delegate via `~/ica-claude.sh` Bash calls instead. |
| ⚠️ ~~Plain ids silently cap at 200k; `[1m]` unlocks ~1M~~ — **RETRACTED 2026-08-26, inverted** | The whole premise is now wrong. **`[1m]` ids 403 on every transport**, so there is no gateway-served id containing `[1m]` any more. **Bare ids carry native context for free**: `claude-sonnet-5` measured 600,007 prompt tokens on beta / 950,007 on ccx; `gemini-3.7-flash` 950,002 on ccx; `claude-haiku-4-5` correctly caps at its own real 200k model limit (190,008 accepted, 250,000 rejected). Historical detail (dead): the old confirmed-1M figures for `claude-opus-5[1m]`/`claude-sonnet-5[1m]`/the two Gemini `[1m]` ids via `modelUsage.<id>.contextWindow`. | **Use the bare/plain id everywhere, on every transport.** Never emit a `[1m]` id. Default Sonnet = `claude-sonnet-5`; there is no ICA Opus lane (see Full Model Inventory) to default to. |
| ⚠️ ~~`[1m]` is a Claude Code CLIENT-SIDE hint, not a gateway model id~~ — **superseded 2026-08-26** | The split this row describes (`[1m]` works on Claude Code, 403s on raw transports) no longer holds: `[1m]` ids now 403 on **every** transport, including Claude Code. Historical detail (dead): the original 403 `team_model_access_denied` observation on raw `/v1/messages`. | Do not emit `[1m]` on any transport; use the bare id. If you see a 403 on a bare, non-Opus id, that is a genuine new finding — see the Opus-entitlement row in Full Model Inventory for the one bare-id family that still legitimately 403s. |
| **Unknown TOP-LEVEL request fields are silently dropped — ICA is not a validation lane** | The proxy envelope is loosely validated; Anthropic direct 400s on the same body. Worst case is a **typo in a real field**: `temperatur: 0.9`, `max_tokenz: 5`, `tool_choise: {...}` all returned **200** and were ignored, so the call ran at defaults while looking correct (verified 2026-08-07). A parameter that "had no effect" may simply never have been sent, which is observationally identical to a genuine gateway strip. **Nested** unknowns *are* strict — `messages[0].bogus_nested` → 400 `Extra inputs are not permitted` — and that partial strictness is what makes the envelope laxity easy to miss. | Never treat an ICA 200 as proof of request-shape correctness. Validate bodies against **Anthropic direct** or a local JSON-schema check. Assert the *effect* (`usage`, `stop_reason`, `modelUsage.<id>`), not the status code. Spell-check params before reporting a feature as stripped. |
| **Response ids are Bedrock-shaped (`msg_bdrk_…`)** | The upstream is Amazon Bedrock behind a LiteLLM proxy. Harmless in itself, but any code that pattern-matches `^msg_[A-Za-z0-9]+$` on ids, or asserts an exact id shape in tests, will behave differently across ICA vs Anthropic direct. | Treat the id as an opaque string. Don't design a future surface on an assumed Bedrock feature mask — probe it (two of those assumptions were already **wrong**; see the proxy section above). |

---

## Reasoning & structured output (Claude 5 family via Claude Code + raw transports)

| Behavior | Status | Notes |
|---|---|---|
| ~~Extended thinking / tool use / `output_config.format` on `claude-opus-5[1m]`~~ | ⚠️ **UNVERIFIABLE 2026-08-26 — the lane is gone.** Was ✅ verified 2026-07-31 (thinking, tool use, and structured `format` all worked). `claude-opus-5` now 403s tenancy-wide, `[1m]` ids 403 on every transport — there is nothing left to probe on this row. Do not cite these as current capabilities. | N/A |
| Extended thinking on `claude-sonnet-5` | ✅ **Works via Claude Code** (revalidated 2026-07-20) — ⚠️ id updated 2026-08-26: use the **bare** id, `claude-sonnet-5[1m]` 403s now | CC 2.1.215 emits `thinking.type: adaptive` + `output_config.effort`; ICA Sonnet 5 reasons end-to-end. Legacy `thinking.type: enabled` now **400s** (was silently no-op'd pre-CC-fix, the basis of the stale 2026-07-09 "no reasoning" finding). `effort` scales depth: low → ~1,116 think tokens, max → 6,000 capped. Reasoning-dependent offload to `claude-sonnet-5` is fine behind a reviewer gate. |
| `output_config.format` on `claude-sonnet-5` (structured-JSON schema) | ⚠️ **Silently dropped by the gateway** (observed on Sonnet 5) | On the Sonnet 5 lane the gateway forwards `effort` but **not** `format` → you get prose, not schema-constrained JSON. Use a forced **tool-call** for structured output there. **Scope note:** the "not gateway-wide, Opus honors it" comparison above no longer applies — that lane is gone and cannot be re-checked. Probe before relying on `format` for any model. |
| Gemini (`gemini-3.5-flash`, `gemini-3.1-pro-preview`) reasoning | ⚠️ Not surfaced as thinking blocks | Reachable via both `/v1/messages` and `/chat/completions`; tool use works. ⚠️ id note 2026-08-26: use the **bare** id (no `[1m]`, it 403s). Gemini's internal reasoning is not exposed as Anthropic thinking blocks via ICA, and Google-Search grounding is native-key-only (not via ICA). |

## Enumerate what is actually served — `GET /v1/models`

The authoritative, **free**, zero-token answer to "is model X on ICA?". Use it instead of probing
candidate ids one at a time — per-id probing is how an availability question gets misdiagnosed as
an access problem (and it burns shared-pool quota).

```bash
KEY="$(grep -E '^ICA_CLAUDE_CODE_API_KEY=' ~/.dotfiles/ICA_CLAUDE | head -n1 | cut -d= -f2-)"
curl -s https://api.nextgen-beta.ica.ibm.com/ica/v1/models -H "x-api-key: $KEY" \
  | python3 -c 'import json,sys;[print(m["id"]) for m in json.load(sys.stdin)["data"]]'
```

**Snapshot 2026-08-07 — 22 ids, none containing `[1m]`** (default `CC1` key):

| Family | Served ids |
|---|---|
| Claude | `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-sonnet-5`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`, `claude-opus-5` |
| Gemini | `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.6-flash` |
| GPT | `gpt-4o`, `gpt-5.1-chat-gus`, `gpt-5.4-gus`, `gpt-5.5-gus`, `gpt-5.6-luna-dzus`, `gpt-5.6-terra-dzus` |
| Open | `ibm/granite-4-h-small`, `meta-llama/llama-4-maverick-17b-128e-instruct-fp8`, + 3 others |

Two things to read off it:

- ⚠️ **"`gpt-5.6-sol` is NOT served on ICA" is stale/scope-limited, superseded 2026-08-26.** That
  was true of the **beta** gateway's default-key snapshot above (only `-terra-dzus`/`-luna-dzus`
  listed). Measured 2026-08-26 on the **ccx** gateway (this doc's beta-only scope did not cover
  it): `gpt-5.6-sol` **is** servable on all three CCx keys. It is still not a usable agentic lane —
  tools and reasoning are mutually exclusive in practice on both `/v1/chat/completions` and
  `/v1/responses` (`reasoning_tokens: 0` with tools present at every effort level; reasoning only
  fires with no tools). Don't route a tool-using Sol leg expecting it to reason. Receipts:
  `agentic_meta_dev/docs/audits/ica-lane-findings-2026-08-26.md` F3.
- The catalog is the **transport-layer** truth. It says nothing about Claude Code alias remaps
  (`opus`, `sonnet`), which live in `ica-settings.json`. A model in this list is reachable
  on a raw transport with that exact id. ⚠️ The `[1m]` alias note is dead 2026-08-26 — `[1m]` is no
  longer reachable on any transport, including Claude Code.

⚠️ **This is the default-key view.** A named `ICA_KEY` block (`CC1`…`CC6`) may be scoped to a
different model group — re-run the probe under that block before assuming parity.

## Pending Information

- [ ] Exact rate limits (requests/min, tokens/min per tier) — **partial:** two shapes of 429 exist
      and they are distinct: `"Too many requests, please wait"` (request rate) and `"Too many
      tokens, please wait"` (token rate). Both were hit on `claude-sonnet-5` within ~2 calls on
      2026-08-07 while `claude-haiku-4-5` stayed clean, so limits are **per model group**. Shared
      pool, so an observed 429 can be someone else's consumption — never read it as your own rate.
- [ ] Whether vision/multimodal works through the gateway
- [ ] Tool use / function calling support for non-Claude models (GPT, Gemini)
- [ ] Streaming behavior differences from direct API
- [ ] Token counting accuracy (does gateway report match actual usage?)
- [ ] Whether `--output-format json` works reliably for all models
- [ ] Specific token budget allocation and refresh period for token-limited tier
- [x] **Models API** — ✅ works (`GET /v1/models`, 22 ids, 2026-08-07). See the section above.
- [x] **Explicit prompt caching** (`cache_control: ephemeral`) — ✅ honored end-to-end
      (`cache_read_input_tokens=5502` on the second identical call, 2026-08-07). *Implicit/automatic*
      caching remains unprobed.
- [ ] Batches API, Files API, server-side web search/fetch, code execution — **unprobed.** Do not
      assume present or absent; the Bedrock-analogy prediction was wrong twice already.
- [x] ~~Whether the `opus[1m]` short alias now retargets `claude-opus-5[1m]`~~ — **moot as of
      2026-08-26**: `[1m]` ids 403 on every transport and every Opus id 403s tenancy-wide, so no
      target this alias could resolve to is reachable.
