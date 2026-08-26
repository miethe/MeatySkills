# Route — Anthropic Claude

Loaded only when the routed model is a Claude family member. Source: `model-registry.yaml`
`models:` block (fields verified against the registry, updated 2026-07-31 — ICA Opus 5 lane
verified live on that date). ⚠️ **Superseded 2026-08-26: the ICA Opus 5 lane verified live on
2026-07-31 has since been revoked tenancy-wide, and `[1m]` ids are separately retired — see the
per-model sections below.**

## claude-opus-5

- **When to pick:** the AOS SPINE / MUST-stay tier — orchestration, verdict/adjudication, final
  synthesis, architecture, mode-d, schema-recovery, cross-wave merge, deep-reasoning,
  novel-algorithm-design. Current flagship as of 2026-07-24, supersedes claude-opus-4-8.
- **Invocation lane:** `claude/claude-opus-5` (primary, billed, $5/$25 per M). ⚠️ **ICA offload
  RETRACTED 2026-08-26 — there is no ICA Opus lane.** `claude-opus-5` (with or without the
  now-also-dead `[1m]` suffix) 403s on all 11 ICA keys, both gateways — a tenancy-wide entitlement
  revocation (`claude-sonnet-5` returns 200 on those same keys). The paragraph below describes the
  2026-07-31 verification that this supersedes; it is kept for history, not as current guidance.
  MUST-stay-primary classes (`orchestration`, `mode_d`) route to `claude/claude-opus-5` regardless
  — that was never contingent on ICA availability.

  <details>
  <summary>Historical (superseded 2026-08-26) — the 2026-07-31 "ICA spine-offload lane" verification</summary>

  `ica/claude-opus-5[1m]` was **enabled** (priority 2) and was **the** ICA spine-offload lane —
  verified servable 2026-07-31 (raw `/chat/completions` + the `~/ica-claude.sh` Claude Code
  executor path, both with a unique nonce). `allowance: shared_token_pool` — token-limited,
  **NOT free**. 1M context on the `[1m]` id (plain `claude-opus-5` caps at 200k), but
  `maxOutputTokens` was **64000** on the ICA lane vs the 128K first-party ceiling. `ica/claude-opus-4-8[1m]`
  was the offload *fallback*. None of this is reachable any more.
  </details>
- **Effort/context:** 1M context, 128K max output, adaptive thinking; effort defaults to `high`
  on the Claude API/Claude Code — set explicitly to change. New tokenizer (~30% more tokens than
  Opus 4.8/Sonnet 4.6 for the same text — same family as Sonnet 5+).
- **Gotchas:** knowledge cutoff May 2026; trails Fable 5 on taste/quality but surpasses Opus 4.8
  (>2x Opus 4.8's agentic performance at the same price point per Anthropic).
- **ICA lane capabilities** — ⚠️ **UNVERIFIABLE as of 2026-08-26; the lane is gone.** The
  2026-07-31 probe (adaptive thinking via `output_config.effort` working, legacy
  `thinking.type: "enabled"` also working — a divergence from Sonnet 5, where the legacy form
  400s; tool use working both via Claude Code and raw `/v1/messages`; `output_config.format`
  honored) cannot be re-checked or relied on now that `claude-opus-5` 403s tenancy-wide on ICA.
- **Anti-patterns:** don't use for mechanical/bulk fan-out — route that to Haiku or a free ICA
  lane instead. Don't route MUST-stay classes (`orchestration`, `mode_d`) to the ICA lane just
  because it exists.

## claude-fable-5

- **When to pick:** EXPLICIT OPT-IN ONLY — never auto-routed, not in `must_stay_primary`, not in
  any `routing_policy` chain. Reach for it via a direct plan/frontmatter model assignment for:
  pre-commitment planning & architecture (PRDs, impl plans, ExecutionGraph design), greenfield/
  net-new jumpstarts, long-horizon autonomous sprints (Tier 3 only), escalated debugging after
  Opus has failed 1-2 cycles, high-stakes verdict gates. Grounded 2026-07-28, conf 0.6: ranked
  #1 for `svg_generation` on Design Arena's SVG Arena (69% win rate, Elo 1353, human-voted) — the
  strongest current evidence for a taste-critical SVG choice; see `use-case-rankings.yaml`.
- **Invocation lane:** `claude/claude-fable-5` only — no ICA lane exists for this model.
- **Effort/context:** 1M context, 128K max output, Mythos-class frontier (SWE-bench Verified 95%).
- **Gotchas:** $10/$50 per M = 2x Opus 4.8/5 cost. Lead over Opus **grows** with task length/
  complexity and is ≈0 on short/routine work — the premium only pays on high-leverage,
  path-dependent, or genuinely hard tasks.
- **Anti-patterns:** routine implementation, high-volume mechanical work, latency-sensitive
  interactive loops, or anything run dozens of times where the 2x premium compounds. Not
  evidenced or cost-appropriate as a default second-opinion/critique leg.

## claude-sonnet-5

- **When to pick:** the DEFAULT subscription implementation/workhorse tier — agentic coding,
  code review, multi-file refactoring, planning, exploration, extended-thinking/deep-reasoning.
- **Invocation lanes:** `claude/claude-sonnet-5` (primary, billed, $3/$15 per M, intro $2/$10
  through 2026-08-31). ICA offload: `ica/claude-sonnet-5` — ⚠️ **id form superseded 2026-08-26: use
  the bare id**, `[1m]` 403s on every transport now (bare id carries native context — measured up
  to 950,007 prompt tokens on ccx / 600,007 on beta). Still the current-gen free-offload lane since
  2026-07-08, superseding sonnet-4-6.
- **Effort/context:** 1M context, 128K output, adaptive thinking on by default; first Sonnet with
  `xhigh` effort.
- **Gotchas:** new tokenizer emits ~30% more tokens than 4.6 for the same text → effective
  metered cost ~$3.90/$19.50-equivalent at full price. On the ICA shared-pool lane (or any metered
  lane), prefer `claude-sonnet-4-6` (bare) or `claude-haiku-4-5` for BOUNDED/MECHANICAL high-volume
  fan-out — reserve `claude-sonnet-5` (bare) offload for capability-sensitive bounded waves. ICA
  reasoning **works** via Claude Code (revalidated 2026-07-20: adaptive thinking + `output_config.effort`
  honored end-to-end) — reasoning-dependent offload is fine. One remaining gap:
  `output_config.format` (structured JSON) is silently dropped by the ICA gateway → prose, not
  schema JSON; force a tool-call for structured output on that lane instead. ⚠️ This is also now the
  Premium/hardest-reasoning ICA pick — there is no ICA Opus lane (see `claude-opus-5` above).
- **Anti-patterns:** don't expect schema-constrained JSON via `output_config.format` on the ICA
  lane.

## claude-sonnet-4-6

- **When to pick:** previous-gen Sonnet; implementation/planning/code-review/exploration/
  multi-file-refactoring when token-efficiency beats raw capability (bounded/mechanical
  high-volume fan-out on metered/ICA lanes).
- **Invocation lanes:** `claude/claude-sonnet-4-6` (billed, standard), `ica/claude-sonnet-4-6`
  (older token-efficient offload, shared_token_pool — the demoted-but-still-useful ICA lane).
  ⚠️ Superseded 2026-08-26: the old "`[1m]` = full context, plain avoid — caps at 200k" split is
  dead — `[1m]` 403s everywhere now, and the bare id above carries native context.
- **Gotchas:** superseded as the default ICA offload by `sonnet-5` (bare) since 2026-07-08; keep
  only as the older/cheaper-token fallback lane, not the default.
- **Anti-patterns:** don't use as the default subscription workhorse — `sonnet-5` is now default.

## claude-haiku-4-5

- **When to pick:** mechanical-tasks, doc-gen, exploration, cheap adversarial-review leg — fast,
  cheap, the best genuinely-free ICA Claude-quality option.
- **Invocation lanes:** `ica/claude-haiku-4-5` (FREE, `allowance: unlimited`, priority 1),
  `claude/claude-haiku-4-5` (billed fallback, priority 2).
- **Gotchas:** Agent-tool subagents on the ICA profile with `model: haiku` (or omitted) 401 — the
  default resolves to a dated id not in `global-models`. Fix via the `ica-settings.json`
  `ANTHROPIC_DEFAULT_HAIKU_MODEL` alias remap (see `routes/ica-lanes.md`).
- **Anti-patterns:** don't use for taste-critical or adversarial-review-of-Claude-output roles
  needing real critique depth — grounded 2026-07-28: ranked #14/30 for `second_opinion` ("keep
  only as a cheap last-resort fallback, not a real adversarial lens" — small model, same family
  as the primary author, weak blind-spot detection).

*(Legacy tiers below — brief entries, one heading each so registry `playbook_ref` anchors resolve.)*

## claude-opus-4-8

LEGACY as of 2026-07-24 (superseded by opus-5 as spine), same $5/$25 per M pricing. ⚠️ **Its ICA
lane is RETRACTED 2026-08-26** — `claude-opus-4-8` (plain or `[1m]`) 403s tenancy-wide on all 11
ICA keys, both gateways, alongside every other ICA Opus id. Was previously `enabled` as the
spine-offload fallback behind `ica/claude-opus-5[1m]`; neither exists any more. Still genuinely
useful on the **primary subscription**: 4.8 has the older/lighter tokenizer, which can win for
bounded high-volume fan-out — that has nothing to do with ICA.

## claude-opus-4-7

⚠️ **ICA lane RETRACTED 2026-08-26** — same tenancy-wide Opus revocation as `claude-opus-4-8`
above (not individually re-probed, but there is no reason to expect it survived when 4-6/4-8/5 all
403). Deep-reasoning/architecture/planning fallback tier below opus-4-8 on the **primary
subscription** only.

## claude-opus-4-6

⚠️ **ICA lane RETRACTED 2026-08-26** — `claude-opus-4-6` 403s tenancy-wide on ICA, confirmed
directly (one of the three Opus ids measured). Deep-reasoning/architecture fallback tier below
opus-4-7 on the **primary subscription** only.

## claude-sonnet-4-5

Oldest ICA-only Sonnet fallback: `ica/claude-sonnet-4-5`. ⚠️ Superseded 2026-08-26: use the bare
id — `[1m]` 403s everywhere now. Explicit-selectable only, not in any auto chain — prefer
`sonnet-5` or `sonnet-4-6` first; reach for this only when both are unavailable.

## Do Not Say

- Do not say ICA Sonnet lanes are free — `allowance: shared_token_pool`, an opt-in cost-shift, not
  `unlimited`.
- ⚠️ **Do not say `claude-opus-5` (or any Opus id) is available via ICA — that is stale as of
  2026-08-26.** It was present and fully servable 2026-07-31 through 2026-08-25; a tenancy-wide
  entitlement revocation now 403s it on all 11 keys, both gateways. Current truth: no ICA Opus
  lane exists.
- Do not say the ICA gateway drops `output_config.format` universally — that gap is observed on
  the Claude Sonnet 5 lane. ⚠️ The prior comparison ("honored on `claude-opus-5[1m]`") is
  unverifiable now — that lane is gone.
- Do not say ICA Opus availability permits routing MUST-stay-primary classes
  (`orchestration`, `mode_d`) off `claude/claude-opus-5` — moot as of 2026-08-26 (no ICA Opus lane
  to route to), but was never permitted regardless.
- ⚠️ Do not say a `[1m]`-suffixed id reaches ICA on any transport — superseded 2026-08-26. Every
  `[1m]` id 403s everywhere now; use bare ids.

**Full transport mechanics:** for Claude API params/pricing/tool-use detail see the `claude-api`
skill; for ICA transport flags see `routes/ica-lanes.md` + `~/.claude/skills/ica-delegate/SKILL.md`.
