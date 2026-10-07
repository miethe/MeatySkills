# Route — Anthropic Claude

Loaded only when the routed model is a Claude family member. Source: `model-registry.yaml`
`models:` block (fields verified against the registry, updated 2026-07-31 — ICA Opus 5 lane
verified live on that date). ⚠️ **Superseded 2026-08-26: the ICA Opus 5 lane verified live on
2026-07-31 has since been revoked tenancy-wide (raw-HTTP transports; unre-probed on the Claude
Code lane) — see the per-model sections below.** ⚠️ **Correction 2026-09-10: the 2026-08-26 claim
that `[1m]` ids are "separately retired" does NOT hold for the Claude Code invocation path —
`[1m]` (e.g. `claude-sonnet-5[1m]`, `claude-opus-5[1m]`) gets 1M context there; only bare ids on
that path get 200k. `[1m]` still 403s on raw-HTTP calls to the gateway — that is a
transport-specific fact, not a universal retirement. See `routes/ica-lanes.md` for the full
correction and the "instrument decides the layer" anti-pattern note.**

## claude-opus-5

⚠️ **LEGACY-SELECTABLE as of 2026-09-22 — superseded as the AOS SPINE by `claude-opus-5-5`**
(reconciled `node_01M3F4F5G93P21P1WAH565MAYQ` 2026-09-27; see the `claude-opus-5-5` entry in
`model-registry.yaml` for the current descriptor). Was flagship 2026-07-24–2026-09-22 (supersedes
claude-opus-4-8); still selectable for the MUST-stay tier as the in-chain legacy/fallback entry
behind `claude-opus-5-5` for `orchestration` and `mode_d`.

- **When to pick:** orchestration, verdict/adjudication, final synthesis, architecture, mode-d,
  schema-recovery, cross-wave merge, deep-reasoning, novel-algorithm-design — the historical
  MUST-stay tier; route to `claude-opus-5-5` first per current spine policy
  (`agentic_meta_dev/docs/agentic-operator/MODEL-ROUTING.md`).
- **Invocation lane:** `claude/claude-opus-5` (primary, billed, $5/$25 per M). ⚠️ **ICA offload
  RETRACTED 2026-08-26 (raw-HTTP transports) — no confirmed ICA Opus lane for routing purposes.**
  `claude-opus-5` (bare) 403s on all 11 ICA keys, both gateways, on raw-HTTP transports — a
  tenancy-wide entitlement revocation (`claude-sonnet-5` returns 200 on those same keys). ⚠️
  **2026-09-10: `claude-opus-5[1m]` answers on the Claude Code lane** (`~/ica-claude.sh`, ccx) per
  the `[1m]`-is-a-Claude-Code-layer-convention correction (`routes/ica-lanes.md`) — that
  measurement was scoped to the context-window question only and does not by itself re-establish
  ICA Opus as a routable spine-offload lane; re-probe the 2026-08-26 tenancy finding on the
  Claude Code path specifically before changing routing. MUST-stay-primary classes
  (`orchestration`, `mode_d`) route to `claude/claude-opus-5-5` first, then `claude/claude-opus-5`
  as fallback — that was never contingent on ICA availability.

- **⚠️ 2026-09-28 (evening), Nick:** `claude-opus-5-5[1m]` on ICA is now the **preferred** Claude
  model there (see `model-registry.yaml`'s `claude-opus-5-5` ICA provider row) — since Opus 5.5 is
  already servable on ICA, there is no reason to keep the ICA default on Sonnet 5 until ICA serves
  Sonnet 5.5. This is a capability call, not a cost saving: Opus 5.5 draws more of the shared
  weekly ccx credit allowance per call than Sonnet 5, roughly double per-MTok. Opus 5.5 also
  carries a real routing role beyond spine/escalation as of the same date — the `design_judgment`
  task class (architecture, UX/visual design, hard judgment, ambiguous synthesis).

  <details>
  <summary>Historical (superseded 2026-08-26, `[1m]`-retirement claim partially retracted 2026-09-10) — the 2026-07-31 "ICA spine-offload lane" verification</summary>

  `ica/claude-opus-5[1m]` was **enabled** (priority 2) and was **the** ICA spine-offload lane —
  verified servable 2026-07-31 (raw `/chat/completions` + the `~/ica-claude.sh` Claude Code
  executor path, both with a unique nonce). `allowance: shared_token_pool` — token-limited,
  **NOT free**. 1M context on the `[1m]` id (plain `claude-opus-5` caps at 200k on that path), but
  `maxOutputTokens` was **64000** on the ICA lane vs the 128K first-party ceiling.
  `ica/claude-opus-4-8[1m]` was the offload *fallback*. The 2026-08-26 entry marked this whole
  section unreachable; 2026-09-10 measurement shows the `[1m]`/context-window half of it still
  holds on the Claude Code path — the open question is Opus tenancy access, not the suffix.
  </details>
- **Effort/context:** 1M context, 128K max output, adaptive thinking; effort defaults to `high`
  on the Claude API/Claude Code — set explicitly to change. New tokenizer (~30% more tokens than
  Opus 4.8/Sonnet 4.6 for the same text — same family as Sonnet 5+).
- **Gotchas:** knowledge cutoff May 2026; trails Fable 5 on taste/quality but surpasses Opus 4.8
  (>2x Opus 4.8's agentic performance at the same price point per Anthropic).
- **ICA lane capabilities** — ⚠️ **Unverified as of 2026-09-10; do not assume restored.** The
  2026-07-31 probe (adaptive thinking via `output_config.effort` working, legacy
  `thinking.type: "enabled"` also working — a divergence from Sonnet 5, where the legacy form
  400s; tool use working both via Claude Code and raw `/v1/messages`; `output_config.format`
  honored) was marked unreachable 2026-08-26 when `claude-opus-5` 403'd tenancy-wide on raw-HTTP
  ICA transports. `claude-opus-5[1m]` answering on the Claude Code lane 2026-09-10 (see above) does
  not by itself confirm these capabilities still hold — re-probe before relying on any of them.
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

## claude-sonnet-5-5

- **When to pick:** the default subscription/native-execution Sonnet as of 2026-09-28 (Nick) **for
  contract-clear execution, review, and research** — agentic coding, code review, multi-file
  refactoring, planning, exploration, bounded/contract-clear whole-node legs. Supersedes
  `claude-sonnet-5` below for that scope. ⚠️ **Updated 2026-09-28 (evening), Nick: this is a
  task-class default, not a blanket one.** Sonnet 5.5 is very strong but not a powerhouse — route
  `design_judgment` work (architecture, UX/visual design, hard judgment, ambiguous synthesis) to
  `claude-opus-5-5` instead, and route `raw_strength` work (hard algorithmic problems, debugging,
  reasoning-heavy legs) to `gpt-6.1-sol` (superseding `gpt-6-sol`, 2026-09-30) instead; a Sonnet-5.5-first leg that misses twice still
  escalates to Opus 5.5.
- **Invocation lanes:** `claude/claude-sonnet-5-5` (primary, billed, $2/$10 per MTok, cache read
  $0.20/MTok, cache write $2.50/MTok). ⚠️ **ICA does NOT serve this model yet (measured
  2026-09-28)** — there is no `[1m]` ICA offload lane for it. Until it lands, ICA's **preferred
  Claude model is `claude-opus-5-5[1m]`**, not `claude-sonnet-5[1m]` — a capability call, not a
  cost saving (Opus 5.5 draws more of the shared weekly ccx credit allowance per call). See the
  `claude-opus-5-5` entry above and `claude-sonnet-5` below for the interim fallback; probe with a
  bare-id HTTP 200 check against the gateway per `ica-ccx-bare-ids-only`, and update this route
  when it lands (tracker `node_01M3MWZ6564YV32VCMMGAV5DN2`, tree `tree_01KVTH95ETM8YRYCV2ENHVR124`).
- **Effort/context:** 1M context, 128K output (300K via Batches API with the
  `output-300k-2026-03-24` beta header). Adaptive thinking; API default effort `high`, but Claude
  Code itself defaults the model to Medium effort. Extended-thinking params
  (`thinking.type:enabled` + `budget_tokens`) are **not accepted** — adaptive-only.
- **Benchmarks (self-reported, vs Sonnet 5 / Opus 5.5):** Terminal-Bench 4.0 70.6%/10.3%/66.4%;
  FrontierCode 1.1 (Main, Max effort) 46.2%/42.4%/54.4%; CursorBench 4.0 55.5%/34.1%/57.8%;
  OSWorld 2.1 (partial) 80.1%/57.0%/81.8%; GDPval-AA v2.1 1844/1449/1846; Chartography (no tools)
  61.6%/15.6%/64.4%. Beats Sonnet 5 on every listed benchmark; within a few points of Opus 5.5 on
  several, at half its price. Anthropic claims 30%+ faster output and up to 30% lower cost-per-task
  vs Sonnet 5. These benchmark/community-review claims are vendor- and community-reported, not
  independently measured by us (scorecard Intelligence raised 8→9 on this basis, 2026-09-28 evening).
- **Gotchas:** local Claude Code probe (2026-09-28) — `claude -p --model claude-sonnet-5-5 'reply
  ok'` returns stderr `[claude-code:unrecognized_model]` (benign) + stdout `ok`, exit 0; the
  harness accepts the id despite the stderr line.
- **Anti-patterns:** don't route to `claude-sonnet-5-5[1m]` on ICA — it doesn't exist yet. Don't
  route `design_judgment` or `raw_strength` work here just because it's the new cheaper default.

## claude-sonnet-5

- **When to pick:** LEGACY BUT SELECTABLE as of 2026-09-28 — `claude-sonnet-5-5` (above) is now the
  default. Sonnet 5 remains the live ICA offload lane (`claude-sonnet-5[1m]`) since ICA doesn't
  serve 5.5 yet. Historically the DEFAULT subscription implementation/workhorse tier — agentic coding,
  code review, multi-file refactoring, planning, exploration, extended-thinking/deep-reasoning.
- **Invocation lanes:** `claude/claude-sonnet-5` (primary, billed, $3/$15 per M, intro $2/$10
  through 2026-08-31). ICA offload: `ica/claude-sonnet-5` — ⚠️ **id form corrected 2026-09-10: use
  `claude-sonnet-5[1m]` on the Claude Code invocation path** (`~/ica-claude.sh`,
  `ica-settings*.json`, `leg`) to get the full 1M context; the bare id on that same path caps at
  200k. Measured: `claude-sonnet-5[1m]` → `contextWindow: 1000000` on ccx; bare → `200000`. Use the
  **bare** id only for a raw-HTTP caller hitting the gateway directly (`/v1/messages`,
  `/chat/completions`) — `[1m]` 403s there because the gateway never sees the suffix from that
  path (Claude Code strips it and substitutes a beta header before sending). See
  `routes/ica-lanes.md` for the full correction. Still the current-gen free-offload lane since
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
  ⚠️ Corrected 2026-09-10: the "`[1m]` = full context, plain caps at 200k" split is back in force
  on the **Claude Code invocation path** (the 2026-08-26 "dead everywhere" claim was measured on
  raw-HTTP transports only and did not hold for Claude Code) — use `[1m]` there for 1M context;
  bare only for a raw-HTTP caller.
- **Gotchas:** superseded as the default ICA offload by `sonnet-5` (bare) since 2026-07-08; keep
  only as the older/cheaper-token fallback lane, not the default.
- **Anti-patterns:** don't use as the default subscription workhorse — `sonnet-5` is now default.

## claude-haiku-5-5

- **When to pick:** the default cheap/mechanical Claude on the subscription lane as of 2026-10-07
  (Nick): extraction from reports, ITT node classification, routing/triage calls, strict-JSON output,
  short bug fixes, doc-gen, exploration. Supersedes `claude-haiku-4-5` there. Blind bench
  (`docs/project_plans/reports/model-eval/haiku-5-5-2026-10-07/results.md`): 4.33/5 vs Haiku 4.5 3.83,
  Sonnet 5.5 4.50, gpt-6-luna(low) 5.00; perfect on four of six tasks.
- **Invocation lanes:** `claude/claude-haiku-5-5` only (billed; list from $0.10/$0.50 per MTok, 10x below
  Haiku 4.5). The `haiku` alias resolves to it in Claude Code 2.1.293. 1M native context, 128K output;
  the `[1m]` suffix is accepted but a no-op, so use the bare id. ⚠️ **NOT served on ICA (403
  `team_model_access_denied` on CCx3, 2026-10-07)**: ICA delegation keeps `claude-haiku-4-5`.
- **Gotchas:** an ICA-profile session whose `haiku` alias resolves natively to 5.5 will 403, so the
  `ANTHROPIC_DEFAULT_HAIKU_MODEL` remap in `ica-settings*.json` must stay on `claude-haiku-4-5[1m]`.
  Weakest where a field needs inference (it put a council+writeback request at tier T3, as Sonnet 5.5
  also did) and on summary coverage at an exact word count (n=1; re-test before relying on it).
- **Anti-patterns:** don't route `design_judgment`, `raw_strength`, or taste-critical work here; do not
  replace Sonnet 5.5 for multi-file implementation on a bench this small.
- **Role, not rank (positioning 2026-10-07, `node_01M4C58QYW0KP7987JWADP8YKV`;
  `docs/project_plans/reports/model-eval/positioning-2026-10-07/report.md` in agentic_meta_dev):** a paid peer of
  `gpt-6-luna`, never a price fallback behind free ICA. It OWNS Claude-Code-native subagent work (Explore /
  `exploration` chain leg 1, classifiers, hook-side judgment), triage and routing judgment, fast single calls,
  and context scans up to ~160K tokens. Hand >=300K-token exhaustive reads to Sonnet 5.5 (5/8 vs 8/8 at 464K)
  and remember prompts over 100K tokens re-price the whole call at 5x. GPT-6 Luna keeps cross-family review and
  Codex-sandbox work; ICA 5.6 Luna keeps free bulk work on public content.

## claude-haiku-4-5

- **⚠️ PAID ON ICA (Nick, 2026-10-07, "Treat it as paid now").** The ICA row is `standard` /
  `shared_token_pool`, Cost score 7; the gateway meter still reads `0.0` for it (open discrepancy, needs a
  portal credit delta). Free ICA picks for mechanical work are now gpt-5.6-luna, Gemma 4, Llama 4 Maverick,
  Granite 4 Small. The "FREE" wording in the bullets below predates this decision.
- **LEGACY BUT SELECTABLE on the subscription lane (2026-10-07)** — `claude-haiku-5-5` (above) is the
  default there. Still the live ICA Haiku, since ICA does not serve 5.5. Nick reports it is now paid on
  ICA; the gateway `x-litellm-response-cost-original` header still reads `0.0` (2026-10-07, up to 41.6k
  tokens), so the ICA row is unchanged pending confirmation.
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
lane is RETRACTED 2026-08-26 on raw-HTTP transports** — `claude-opus-4-8` (plain or `[1m]`) 403s
tenancy-wide on all 11 ICA keys, both gateways, alongside every other ICA Opus id, when called
directly against the gateway. Was previously `enabled` as the spine-offload fallback behind
`ica/claude-opus-5[1m]`; not re-probed on the Claude Code lane after the 2026-09-10 `[1m]`
correction (`routes/ica-lanes.md`) — do not assume restored without re-testing. Still genuinely
useful on the **primary subscription**: 4.8 has the older/lighter tokenizer, which can win for
bounded high-volume fan-out — that has nothing to do with ICA.

## claude-opus-4-7

⚠️ **ICA lane RETRACTED 2026-08-26 on raw-HTTP transports** — same tenancy-wide Opus revocation as
`claude-opus-4-8` above (not individually re-probed on the Claude Code lane either). Deep-reasoning/
architecture/planning fallback tier below opus-4-8 on the **primary subscription** only.

## claude-opus-4-6

⚠️ **ICA lane RETRACTED 2026-08-26 on raw-HTTP transports** — `claude-opus-4-6` 403s tenancy-wide
on ICA via raw-HTTP, confirmed directly (one of the three Opus ids measured); not re-probed on the
Claude Code lane. Deep-reasoning/architecture fallback tier below opus-4-7 on the **primary
subscription** only.

## claude-sonnet-4-5

Oldest ICA-only Sonnet fallback: `ica/claude-sonnet-4-5`. ⚠️ Corrected 2026-09-10: use
`claude-sonnet-4-5[1m]` on the Claude Code invocation path for 1M context (bare caps at 200k
there); bare only for a raw-HTTP caller — see `routes/ica-lanes.md`. Explicit-selectable only, not
in any auto chain — prefer `sonnet-5` or `sonnet-4-6` first; reach for this only when both are
unavailable.

## Do Not Say

- Do not say ICA Sonnet lanes are free — `allowance: shared_token_pool`, an opt-in cost-shift, not
  `unlimited`.
- ⚠️ **Do not say `claude-opus-5` (or any Opus id) is available via ICA — that is stale as of
  2026-08-26.** It was present and fully servable 2026-07-31 through 2026-08-25; a tenancy-wide
  entitlement revocation now 403s it on all 11 keys, both gateways. Current truth: no ICA Opus
  lane exists.
- Do not say the ICA gateway drops `output_config.format` universally — that gap is observed on
  the Claude Sonnet 5 lane. ⚠️ The prior comparison ("honored on `claude-opus-5[1m]`") remains
  unverified — Opus tenancy on ICA is still an open question (see above), independent of the
  `[1m]` correction.
- Do not say ICA Opus availability permits routing MUST-stay-primary classes
  (`orchestration`, `mode_d`) off `claude/claude-opus-5` — moot regardless of ICA Opus tenancy
  status; was never permitted.
- ⚠️ Do not say "a `[1m]`-suffixed id never reaches ICA" without naming the transport (corrected
  2026-09-10): `[1m]` ids work on the Claude Code invocation path (`~/ica-claude.sh`,
  `ica-settings*.json`, `leg`) and give 1M context there; they 403 only on raw-HTTP calls to the
  gateway. Conflating the two transports is the "instrument decides the layer" anti-pattern — see
  `routes/ica-lanes.md`.
- Do not say "bare ids carry native 1M context on the Claude Code lane" — that was the retracted
  half of the 2026-08-26 finding; on Claude Code, bare ids cap at 200k and `[1m]` is required for
  1M.

**Full transport mechanics:** for Claude API params/pricing/tool-use detail see the `claude-api`
skill; for ICA transport flags see `routes/ica-lanes.md` + `~/.claude/skills/ica-delegate/SKILL.md`.
