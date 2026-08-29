# Route — OpenAI GPT (Codex CLI + ICA)

Loaded only when the routed model is a GPT-family member. Source: `model-registry.yaml`
`models:` block (gpt-5.6 line verified against codex-cli v0.144.0-alpha.4).

## gpt-5.6-sol

- **When to pick:** FRONTIER SOTA — hardest reasoning / deep problem analysis, the escalation
  target when `gpt-5.6-terra` stalls: debug-escalation, architecture, novel-algorithm-design.
  Grounded 2026-07-28, conf 0.6: ranked #2 for `second_opinion` (Artificial Analysis Intelligence
  Index 54-59, above Gemini 3.6 Flash's 50 at matched-or-higher effort) and #2 for
  `svg_generation` taste (reported #1 on Design Arena's general/frontend index in one snapshot —
  ambiguous whether that is the SVG-specific sub-arena or the broader index). See
  `use-case-rankings.yaml`.
- **Invocation lane:** `codex/gpt-5.6-sol` via `codex exec -m gpt-5.6-sol`. **No working ICA
  lane** — the `gpt-5.6-sol` id was never carried on the gateway (only terra/luna `-dzus` ids were
  attempted, both dead; see below).
- **Effort ladder:** `none|minimal|low|medium|high|xhigh|ultra` (`ultra` = Sol/Terra only, Luna
  caps at `xhigh`). Pass the config string: `--config model_reasoning_effort="<level>"`. Global
  `~/.codex/config.toml` defaults Sol @ `xhigh`.
- **Gotchas:** `max_context` 400000.
- **Anti-patterns:** no free ICA lane for Sol — only `gpt-5.6-terra-dzus`/`-luna-dzus` carry an ICA
  shim lane; Sol's id was never on the gateway. Use metered `codex/gpt-5.6-sol`.

## gpt-5.6-terra

- **When to pick:** DEFAULT codex workhorse — agentic coding, code-review, ac-validation,
  debug-escalation, implementation. This is the `codex/*` entry in the `code_review` routing
  chain. Grounded 2026-07-28, conf 0.6: ranked **#1** for `second_opinion` — best balance of
  capability (AA Index 46-55) and genuine cross-family diversity: the current `second_opinion`
  chain has **zero** GPT-line legs despite `web_research` and `svg_generation` both being 100%
  Gemini. See `use-case-rankings.yaml`.
- **Invocation lane:** `codex/gpt-5.6-terra` (metered). **Free ICA alternative SHIPPED 2026-07-29:**
  `gpt-5.6-terra-dzus` — the same model at $0 to the metered budget, driven agentically via
  `~/ica-codex.sh` + a local Responses shim (see the `gpt-5.6-terra-dzus` section below). Pick the
  metered lane when the dzus caveat (no reasoning-effort control on tool turns) or shim overhead matters.
- **Effort:** default `medium` for implementation/review; escalate to `xhigh` only when blocked
  with concrete artifacts (failing tests, stack traces); reserve `ultra` for genuinely
  intractable problems after `xhigh` has been tried.
- **Gotchas:** `max_context` 400000. Can overfit to its own generated plan — re-check outputs
  against repo reality (existing types, APIs, test state) before committing.
- **Anti-patterns:** for the metered lane, watch the plan-overfit gotcha above. For the free ICA
  lane, see `gpt-5.6-terra-dzus` below (effort not controllable on tool turns).

## gpt-5.6-luna

- **When to pick:** cheaper/faster codex tier — lighter review/analysis, quick fixes, mechanical
  edits, cost-efficient second opinions, exploration.
- **Invocation lane:** `codex/gpt-5.6-luna` (metered). **Free ICA alternative SHIPPED 2026-07-29:**
  `gpt-5.6-luna-dzus` — same model at $0 to the metered budget via `~/ica-codex.sh` + the local
  Responses shim (see the `gpt-5.6-luna-dzus` section below).
- **Effort ladder:** `none|minimal|low|medium|high|xhigh` — **no `ultra`** (Sol/Terra only).
- **Anti-patterns:** don't drive it at `ultra` (unsupported).

## gpt-5.6-terra-dzus

- **When to pick:** the **free-to-us agentic Codex lane** on gpt-5.6-terra — identical model, $0 to
  the metered budget (ICA shared pool). Prefer for cost-sensitive agentic coding, code-review,
  ac-validation, implementation, second-opinion when Codex is the executor. Escalate to metered
  `codex/gpt-5.6-terra` or `-sol` if the effort caveat or shim reliability bites.
- **Invocation lane:** `ica/gpt-5.6-terra-dzus`. The delegation-router emits
  `~/ica-codex.sh exec … -m gpt-5.6-terra-dzus "…"`; the wrapper auto-starts a local
  Responses→ChatCompletions proxy (`agentic_meta_dev/infra/ica-codex-shim/`) and points Codex at it.
  Verified agentic end-to-end (file edits + multi-turn tool loop) 2026-07-29.
- **CAVEAT — effort:** `reasoning_effort` is DROPPED on tool turns (reasoning+tools together forces
  the api-version-gated `/responses` path). Effort defaults server-side — not controllable on
  agentic turns. Non-tool turns keep the requested effort.
- **Deploy:** laptop `~/ica-codex.sh` (symlink) + node via bootstrap. The metered `codex/gpt-5.6-terra`
  stays the `code_review` chain leg; this dzus lane is enabled + explicit-selectable, not auto-chained.
- **Anti-patterns:** don't expect effort control on tool turns; use `codex/gpt-5.6-sol` for the
  hardest reasoning; on hosts without `~/ica-codex.sh`, fall back to a metered `codex/*` lane.

## gpt-5.6-luna-dzus

- **When to pick:** the free-to-us cheaper/faster dzus tier — lighter review, mechanical edits,
  cheap second opinions, exploration, when the free lane is worth the shim overhead.
- **Invocation lane:** `ica/gpt-5.6-luna-dzus` — same mechanism as `gpt-5.6-terra-dzus`
  (`~/ica-codex.sh` + local Responses shim). Same effort caveat (dropped on tool turns).
- **Effort ladder:** `none|minimal|low|medium|high|xhigh` — no `ultra`.

## gpt-5.5-gus

- **When to pick:** the one GPT-family model with **confirmed** ICA servability today —
  pragmatic interim GPT-line lens if you need GPT capability on the free/shared ICA pool and
  Codex isn't an option. second-opinion, alternative-approach, complex-reasoning.
- **Invocation lane:** `ica/gpt-5.5-gus`, routed via the param-strip shim
  (`agentic_meta_dev/infra/ica-gpt-shim/ica-gpt.sh`) — **not** plain `ica-claude.sh`/Claude Code
  (400s on `output_config`, same failure class as the reasoning-control-param gotcha below).
  Codex reaches it directly via `/responses` with no shim needed (`~/ica-codex.sh` /
  `codex --profile ica`). **LAPTOP-ONLY** — the shim is not deployed to the node.
- **Effort/context:** reasoning works on raw transports — `/chat/completions` honors
  `reasoning_effort`, `/responses` honors `reasoning.effort` and scales depth (low ≈24 reasoning
  tokens, high ≈99). `max_context` conservative 200000 (no context metadata reported via
  `/models`).
- **Gotchas:** on the Claude-Code/`/messages` path, strip the reasoning-control param or use the
  `ica-gpt.sh` shim, which does this for you.
- **Anti-patterns:** don't call it via bare `ica-claude.sh` — `400 Unknown parameter: output_config`.

## The reasoning-control-param gotcha (ICA Azure paths)

The ICA Azure-backed GPT deployments reject the client's reasoning-control param on some
transports/keys — `reasoning_effort` on `/chat/completions`, `output_config` on `/messages`.
Strip it (raw client, or the `ica-gpt.sh` shim for Claude Code) and the model completes; effort
then defaults server-side. Confirmed across `gpt-5.5-gus`, `gpt-5.6-luna-dzus` (partial), and
`gpt-5.6-terra-dzus` investigations (2026-07-20 through 2026-07-27). Always test with
`--fallback-model` **off** and a unique nonce when probing — silent fallback to a working model
masks the failure as success (see `routes/ica-lanes.md`).

*(Legacy tiers below — brief entries, one heading each so registry `playbook_ref` anchors resolve.)*

## gpt-5.5

Superseded by `gpt-5.6-terra`. Invocation: `codex/gpt-5.5`. Prefer the 5.6 line; selectable for
compatibility only.

## gpt-5.5-pro

Superseded by `gpt-5.6-sol`. Invocation: `codex/gpt-5.5-pro`. Prefer the 5.6 line; selectable for
compatibility only.

## gpt-5.4

Status `degraded` — **not servable** on any tested key/endpoint as of the 2026-07-21 retest
(`enabled: false` in the registry). Do not route to it.

## gpt-5.1

Status `degraded` — **not servable** on any tested key/endpoint as of the 2026-07-21 retest
(`enabled: false` in the registry). Do not route to it.

## gpt-4o

Still `active` (`ica/gpt-4o`), but legacy-tier. Grounded 2026-07-28, conf 0.6: ranked #21/30 for
`second_opinion` — no reason to prefer it over any current GPT-5.x model.

## Do Not Say

- `gpt-5.6-terra-dzus` / `gpt-5.6-luna-dzus` ARE reachable via ICA now — a free agentic Codex lane
  via `~/ica-codex.sh` + the local Responses shim (shipped 2026-07-29). But `gpt-5.6-sol` has NO ICA
  lane (its id was never carried). Don't claim reasoning-effort is controllable on dzus tool turns.
- Do not say `gpt-5.5-gus` works via plain `ica-claude.sh`/Claude Code — it needs the
  `ica-gpt.sh` param-strip shim (laptop-only).

**Full transport mechanics:** flags, sandbox modes, session logging, effort policy defaults —
`~/.claude/skills/codex/SKILL.md`. ICA lane mechanics shared across models —
`routes/ica-lanes.md`.
