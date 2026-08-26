# Route — ICA Gateway Lane Mechanics

Loaded whenever the chosen provider is `ica`, **in addition to** the model's family route file.
This file covers lane mechanics shared across every model routed through the gateway — not a
model family itself. Source: `model-registry.yaml` header invariants + `ica-delegate` SKILL.md.

## The `[1m]` suffix is RETIRED — use bare ids (superseded 2026-08-26)

⚠️ **This section previously instructed "always use the `[1m]` id." That instruction is now
DEAD and inverted.** Measured 2026-08-26 across both ICA gateways (beta and ccx) and all 11 keys:
every `[1m]`-suffixed and dated id now returns **403 on every transport, including the Claude
Code client path** — the "works on the CC client, 403 on raw transports" split documented below
no longer holds; there is no longer a transport on which `[1m]` succeeds.

**Bare ids now carry each model's native context, at no cost.** Measured via
`usage.prompt_tokens`: bare `claude-sonnet-5` accepted **600,007** tokens on the beta gateway and
**950,007** on ccx; `gemini-3.7-flash` accepted 950,002. Bare `claude-haiku-4-5` accepted 190,008
and rejected 250,000 — that is Haiku's own real 200k model limit, not a gateway cap. **So the
standing "bare/plain ICA ids cap at 200k, always prefer `[1m]`" rule is dead on both lanes; drop
the suffix entirely and cost nothing.**

Full receipts: `agentic_meta_dev/docs/audits/ica-lane-findings-2026-08-26.md` F1/F2 and
`agentic_meta_dev/docs/agentic-operator/ICA-CCX-LANE-MATRIX.md`.

The historical mechanics below (why `[1m]` was ever a client-side hint, the prefix/quoting
gotchas) are kept for archaeology only — **do not follow them**; they describe a lane that no
longer exists.

<details>
<summary>Historical — `[1m]` mechanics while the suffix was live (superseded, do not follow)</summary>

- `[1m]` was a Claude Code CLIENT-SIDE hint, not a real gateway model id. Raw transports
  (`/v1/messages`, `/chat/completions`) required the **plain** id; sending a `[1m]` id there
  returned 403 `team_model_access_denied`.
- Bare `sonnet-5[1m]` (missing the `claude-` prefix) 401'd.
- `[1m]` is a zsh glob bracket and had to be quoted: `--model 'claude-sonnet-5[1m]'`.

None of this matters now — every `[1m]` id 403s everywhere, so there is no id form to get right
except the bare one.

</details>

## There is NO ICA Opus lane (superseded 2026-08-26)

⚠️ **This section previously named `claude-opus-5[1m]` as "the preferred ICA Opus and the ICA
spine-offload lane, verified servable 2026-07-31." That verification has been superseded by a
newer, contradicting measurement and must not be treated as current.**

Measured 2026-08-26: `claude-opus-5`, `claude-opus-4-8`, and `claude-opus-4-6` all return **403**
on **every one of the 11 ICA keys** (CC1–CC8, BB1, CCx1–CCx3), on **both** gateways — beta:
`team not allowed to access model ... models=['global-models']`; ccx: `403: Model not available -
E002`. `claude-sonnet-5` returns **200 on those same keys**, which is what makes this an
Opus-specific tenancy entitlement rather than auth, key exhaustion, or an artifact of the `[1m]`
retirement above.

**Do not route spine-offload to ICA Opus — the lane does not exist.** The ICA offload workhorse is
bare `claude-sonnet-5`. Whether this is an IBM-side revocation or transient is still open; do not
restore any `ica/claude-opus-*` row without re-probing `ica-key verify <NAME> --model
claude-opus-5` first. See `routes/anthropic-claude.md` for the primary-subscription Opus posture,
which this does not change.

Full receipts: `agentic_meta_dev/docs/audits/ica-lane-findings-2026-08-26.md` F1.

## Free-5 vs shared_token_pool — the only genuinely free lane

`allowance: unlimited` (genuinely $0, cost-shifted off the primary budget) applies to **exactly
5 models**: `claude-haiku-4-5`, `gemma-4-26b-a4b-it`, `meta-llama/llama-4-maverick-...`,
`ibm/granite-4-h-small`, `gpt-5.6-luna-dzus` (added 2026-08-26). Every other ICA instance —
Sonnet, Opus, GPT (other than Luna), Gemini — is `allowance: shared_token_pool`: token-limited
against ICA's shared pool, an opt-in **cost-shift**, not free. Don't conflate "runs on ICA" with
"free" — see `routes/open-models.md` for the free-5's capability profile.

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

## Never validate a request shape on this lane — the envelope is loosely checked

Same family of hazard as fallback-masking below: an ICA success can be lying to you. The gateway
is a **LiteLLM proxy over Bedrock** (`msg_bdrk_…` response ids; every `/v1/models` entry reports
`owned_by:"openai"`, a LiteLLM default and not a vendor claim) — and it **silently discards
unrecognized top-level request fields** where Anthropic direct returns 400.

Verified 2026-08-07 (`claude-haiku-4-5`, `/v1/messages`): an invented `ccdash_unknown_probe` and,
more dangerously, **misspelled real fields** — `max_tokenz`, `temperatur`, `tool_choise` — all
returned **200** and were ignored, so the call silently ran at defaults. **Nested** unknowns are
strict (`messages[0].bogus_nested` → 400 `Extra inputs are not permitted`), and that partial
strictness is exactly what makes the envelope laxity easy to miss.

- **ICA-green is not evidence of correctness.** Validate request bodies against Anthropic direct
  or a local schema check before shipping them to a paid lane.
- **A param that "had no effect" may never have been sent.** A typo is observationally identical
  to a genuine gateway strip — so spell-check before recording a new strip finding (genuine strips
  do exist, e.g. `output_config.format` on Sonnet 5).
- **Assert the effect, not the status code** — read `usage`, `stop_reason`, `modelUsage.<id>` back.
- **Enumerate, don't guess:** `GET /v1/models` answers "is X served?" free and instantly.
  ⚠️ **`gpt-5.6-sol` IS servable on the ccx gateway** (all three CCx keys, measured 2026-08-26) —
  the earlier "not on ICA" claim here is stale and retracted. It is still **not a usable agentic
  lane**: with tools present, `reasoning_tokens: 0` on both `/v1/chat/completions` (every
  `reasoning_effort` level) and `/v1/responses` (`low`/`high`); omitting `reasoning_effort` on
  `/chat/completions` with tools 400s. Reasoning only actually fires
  (`reasoning_tokens: 25` at effort=high) with **no tools present**. So tools and reasoning are
  mutually exclusive in practice on both transports — do not route a tool-using Sol leg expecting
  it to reason. Receipts: `agentic_meta_dev/docs/audits/ica-lane-findings-2026-08-26.md` F3.

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
schema JSON. This was previously reported as **lane-specific, not gateway-wide** (`format` honored
on `claude-opus-5[1m]`, probed 2026-07-31) — ⚠️ that comparison lane no longer exists (there is no
ICA Opus lane and no `[1m]` id at all, see above), so it cannot be re-checked or relied on. On any
lane where you haven't confirmed `format` passes through, use a forced **tool-call** for structured
output instead.

## Do Not Say

- Do not say "all ICA models are free" — only the free-5 above; everything else is
  `shared_token_pool`.
- Do not say fallback models make probing safe — they hide failures; disable `--fallback-model`
  for any validation run.
- Do not read a 403 `team_model_access_denied`/`Model not available - E002` as generically "no
  access" without checking WHICH condition produced it (superseded 2026-08-26): the `[1m]`-suffix
  cause is retired — every `[1m]` id now 403s on every transport, so the suffix is no longer a
  useful discriminator by itself. What still distinguishes a real gap is the **model family**: a
  bare `claude-opus-*` id 403s tenancy-wide (Opus entitlement revoked — see above); a bare
  `claude-sonnet-5` or bare Gemini/GPT id should succeed. A 403 on a non-Opus bare id is a genuine
  new finding, not suffix confusion.

**Full transport mechanics:** flags, key rotation, exhaustion handling, `--bare` context
injection — `~/.claude/skills/ica-delegate/SKILL.md`.
