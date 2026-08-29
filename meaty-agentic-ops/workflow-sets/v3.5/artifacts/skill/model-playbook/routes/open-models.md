# Route — Open Models (Free ICA Tier)

Loaded only when the routed model is one of the free, open-weight ICA models. Source:
`model-registry.yaml` `models:` block; all three carry `allowance: unlimited` (genuinely free,
cost-shifted off the primary budget) — see `routes/ica-lanes.md` for the free-4 boundary.

## gemma-4-26b

- **When to pick:** free open model via ICA — second-opinion, diversity-vote,
  simple-classification, mechanical-tasks. Grounded 2026-07-28, conf 0.6: Artificial Analysis
  Intelligence Index 26, "well above average among comparable open models" (median 9) — the
  strongest of the free-3 for lightweight critique/classification. Ranked #17/30 for
  `second_opinion`: "fine as a free tie-breaker/majority-vote leg, not a primary critique lens."
- **Invocation lane:** `ica/gemma-4-26b-a4b-it` (only lane; no billed-Claude equivalent).
- **Effort/context:** `max_context` 200000; no `[1m]` variant exists for this model.
- **Anti-patterns:** don't rely on it as the sole adversarial-review lens — weak critique depth
  relative to any paid/shared-pool tier.

## llama-4-maverick

- **When to pick:** free open model via ICA — second-opinion, diversity-vote, mechanical-tasks,
  lightweight-reasoning. Cross-family (Meta) diversity value distinct from Gemma/Granite.
- **Invocation lane:** `ica/meta-llama/llama-4-maverick-17b-128e-instruct-fp8`.
- **Gotchas — CONTESTED BENCHMARK CAVEAT, grounded 2026-07-28, conf 0.6:** ranked #20/30 for
  `second_opinion` — the **lowest** measured AA Intelligence Index in that comparison (14, vs
  GPT-5-high's 35 in the same comparison, and below even `gemma-4-26b`'s 26). LMArena history is
  compromised: Meta submitted a non-public "experimental chat" variant that briefly hit #2 before
  public weights fell to ~32nd; LMArena publicly stated the submission did not match provider
  expectations. Community reports place real-world Maverick behind DeepSeek V4 and Qwen 3.5/3.6
  on hard reasoning/coding. Treat any Maverick-favorable leaderboard claim with skepticism.
- **Anti-patterns:** don't trust it as a primary adversarial-review signal — "a diverse-but-weak
  lens adds noise more than adversarial signal"; the grounded finding recommends deprioritizing
  or dropping it from the `second_opinion` chain despite currently being the chain's sole
  non-Google/non-Claude leg. See `use-case-rankings.yaml`.

## granite-4-small

- **When to pick:** smallest/fastest free open model via ICA — simple-classification,
  mechanical-tasks, fast-response.
- **Invocation lane:** `ica/granite-4-h-small`.
- **Gotchas:** no task-relevant public benchmark evidence surfaced for adversarial-review fit
  (ranked #19/30 in the `second_opinion` grounding pass — "treat as unproven rather than
  confidently ranked"). It would add genuine 4th-family diversity if evaluated favorably; a
  targeted follow-up eval is worth running before relying on it for a real critique role.
- **Anti-patterns:** don't use for anything requiring real reasoning depth — the weakest general
  LLM candidate in the free tier per available scores.

## bob-local

- **When to pick:** local, zero-cost, stateless delegate — drafting, scaffolding, bounded
  exploration, fix-cycle (non-Mode-D only). Not an open-weight *ICA* model like the free-3 above
  (it runs locally, not on the gateway), but shares the same "free, capability-limited, use for
  bulk/mechanical work" profile so it's documented here alongside them.
- **Invocation lane:** `bob/bob-local` (local, `allowance: local`).
- **Effort/context:** `max_context` 40000 — the tightest ceiling of any routable model; keep
  prompts short and the task genuinely bounded.
- **Anti-patterns:** don't use for Mode-D (high-autonomy) work or anything needing more than
  ~40K tokens of context; don't expect taste-competitive output (`scores.taste: 3`).

## Common thread — what the free-3 are actually for

Free/unlimited via ICA (zero cost-shift impact), but capability trails every paid/shared-pool
lane by a wide margin (AA Index: gemma 26, llama-maverick 14, granite unmeasured — vs.
gemini-3.6-flash 50, gpt-5.6-terra 46-55). Fit: bulk/high-volume mechanical fan-out,
majority-vote/tie-breaker legs alongside a stronger primary, and diversity padding in an
ensemble — never the primary judgment/critique/generation lane on a taste- or
correctness-sensitive task.

## Do Not Say

- Do not say llama-4-maverick's old LMArena #2 placement reflects its real capability — that
  result came from an undisclosed variant; public weights are far weaker (~32nd).
- Do not say these three are interchangeable — llama-4-maverick's benchmark standing is
  specifically contested, gemma-4-26b is the strongest of the three on measured intelligence, and
  granite-4-small has no direct evidence either way.

**Full transport mechanics + free-tier exhaustion handling:**
`~/.claude/skills/ica-delegate/SKILL.md`. ICA lane mechanics shared across models —
`routes/ica-lanes.md`.
