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
- **Anti-patterns:** don't route via ICA (`--profile ica` / `~/ica-codex.sh`) — that gateway is
  Chat-Completions-only while Codex speaks the Responses API, so it 404s and Codex slow-fails with
  `Reconnecting 1/5…5/5` retries (looks like a hang, isn't one).

## gpt-5.6-terra

- **When to pick:** DEFAULT codex workhorse — agentic coding, code-review, ac-validation,
  debug-escalation, implementation. This is the `codex/*` entry in the `code_review` routing
  chain. Grounded 2026-07-28, conf 0.6: ranked **#1** for `second_opinion` — best balance of
  capability (AA Index 46-55) and genuine cross-family diversity: the current `second_opinion`
  chain has **zero** GPT-line legs despite `web_research` and `svg_generation` both being 100%
  Gemini. See `use-case-rankings.yaml`.
- **Invocation lane:** `codex/gpt-5.6-terra`. The ICA dzus lane (`gpt-5.6-terra-dzus`) is **DEAD
  on every route** — re-confirmed 2026-07-27 (both keys): `/chat/completions`+`/messages` →
  `LLM Provider NOT provided`, `/responses` → Azure api-version gate. Do not attempt it.
- **Effort:** default `medium` for implementation/review; escalate to `xhigh` only when blocked
  with concrete artifacts (failing tests, stack traces); reserve `ultra` for genuinely
  intractable problems after `xhigh` has been tried.
- **Gotchas:** `max_context` 400000. Can overfit to its own generated plan — re-check outputs
  against repo reality (existing types, APIs, test state) before committing.
- **Anti-patterns:** see the ICA routing anti-pattern above; applies identically to Terra.

## gpt-5.6-luna

- **When to pick:** cheaper/faster codex tier — lighter review/analysis, quick fixes, mechanical
  edits, cost-efficient second opinions, exploration.
- **Invocation lane:** `codex/gpt-5.6-luna`. The ICA dzus lane (`gpt-5.6-luna-dzus`) is only
  **partially** servable — completes tool calls exclusively via the CODEX key on raw
  `/chat/completions` with `reasoning_effort` **omitted**; adding the param or using the CC key
  fails it. That narrow working path isn't reachable by any wired executor (`ica-claude.sh` uses
  `/messages`+CC key; Codex needs `/responses`) — no ICA provider row is carried in the registry.
- **Effort ladder:** `none|minimal|low|medium|high|xhigh` — **no `ultra`** (Sol/Terra only).
- **Anti-patterns:** don't drive it at `ultra` (unsupported); don't attempt ICA routing — the
  working path exists but no executor can reach it today.

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

- Do not say `gpt-5.6-*` is reachable via ICA — `terra-dzus` is dead on every route; `luna-dzus`
  is only partially servable via a path no executor can reach. Use `codex/*` lanes for the 5.6
  line.
- Do not say `gpt-5.5-gus` works via plain `ica-claude.sh`/Claude Code — it needs the
  `ica-gpt.sh` param-strip shim (laptop-only).

**Full transport mechanics:** flags, sandbox modes, session logging, effort policy defaults —
`~/.claude/skills/codex/SKILL.md`. ICA lane mechanics shared across models —
`routes/ica-lanes.md`.
