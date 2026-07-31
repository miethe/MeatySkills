# Route — ICA Gateway Lane Mechanics

Loaded whenever the chosen provider is `ica`, **in addition to** the model's family route file.
This file covers lane mechanics shared across every model routed through the gateway — not a
model family itself. Source: `model-registry.yaml` header invariants + `ica-delegate` SKILL.md.

## The `[1m]` suffix rule

For ICA-served Claude Opus/Sonnet **and** ICA-served Gemini, **always** use the `[1m]` id — same
shared pool, same cost tier, strictly larger context window, no downside. The gateway silently
caps the plain id at 200k even for models natively 1M (Sonnet 5, Gemini 3.x). **Not** needed on
native `gemini-cli` (already 1M without a suffix) or GPT (served at its native window).
`claude-opus-4-8` on ICA is `[1m]`-only (no plain lane exists) — don't generalize that to every
Opus: `claude-opus-5` has **both** a plain lane (200k) and a `[1m]` lane (1M), so the `[1m]`-first
rule is what picks the right one there.

- ⚠️ **`[1m]` is a Claude Code CLIENT-SIDE hint, not a real gateway model id.** Raw transports
  (`/v1/messages`, `/chat/completions`) must send the **plain** id. Sending
  `claude-opus-5[1m]` to `/v1/messages` returns HTTP **403 `team_model_access_denied`** — *"team
  not allowed to access model. This team can only access models=['global-models']"*. That message
  reads like "no access to this model at all," but the real cause is the suffix: drop `[1m]` and
  the same call succeeds. Applies to every `[1m]` id on a raw transport, not just Opus 5.
- ⚠️ **Keep the `claude-` prefix.** Bare `sonnet-5[1m]` **401s** — the gateway strips `[1m]`,
  leaving the un-prefixed `sonnet-5` which is not in the `global-models` group. Always write
  `claude-sonnet-5[1m]`.
- ⚠️ **Quote it in zsh.** `[1m]` is a glob bracket; unquoted, zsh aborts with `no matches found`
  and nothing runs. Always `--model 'claude-sonnet-5[1m]'`.

## Which ICA Opus — `opus-5[1m]` first, `opus-4-8[1m]` as fallback

`claude-opus-5[1m]` is the **preferred** ICA Opus and the ICA spine-offload lane, verified
servable 2026-07-31 (raw `/chat/completions` and the `~/ica-claude.sh` executor path, unique
nonce; the executor run kept its fallback chain, so servability was confirmed the sound way — by
reading `modelUsage."claude-opus-5[1m]"` back and seeing real tokens billed against *that* id
rather than trusting a bare exit code). Thinking (both `output_config.effort` and the legacy `thinking.type:
"enabled"` form), tool use, and `output_config.format` all work on it. `maxOutputTokens` on this
lane is **64000**, below the 128K first-party ceiling — plan long outputs accordingly.
`claude-opus-4-8[1m]` stays enabled as the **fallback**: its older/lighter tokenizer can still win
for bounded high-volume fan-out on a metered pool. Both are `shared_token_pool`, not free, and
neither is a licence to move MUST-stay-primary classes off `claude/claude-opus-5` — see
`routes/anthropic-claude.md`.

## Free-4 vs shared_token_pool — the only genuinely free lane

`allowance: unlimited` (genuinely $0, cost-shifted off the primary budget) applies to **exactly
4 models**: `claude-haiku-4-5`, `gemma-4-26b-a4b-it`, `meta-llama/llama-4-maverick-...`,
`ibm/granite-4-h-small`. Every other ICA instance — Sonnet, Opus, GPT, Gemini — is
`allowance: shared_token_pool`: token-limited against ICA's shared pool, an opt-in **cost-shift**,
not free. Don't conflate "runs on ICA" with "free" — see `routes/open-models.md` for the free-4's
capability profile.

## Alias remap gotcha (Agent-tool subagents on the ICA profile)

Default `model: "haiku"` (or omitted) resolves to a dated id (`claude-haiku-4-5-20251001`) **not**
in the gateway's `global-models` group → 401. `model: "sonnet"`/`"opus"` work as-is. Durable fix:
remap the aliases once in `~/.claude/ica-settings.json` (`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`
env vars) — fixes every delegate/subagent on the profile without a proxy.

Built-in `WebSearch`/`WebFetch` are **separately broken and NOT alias-fixable** (a 400, not a
401 — these tools pin their own internal `claude-haiku-4-5` model group, which the gateway
rejects outright regardless of the calling agent's model). Route web work through
model-routing-independent CLIs instead: `firecrawl` (search/scrape), `gemini-cli` (Google
Search), or `aos-web` (SearXNG, free/model-agnostic).

## Turn caps and cost posture

ICA is free-to-us (cost-shifted off the primary budget) — `--max-budget-usd` is generally
unnecessary and **actively harmful** for live/stateful work (a cap kills mid-mutation, not
gracefully). Bound with a generous `--max-turns` (15-50 by task complexity) as a runaway
backstop, never as a cost lever. **Never** cap live infra/DB/migration/deploy work — a kill
mid-mutation leaves the target system partially mutated (2026-06-08 incident: a capped opus-4.7
redeploy was killed mid-cutover, leaving a demo box down/crash-looping).

## Fallback-masking gotcha — test with fallback OFF

`--fallback-model` silently substitutes a working model when the requested one fails — this
**masks servability failures as success**. When probing or validating a new/flaky ICA model id,
always test with `--fallback-model` unset and a unique nonce in the prompt, so a silent
substitution is detectable in the transcript rather than misread as "it worked." This exact
pattern produced the false "ICA Sonnet 5 can't reason" finding on 2026-07-09 (Opus fallback
masked it), later reversed once tested with fallback off.

## Reasoning-control-param stripping (cross-family, not Claude-specific)

Multiple ICA Azure-backed deployments (the GPT line — see `routes/openai-gpt.md`) reject the
client's reasoning-control param on some transports — `reasoning_effort` on `/chat/completions`,
`output_config` on `/messages`. Strip it (a raw client, or the `ica-gpt.sh` shim for Claude Code)
and the model completes with server-default effort.

## Structured output gap

`output_config.format` (schema-constrained JSON) is silently **dropped** by the ICA gateway on
the Claude Sonnet 5 lane — `effort` passes through, `format` does not — so you get prose, not
schema JSON. This is **lane-specific, not gateway-wide**: on `claude-opus-5[1m]` `format` **is**
honored (probed 2026-07-31, returned pure schema JSON). On any lane where you haven't confirmed
`format` passes through, use a forced **tool-call** for structured output instead.

## Do Not Say

- Do not say "all ICA models are free" — only the free-4 above; everything else is
  `shared_token_pool`.
- Do not say fallback models make probing safe — they hide failures; disable `--fallback-model`
  for any validation run.
- Do not read a 403 `team_model_access_denied` as "no access to this model" without first
  checking for a `[1m]` suffix on a raw-transport call — the suffix alone produces that error.

**Full transport mechanics:** flags, key rotation, exhaustion handling, `--bare` context
injection — `~/.claude/skills/ica-delegate/SKILL.md`.
