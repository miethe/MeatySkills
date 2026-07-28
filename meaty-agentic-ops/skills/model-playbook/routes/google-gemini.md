# Route — Google Gemini

Loaded only when the routed model is a Gemini family member. Source: `model-registry.yaml`
`models:` block (updated 2026-07-27, promoting gemini-3.6-flash to leg-1 in three chains).

## gemini-3.6-flash

- **When to pick:** the NEW default fast cross-family lens — web-research, large-context,
  svg-generation, exploration, adversarial-review, code-review. Leg-1 in `web_research` and
  `svg_generation` chains, leg-2 in `second_opinion` (2026-07-27 promotion, by analogy to
  3.5-flash, not by evidence — see gotchas).
- **Invocation lanes:** `gemini/gemini-3.6-flash` (native gemini-cli, 1M without a suffix,
  Google-Search **GROUNDED** — Gemini 3+ only). `ica/gemini-3.6-flash[1m]` (ICA gateway,
  `shared_token_pool`, NOT free, 1M **with** the `[1m]` suffix — plain id caps at 200k, **not**
  grounded on the ICA path).
- **Effort/context:** 1M context (native, no suffix needed). Auth: AI Studio `GEMINI_API_KEY` at
  `~/.config/aos/secrets.env`.
- **Gotchas — GROUNDED 2026-07-28, conf 0.6, cuts against the current chain promotion:**
  multiple independent reviews flag this model as weak on SVG generation, layout, and spatial
  reasoning, and it does **not** consistently outperform 3.5-flash on visual/design quality
  (color cohesion, hover-animation) despite being newer. The 2026-07-27 promotion to
  `svg_generation` leg-1 was justified on "newer flash + ICA servability," not demonstrated SVG
  quality. Similarly for `second_opinion`: this is the **3rd** Google-family leg already in that
  chain (plus 100% of `web_research`/`svg_generation`) — marginal diversity value is low; prefer
  `gpt-5.6-terra` as the primary cross-check (see `routes/openai-gpt.md`). See
  `use-case-rankings.yaml`.
- **Anti-patterns:** don't treat as the default svg-taste leg for hero/final assets — reserve for
  bulk/draft SVG, or fall back to `gemini-3.5-flash` / `gemini-3.1-pro-preview` / `claude-fable-5`
  for taste-critical work.

## gemini-3.5-flash

- **When to pick:** previous-gen flash, now the FALLBACK below 3.6-flash for `web_research`/
  `svg_generation` (2026-07-27 demotion). Grounded 2026-07-28, conf 0.6: per Design Arena's own
  model index, SVG is 3.5-flash's **strongest relative category** (~54.8% win rate) and it's
  reported with better color cohesion/hover-animation than 3.6-flash — the key falsifying
  evidence against the "promote to newest flash" rationale. Consider it the stronger flash-tier
  SVG choice pending a formal re-validation.
- **Invocation lanes:** `gemini/gemini-3.5-flash` (native, grounded, 1M without a suffix),
  `ica/gemini-3.5-flash[1m]` (ICA, ungrounded, needs the `[1m]` suffix).
- **Gotchas:** the free "Gemini Code Assist for individuals" OAuth tier was sunset — on
  `IneligibleTierError`, fix `GEMINI_API_KEY`/`selectedType` in `~/.gemini/settings.json`;
  **do not** re-OAuth, that tier is permanently gone.

## gemini-3.1-pro-preview

- **When to pick:** web-research, large-context, planning, adversarial-review, deep-reasoning —
  heavy reasoning/deep analysis, the top Pro model (`status: preview`). Grounded 2026-07-28, conf
  0.6: took #1 on Design Arena's SVG Arena (Elo 1421, an 87-point lead) in an earlier 2026
  snapshot before Fable 5 overtook it, and predecessor 3.0 Pro Preview won Simon Willison's
  independent 9-model human-judged SVG benchmark. Google's SVG "taste" historically lives in the
  Pro tier, not Flash — a strong candidate for taste-critical SVG when Fable 5/Opus cost isn't
  justified.
- **Invocation lane:** `gemini/gemini-3.1-pro-preview` (native only — no ICA lane on *this*
  registry entry; the ICA bridge is a separate model, `gemini-3.1-pro-preview-ica`, below).
- **Gotchas:** `gemini-3-pro-preview` is shut down and **there is no `gemini-3.5-pro`** — don't
  invent either id.

## gemini-3.1-pro-preview-ica

Separate registry entry for the ICA-bridged form of the same Gemini 3.1 Pro Preview weights —
same use cases and SVG-taste evidence as the native entry above, via the ICA gateway instead of
`gemini-cli`.

- **When to pick:** same as `gemini-3.1-pro-preview` (web-research, large-context, exploration) —
  reach for this lane specifically when the caller is already on the ICA profile and doesn't need
  Search grounding.
- **Invocation lane:** `ica/gemini-3.1-pro-preview[1m]` — always use the `[1m]` id (plain caps at
  200k on the gateway; plain `ica/gemini-3.1-pro-preview` is a demoted fallback only).
- **Gotchas:** `shared_token_pool`, not free. Not Search-grounded — the ICA proxy cannot ground;
  use the native lane above if grounding is required.

## gemini-3.1-flash-lite

- **When to pick:** cheapest/fastest native tier for trivial work (formatting, one-liners),
  exploration/mechanical.
- **Invocation lane:** `gemini/gemini-3.1-flash-lite` (native only — no ICA lane in the
  registry).

## Native vs ICA — the split that matters

- **Native gemini-cli:** Google Search grounding (Gemini 3+ only), 1M context without a suffix,
  Nano Banana image-gen, SVG/multimodal input. Reach for this **only** when you need a capability
  the ICA proxy lacks.
- **ICA gateway:** cheaper-feeling (shared pool) but **not** grounded and **not** free
  (`allowance: shared_token_pool`) — needs the `[1m]` suffix to unlock 1M (the plain id silently
  caps at 200k on the ICA path only; native is already 1M without a suffix).
- Prefer ICA-first for non-grounded cross-family second opinions; reach for native only to close
  a grounding/image-gen/SVG capability gap.
- Auth: `GEMINI_API_KEY` (AI Studio, metered) in `~/.config/aos/secrets.env`;
  `~/.gemini/settings.json` `selectedType=gemini-api-key`. `IneligibleTierError` means the
  settings reverted to `oauth-personal` — fix the settings, don't re-OAuth.

## Do Not Say

- Do not say Gemini on ICA gets Search grounding — it doesn't; grounding is native-key-only.
- Do not say the plain (non-`[1m]`) ICA Gemini id gets 1M context — it's silently capped at 200k
  on that path.

**Full transport mechanics:** headless flags, output caps, image/SVG prompt templates —
`~/.claude/skills/gemini-cli/SKILL.md`. ICA lane mechanics shared across models —
`routes/ica-lanes.md`.
