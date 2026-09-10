# Route — ICA Gateway Lane Mechanics

Loaded whenever the chosen provider is `ica`, **in addition to** the model's family route file.
This file covers lane mechanics shared across every model routed through the gateway — not a
model family itself. Source: `model-registry.yaml` header invariants + `ica-delegate` SKILL.md.

## `[1m]` is a Claude-Code-layer convention, not a gateway model id (corrected 2026-09-10)

⚠️ **The 2026-08-26 finding below ("every `[1m]` id 403s on every transport, including the Claude
Code client path; bare ids carry native context") is RETRACTED for the Claude Code path.** It was
measured with a raw-HTTP-only instrument (`ica-key verify`, direct `/v1/messages`/
`/chat/completions` calls) and wrongly generalized to the Claude Code client, which was never
re-probed on that date. See the anti-pattern note below.

**Measured rule (Nick, 2026-09-10, via `~/ica-claude.sh --output-format json` on ccx):**

- On the **Claude Code invocation path** — `~/ica-claude.sh`, an `ica-settings*.json`-driven
  session, `leg`, or any launch script that shells out to the Claude Code binary — the `[1m]`
  suffix (e.g. `claude-sonnet-5[1m]`, `claude-opus-5[1m]`) gets the model's full 1M-token context
  window; the **bare** id on that same path gets only **200k**. Measured: `claude-sonnet-5[1m]` →
  `contextWindow: 1000000`; bare `claude-sonnet-5` → `200000`; identical split for
  `claude-opus-5[1m]` vs bare `claude-opus-5`. A 1.1MB piped file: bare → `"Prompt is too long"`,
  `[1m]` → answers.
- On a **raw-HTTP call to the gateway** (curl `/v1/messages`, `/chat/completions`, `ica-key
  verify`) — the `[1m]` suffix 403s `team_model_access_denied`, because Claude Code strips the
  suffix client-side and substitutes the model's 1M-context beta header before the request ever
  reaches the gateway; a raw caller instead sends the literal `[1m]`-suffixed string, which is not
  in the gateway's model catalog. That 403 is a fact about the raw-HTTP transport, not about the
  Claude Code lane — it does not mean `[1m]` is dead everywhere.

**Rule:** use `[1m]` for every Claude-Code-layer caller (`ica-claude.sh`, `ica-settings*.json`,
`leg`, launch scripts). Use bare ids ONLY for apps/adapters that call the gateway over HTTP
directly. Receipts: ibm-agentic-tools branch `lane-hardening/ica-envelope-0910` commit `cd40713`
(`.leg/ica-1m-measure/SUMMARY.md`), agentic_meta_dev branch `lane-hardening/ica-envelope-0910`
commit `4246d894`.

⚠️ **Anti-pattern — "the instrument decides the layer" (2026-09-10):** a claim about one layer
(Claude Code client vs. raw-HTTP gateway) made using the other layer's instrument is a
mismeasurement, not a finding. This exact error recurred on 2026-08-07, 2026-08-26, 2026-08-31,
and 2026-09-10 — each time a raw-HTTP or CLI-only probe's result was generalized to "every
transport" without re-testing the Claude Code client path specifically. Always name which
transport/layer a probe used before generalizing its result to another layer.

<details>
<summary>Historical — `[1m]` mechanics while first documented as a client-side-only hint (superseded 2026-08-26, itself now partially retracted — see above)</summary>

- `[1m]` was described as a Claude Code CLIENT-SIDE hint, not a real gateway model id. Raw
  transports (`/v1/messages`, `/chat/completions`) require the **plain** id; sending a `[1m]` id
  there returns 403 `team_model_access_denied`. This half of the claim still holds.
- Bare `sonnet-5[1m]` (missing the `claude-` prefix) 401'd.
- `[1m]` is a zsh glob bracket and must be quoted: `--model 'claude-sonnet-5[1m]'`.
- The 2026-08-26 entry then claimed this whole mechanism was retired and every `[1m]` id 403s
  everywhere including Claude Code — that generalization is what the 2026-09-10 correction above
  retracts.

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

⚠️ **(Opus-lane availability re-measured 2026-09-10:** `claude-opus-5[1m]` answers on the Claude
Code lane (`~/ica-claude.sh`, ccx), per the `[1m]`-as-Claude-Code-layer-convention correction
above. That measurement was scoped to the `[1m]`/context-window question only and does not
re-probe or overturn this section's tenancy-wide-403 finding for raw-HTTP/`ica-key verify` calls
— re-probe explicitly before treating ICA Opus as restored for spine-offload routing. See
agentic_meta_dev MODEL-ROUTING for the current row.)

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
on `claude-opus-5[1m]`, probed 2026-07-31) — ⚠️ that comparison cannot currently be re-checked: the
`[1m]` id itself is valid again on the Claude Code lane (see the correction above), but this
section's ICA-Opus-tenancy-wide-403 finding is unchanged and unre-probed for raw transports, so
whether `claude-opus-5[1m]` still honors `format` on ICA is unverified either way. On any lane
where you haven't confirmed `format` passes through, use a forced **tool-call** for structured
output instead.

## Do Not Say

- Do not say "all ICA models are free" — only the free-5 above; everything else is
  `shared_token_pool`.
- Do not say fallback models make probing safe — they hide failures; disable `--fallback-model`
  for any validation run.
- Do not read a 403 `team_model_access_denied`/`Model not available - E002` as generically "no
  access" without checking WHICH condition produced it AND which transport produced it (corrected
  2026-09-10): a `[1m]`-suffixed id 403ing on a **raw-HTTP** call (curl, `ica-key verify`) is
  expected — that transport never gets the Claude-Code-side suffix substitution, see the
  correction above — and is not evidence that `[1m]` is broken on the Claude Code lane. What still
  distinguishes a real gap is the **model family** on a matched transport: a bare `claude-opus-*`
  id 403ing tenancy-wide (Opus entitlement revoked — see above) on the *same* transport as a
  working bare `claude-sonnet-5` call is a genuine new finding; a `[1m]` id 403ing on raw-HTTP
  while the same id succeeds via Claude Code is not.
- Do not say "`[1m]` is retired" or "bare ids carry native 1M context on the Claude Code lane"
  without naming which transport was tested — the 2026-08-26 version of that claim was measured
  with a raw-HTTP-only instrument and did not hold for the Claude Code client path (retracted
  2026-09-10, see above).

**Full transport mechanics:** flags, key rotation, exhaustion handling, `--bare` context
injection — `~/.claude/skills/ica-delegate/SKILL.md`.
