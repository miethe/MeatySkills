# Changelog — ica-delegate

## 2.12 — 2026-08-17 — spreading load across keys, and two stale hardcodings removed

- **New "Spreading load across keys" section.** Round-robin across the seven ICA keys uses
  per-invocation `ICA_KEY=<NAME>` — which selects a named block **without rewriting the key file** —
  never `ica-key next`, which mutates a file every concurrent ICA session on the host reads. With
  ~30 live sessions here, two legs rotating at once both skip keys and change the active key under
  third parties mid-run. Selection is a pure read of `ica-key list --json` (fresh first, then
  `partial` by ascending `usage`), so N legs spread across N keys with no shared cursor.
- **The recipe filters on `reserved_for`, not `reserved`** — the field `ica-key list --json` actually
  emits. Filtering on `reserved` matches nothing and silently returns Hermes's reserved `CC6` to the
  pool; it went wrong exactly that way while authoring, so the gotcha is documented inline.
- **Two stale hardcodings removed.** "the active key (`CC1`)" — it was `CC5` on 2026-08-17 — and the
  `CC1`…`CC6` name list, which had already missed `BB1`. Both now say to ask `ica-key current` /
  `ica-key list` instead of naming a key in prose.
- **Reservations are stated as binding**: never `--include-reserved` or `use --force` to reach a
  reserved key — two consumers on one allowance with no attribution.
- **Exhaustion handling is named as the INVOKER's duty, orchestrator included.** A delegate cannot
  rotate on its caller's behalf; its token is already resolved at process start. Also states
  explicitly that exhaustion is **not** unavailability and must never walk a `fallback_chain` — doing
  so moves free work onto a paid lane while free capacity sits one key away.


## v2.11 — 2026-08-14

### Changed — BREAKING for every caller: stop passing the dangerous flag; the grant moved to settings

- **`--dangerously-skip-permissions` is REMOVED from all 16 invocation examples and is now
  explicitly forbidden.** This skill had mandated it — *"Always include
  `--dangerously-skip-permissions`"*, plus a flag-table row reading **"Always"** and an
  anti-pattern row asserting that omitting it *"causes hangs or failures"*. That instruction is what
  broke the lane: on 2026-08-14, **4 of 4** `ica-executor` legs were refused by the Claude Code
  auto-mode permission classifier *before running*, on that flag — ~660k subagent tokens and ~20 min
  wall for zero deliverable across two of them.
- **An `allow` rule was never the fix, and had been in place the whole time.**
  `Bash(~/ica-claude.sh:*)` was already in `~/.claude/settings.json` `allow`; every leg was still
  denied. The classifier objects to the flag token in the argument list, not to the script, so the
  denial message's own suggestion ("add a Bash permission rule") was already satisfied and inert —
  an error string is printed by code but not checked by it.
- **New PREREQUISITE: `~/.claude/ica-settings.json` must carry a `permissions` block.** It had
  none, which is *why* callers reached for the flag — there was no declarative way to make a
  headless leg non-interactive. The wrapper already passes
  `--settings "$HOME/.claude/ica-settings.json"` on every call, so the grant belongs there.
  `defaultMode: acceptEdits` plus an `allow`/`deny` pair is sufficient. This is a genuine reduction
  in authority rather than the flag relocated: the flag grants everything, the block grants a named
  set and can deny `git push` / `git merge` / `git stash` / `reset --hard` / `rm -rf`.
- **Verified by two-sided probe, not inferred** — wrapper alone: allowed, rc=0; wrapper + the flag:
  denied 4/4; wrapper + a `permissions` block and no flag: allowed, rc=0, ran Bash successfully.
- The anti-pattern row is **inverted**, not deleted, so a reader who remembers the old rule sees why
  it changed. Its old claim (omitting causes hangs) held only with no `permissions` block; with one,
  an un-allowlisted call is *refused*, not prompted — it fails loudly instead of hanging.
- Headline examples now pass `< /dev/null`, since the wrapper otherwise waits 3s and warns
  `no stdin data received`.

Tracker: `node_01KZW2PT7PFNS4RKTYPYBMKEV1` (filed twice, `not_started` both times — plausibly
because `audit-log.js` cannot record a `blocked`/`permission_denied` outcome at all, so a
100%-denied lane looks identical to an unused one: `node_01M00JTM8FVBK12GF4AYQ7S2JN`).

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
