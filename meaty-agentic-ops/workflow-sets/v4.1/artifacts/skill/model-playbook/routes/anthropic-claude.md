# Route — Anthropic Claude

Loaded only when the routed model is a Claude family member. Source: `model-registry.yaml`
`models:` block (fields verified against the registry, updated 2026-07-31 — ICA Opus 5 lane
verified live on that date).

## claude-opus-5

- **When to pick:** the AOS SPINE / MUST-stay tier — orchestration, verdict/adjudication, final
  synthesis, architecture, mode-d, schema-recovery, cross-wave merge, deep-reasoning,
  novel-algorithm-design. Current flagship as of 2026-07-24, supersedes claude-opus-4-8.
- **Invocation lane:** `claude/claude-opus-5` (primary, billed, $5/$25 per M). ICA offload:
  `ica/claude-opus-5[1m]` is **enabled** (priority 2) and is now **the** ICA spine-offload lane —
  verified servable 2026-07-31 (raw `/chat/completions` + the `~/ica-claude.sh` Claude Code
  executor path, both with a unique nonce). `allowance: shared_token_pool` — token-limited,
  **NOT free**. 1M context on the `[1m]` id (plain `claude-opus-5` caps at 200k), but
  `maxOutputTokens` is **64000** on the ICA lane vs the 128K first-party ceiling — plan long
  outputs accordingly. `ica/claude-opus-4-8[1m]` is now the offload *fallback* (see legacy note
  below). MUST-stay-primary classes (`orchestration`, `mode_d`) still route to
  `claude/claude-opus-5` — ICA availability does not make it legal to move them off the
  subscription; the ICA lane is an explicit opt-in offload for bounded work behind a reviewer gate.
- **Effort/context:** 1M context, 128K max output, adaptive thinking; effort defaults to `high`
  on the Claude API/Claude Code — set explicitly to change. New tokenizer (~30% more tokens than
  Opus 4.8/Sonnet 4.6 for the same text — same family as Sonnet 5+).
- **Gotchas:** knowledge cutoff May 2026; trails Fable 5 on taste/quality but surpasses Opus 4.8
  (>2x Opus 4.8's agentic performance at the same price point per Anthropic).
- **ICA lane capabilities (probed 2026-07-31):** adaptive thinking via `output_config.effort`
  **works** (`thinking` block + `usage.output_tokens_details.thinking_tokens` returned), and the
  legacy `thinking.type: "enabled"` form **also works** — a divergence from
  `claude-sonnet-5[1m]`, where the legacy form 400s. Tool use works both via Claude Code and raw
  `/v1/messages` (content `['thinking','tool_use']`, `stop_reason: tool_use`).
  `output_config.format` (json_schema structured output) **is honored** — Opus 5 does not share
  Sonnet 5's silently-dropped-`format` gap. Note the `[1m]` suffix is a Claude Code client-side
  hint: raw transports must send the plain id (see `routes/ica-lanes.md`).
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
  through 2026-08-31). ICA offload: `ica/claude-sonnet-5[1m]` (shared_token_pool, NOT free) — the
  current-gen free-offload lane since 2026-07-08, superseding sonnet-4-6[1m].
- **Effort/context:** 1M context, 128K output, adaptive thinking on by default; first Sonnet with
  `xhigh` effort.
- **Gotchas:** new tokenizer emits ~30% more tokens than 4.6 for the same text → effective
  metered cost ~$3.90/$19.50-equivalent at full price. On the ICA shared-pool lane (or any metered
  lane), prefer `claude-sonnet-4-6[1m]` or `claude-haiku-4-5` for BOUNDED/MECHANICAL high-volume
  fan-out — reserve `sonnet-5[1m]` offload for capability-sensitive bounded waves. ICA reasoning
  **works** via Claude Code (revalidated 2026-07-20: adaptive thinking + `output_config.effort`
  honored end-to-end) — reasoning-dependent offload is fine. One remaining gap:
  `output_config.format` (structured JSON) is silently dropped by the ICA gateway → prose, not
  schema JSON; force a tool-call for structured output on that lane instead.
- **Anti-patterns:** don't expect schema-constrained JSON via `output_config.format` on the ICA
  lane.

## claude-sonnet-4-6

- **When to pick:** previous-gen Sonnet; implementation/planning/code-review/exploration/
  multi-file-refactoring when token-efficiency beats raw capability (bounded/mechanical
  high-volume fan-out on metered/ICA lanes).
- **Invocation lanes:** `claude/claude-sonnet-4-6` (billed, standard), `ica/claude-sonnet-4-6[1m]`
  (older token-efficient offload, shared_token_pool — the demoted-but-still-useful ICA lane),
  `ica/claude-sonnet-4-6` (plain, avoid — caps at 200k).
- **Gotchas:** superseded as the default ICA offload by `sonnet-5[1m]` since 2026-07-08; keep
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

LEGACY as of 2026-07-24 (superseded by opus-5 as spine), same $5/$25 per M pricing. Still
selectable and its ICA lane `ica/claude-opus-4-8[1m]` remains **enabled** — but as of 2026-07-31
it is the spine-offload **fallback**, behind the now-verified `ica/claude-opus-5[1m]` (see above).
Still genuinely useful: 4.8 has the older/lighter tokenizer, which can win for bounded
high-volume fan-out on a metered shared pool.

## claude-opus-4-7

ICA-only (shared pool): `ica/claude-opus-4-7[1m]` (always the `[1m]` variant — plain 200k id is a
demoted fallback only). Deep-reasoning/architecture/planning fallback tier below opus-4-8.

## claude-opus-4-6

ICA-only (shared pool): `ica/claude-opus-4-6[1m]` (same `[1m]`-first rule). Deep-reasoning/
architecture fallback tier below opus-4-7.

## claude-sonnet-4-5

Oldest ICA-only Sonnet fallback: `ica/claude-sonnet-4-5[1m]`. Explicit-selectable only, not in
any auto chain — prefer `sonnet-5` or `sonnet-4-6[1m]` first; reach for this only when both are
unavailable.

## Do Not Say

- Do not say ICA Opus/Sonnet lanes are free — `allowance: shared_token_pool`, an opt-in
  cost-shift, not `unlimited`. This includes `ica/claude-opus-5[1m]`.
- Do not say `claude-opus-5` is unavailable via ICA — that was true through the 2026-07-27 probe
  but is **stale**: it is present on the gateway model list and fully servable as of 2026-07-31.
- Do not say the ICA gateway drops `output_config.format` universally — that gap is observed on
  the Claude Sonnet 5 lane; on `claude-opus-5[1m]` `format` is honored.
- Do not say ICA Opus 5 availability permits routing MUST-stay-primary classes
  (`orchestration`, `mode_d`) off `claude/claude-opus-5`.

**Full transport mechanics:** for Claude API params/pricing/tool-use detail see the `claude-api`
skill; for ICA transport flags see `routes/ica-lanes.md` + `~/.claude/skills/ica-delegate/SKILL.md`.
