# Route — ICA Gateway Lane Mechanics

Loaded whenever the chosen provider is `ica`, **in addition to** the model's family route file.
This file covers lane mechanics shared across every model routed through the gateway — not a
model family itself. Source: `model-registry.yaml` header invariants + `ica-delegate` SKILL.md.

## The `[1m]` suffix rule

For ICA-served Claude Opus/Sonnet **and** ICA-served Gemini, **always** use the `[1m]` id — same
shared pool, same cost tier, strictly larger context window, no downside. The gateway silently
caps the plain id at 200k even for models natively 1M (Sonnet 5, Gemini 3.x). **Not** needed on
native `gemini-cli` (already 1M without a suffix) or GPT (served at its native window).
`claude-opus-4-8` on ICA is `[1m]`-only (no plain lane exists).

- ⚠️ **Keep the `claude-` prefix.** Bare `sonnet-5[1m]` **401s** — the gateway strips `[1m]`,
  leaving the un-prefixed `sonnet-5` which is not in the `global-models` group. Always write
  `claude-sonnet-5[1m]`.
- ⚠️ **Quote it in zsh.** `[1m]` is a glob bracket; unquoted, zsh aborts with `no matches found`
  and nothing runs. Always `--model 'claude-sonnet-5[1m]'`.

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
schema JSON. Use a forced **tool-call** for structured output on any ICA lane; never rely on
`output_config.format` there.

## Do Not Say

- Do not say "all ICA models are free" — only the free-4 above; everything else is
  `shared_token_pool`.
- Do not say fallback models make probing safe — they hide failures; disable `--fallback-model`
  for any validation run.

**Full transport mechanics:** flags, key rotation, exhaustion handling, `--bare` context
injection — `~/.claude/skills/ica-delegate/SKILL.md`.
