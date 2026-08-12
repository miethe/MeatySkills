# Changelog — ica-delegate

## v2.10 — 2026-08-09

### Added
- **`references/ica-platform-facts.md`** — a new reference for reasoning *about* the gateway rather
  than delegating through it. Everything in it was measured from response headers or a probe, dated,
  with unprobed items marked unknown rather than assumed.
  - **The data path has four parties, not one.** `client → Cloudflare (TLS terminates OUTSIDE IBM,
    so a reverse proxy sees plaintext) → an IBM Go gateway (only `/v1/*` exposed; LiteLLM admin
    routes 404 with Go's plain-text default) → a **FORKED** LiteLLM 1.89.4 → AWS Bedrock in **IBM's**
    account`, with **IBM Instana** tracing the whole path (`x-instana-*`, `traceparent`).
  - **The fork is load-bearing:** `x-litellm-response-cost-margin-percent` and siblings are not stock
    headers, so documented LiteLLM defaults — privacy *or* behaviour — describe something this
    deployment is not.
  - **Anthropic never sees these calls**, so its retention terms are not the operative ones; IBM's
    Bedrock configuration is. Per-provider posture table added for the Azure/WatsonX/Gemini routes
    (Azure's default abuse monitoring is the highest human-review exposure in the set).
  - Whether content is logged, which callbacks are wired, and whether guardrails are active are
    **unknown, not clean** — the admin surface that would answer it is unreachable from a client key.
    Exposure class is therefore **retention + human review + attribution, not training**.
- **`x-litellm-key-spend` is a free, zero-token cumulative spend read** — present on *every*
  response, so read it off a call you were making anyway instead of scraping the gateway meter.
  Cautions: per-key (a rotation resets it) and cumulative for the key's life, so only a delta
  attributes spend to a run.
- **Self-detection: your own session may be ICA-routed.** `ica-delegate` is framed around sending
  work *out*, which makes it easy to assume the caller is on the subscription — often it is not.
  ⚠️ **The trust boundary is inherited from the launcher, not the process tree**: a *local* subagent
  of an ICA session inherits `ANTHROPIC_BASE_URL`, so "local subagent" is not a synonym for "stays on
  this machine". Any policy or guard keyed on actor role (interactive vs delegated) is keyed on the
  wrong axis. Discovered 2026-08-09 when a guard refused its own authoring session
  (`agentic_meta_dev node_01KZKX3MW165WB21VEW2MRKDB7`).

### Changed
- `SKILL.md` — version 2.9 → 2.10, plus a pointer to the new reference from the model-inventory
  section and a row in **Key References**. No behavioural guidance changed.

## v2.7 — 2026-07-20

### Changed
- **REVERSED the v2.6 caveat: ICA Sonnet 5 reasoning WORKS via Claude Code (revalidated 2026-07-20).**
  Claude Code (2.1.215) now emits `thinking.type: adaptive` + `output_config.effort` to the gateway,
  so ICA `claude-sonnet-5[1m]` reasons end-to-end. Revalidation (raw `/ica/v1/messages`,
  `--fallback-model` **OFF**, unique nonces to dodge the LiteLLM cache): legacy `thinking.type: enabled`
  now returns **HTTP 400** (so if CC still sent legacy it would error, not no-op); adaptive produces
  real thinking blocks; `output_config.effort` scales depth (effort=low → ~1,116 think tokens, max →
  6,000 capped); CC path proven (`claude --model 'claude-sonnet-5[1m]'`, fallback off → thinking
  block, no 400). Flipped the `[1m]` model-routing 🚫 block → ✅, Recipe 6 note, and the Do-Not-Say row.
  **Reasoning-dependent offload to `claude-sonnet-5[1m]` is now allowed** behind the usual reviewer gate.
- **New gotcha documented:** `output_config.format` (structured-JSON schema) is silently **dropped** by
  the ICA gateway (effort passes through, format does not) → prose, not schema JSON. Use a forced
  **tool-call** for structured output on the ICA lane. Added a Do-Not-Say row for it.
- **Gemini** (`gemini-3.5-flash`, `gemini-3.1-pro-preview`) confirmed usable via ICA on both endpoints
  (`/v1/messages` + `/chat/completions`) and the CC `[1m]` path; reasoning is not surfaced as thinking
  blocks, and Google-Search grounding remains native-key-only (not via ICA).

## v2.6 — 2026-07-09

### Fixed
- **CRITICAL caveat: ICA Sonnet 5 has no working extended thinking via Claude Code (verified 2026-07-09).** Sonnet 5 (Claude-5 family) dropped the legacy `thinking.type: enabled` + `budget_tokens` API and only reasons via `thinking.type: adaptive` + `output_config.effort`. Claude Code (`~/ica-claude.sh`) still emits the legacy format → Sonnet 5 silently **no-ops** it (0 thinking tokens, empty thinking block, **no error**). Added a 🚫 warning to the `[1m]` model-routing section, a note in Recipe 6, and a Do-Not-Say row. Reasoning-dependent offload must route to ICA **Opus** (`claude-opus-4-8[1m]`) or ICA **Sonnet 4.6** (`claude-sonnet-4-6[1m]`, Claude-4 family, legacy thinking still honored). Non-reasoning bounded waves still use `claude-sonnet-5[1m]`.
- Validation: raw ICA API with `adaptive`+`effort=high` on a hard puzzle = 2,775 thinking tokens (model reasons fine); Sonnet 4.6 with legacy `budget_tokens` = 115 thinking tokens (works); Claude Code + Sonnet 5 = empty thinking block. Root cause is the Claude-Code→gateway thinking-param gap, not the model.

## v2.2.0 — 2026-06-09

### Changed
- **Opus 4.8 is now the canonical `[1m]` model.** Script `~/ica-claude.sh` default changed `claude-opus-4-7[1m]` → `claude-opus-4-8[1m]` (verified routing via `modelUsage`: `contextWindow: 1000000`). Fallback chain updated to `claude-opus-4-8,claude-opus-4-7[1m],claude-opus-4-7,claude-haiku-4-5`.
- SKILL.md / SPEC.md / `references/ica-models.md`: all default `[1m]` examples now use `claude-opus-4-8[1m]`; documented that the `opus[1m]` alias routes to `claude-opus-4-8[1m]`.

### Fixed
- **CRITICAL (stale claim):** `references/ica-models.md` previously stated `claude-opus-4-8[1m]` returns 401. It is now **live and confirmed at 1M** (opus-4.8's 1M variant came online since the 2026-06-08 test). Corrected.
- Hardened verification guidance: confirm context window via the JSON `modelUsage.<id>.contextWindow` field, **never** the model's self-report (Opus 4.8 self-reported "Sonnet 4.5 / 200k" while actually routed to a 1M backend).

## v2.1.0 — 2026-06-07

### Added
- New section **"Live/Stateful Delegations — Caps Can Be Destructive"**: caps (`--max-budget-usd` / tight `--max-turns`) hard-kill a delegate mid-action; safe for read-only/idempotent work, dangerous for live infra/DB/deploy/migration where a mid-mutation kill leaves the system partial/broken.
- Documented the 2026-06-08 incident: a live EC2 enterprise redeploy delegated with `--max-budget-usd 12` was killed mid-cutover (after `compose down` + rebuild, before bring-up), leaving the demo box DOWN.
- Five rules for live/stateful delegations: omit cost caps, self-restoring prompt rails, mandatory `--bare` inside large-CLAUDE.md repos (avoids `Prompt is too long`), `--fallback-model` + retry on transient socket drops, and read-only verify → mutate → verify sequencing.
- Routing-table row for "Live infra / DB / deploy (mutating)".

### Changed
- New section **"Cost: the ICA gateway is free-to-us"** under Routing Posture: ICA calls are cost-shifted and do not bill the primary budget, so `--max-budget-usd` is unnecessary by default — prefer allowing more/deeper work (especially opus-driven); bound runaways with a generous `--max-turns`, never a dollar cap.
- Removed `--max-budget-usd 5` from the "Complex reasoning subtask" routing row.
- Recipe 6 renamed "Guarded Premium (Budget-Capped)" → "Deep Opus Reasoning (no cost cap)"; dropped the dollar cap, added `--bare`/`--fallback-model`/`--effort high`.

### Fixed
- **CRITICAL**: Corrected false claim that `--max-turns` flag doesn't exist. It does — limits agentic turns in print mode.
- Updated all documentation to reflect `--max-turns` as a valid scope control mechanism.

### Added
- New flags documented: `--max-turns`, `--bare`, `--tools`, `--json-schema`, `--effort`, `--continue`/`--resume`, `--no-session-persistence`, `--fallback-model`, `--bg`, `--exclude-dynamic-system-prompt-sections`
- Tool scoping clarification: `--tools` (availability) vs `--allowedTools` (auto-approve) vs `--disallowedTools` (block)
- Session continuity patterns via `--continue`/`--resume` for multi-call workflows
- Recipe 7: Session-Continuity Workflow
- Recipe 8: Bare Mode Fan-Out (optimized for scripted work)
- Recipe 9: Schema-Validated Structured Output (`--json-schema`)
- Backlog items BL-5 (effort-level routing) and BL-6 (background agent orchestration)

### Changed
- Invariant #5: "Stateless" → "Stateless by default, continuity opt-in"
- Invariant #7: Expanded tool scoping to distinguish three mechanisms
- Invariant #8: Rewritten from "no turn limiter" to document `--max-turns` behavior
- Routing table entries now include `--max-turns` recommendations
- Version bumped to 2.0.0 across all files

## v1.0 — 2026-06-07

- Initial skill implementation
- SKILL.md with routing table, invocation templates, context budget discipline
- SPEC.md capability contract (6 intents, 6 invariants)
- Model reference file with tier-based selection heuristics
- Modeled after bob-shell-delegate conventions
