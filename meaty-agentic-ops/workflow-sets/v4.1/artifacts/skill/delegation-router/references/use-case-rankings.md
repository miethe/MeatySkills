# Reading & Extending Use-Case Rankings

How to read `use-case-rankings.yaml` and how to run a new grounding pass. Agent-facing companion
to the file, mirroring `references/model-registry.md`'s role for `model-registry.yaml`.

**Tracked source (edit here)**: `meaty-agentic-ops/skills/delegation-router/use-case-rankings.yaml`
in the **MeatySkills** repo — co-located with `model-registry.yaml`, the router it informs, and
`SKILL.md`. Same "edit the upstream, never a deployed copy" rule as every other artifact. Do not
duplicate the ranking data here — this file explains structure and procedure; the data lives in
the YAML.

## What this file is (and isn't)

`model-registry.yaml`'s `scores{cost,intelligence,taste,speed}` block is a fast, hand-asserted
**model-level** prior — one 4-axis scorecard per model, identical across every task. This file is
a second, sharper evidence layer: research-grounded rankings **per use-case**, each carrying
provenance (an `rf` run id), a confidence score, and a freshness date. It is **advisory only**:

- **Never read on the resolve path.** `resolver.js` stays a pure, clockless oracle (AOS
  constraint 4). This file is not wired into `resolve()` and must not become an implicit ranking
  input without a deliberate resolver upgrade — same posture as the registry's own `scores{}`
  block (see `SPEC.md`'s Do-Not-Say list).
- **Informs human-gated chain tuning.** A grounding pass produces evidence + a recommended chain;
  a human reviews it and, if convinced, hand-writes the result into `model-registry.yaml`'s
  `routing_policy` in the **same PR**. Research proposes, a human accepts.
- **Decays, doesn't calcify.** A grounded rank is authoritative only while confidence is high and
  the evidence is fresh; past the half-life it fades back toward the base scorecard (see
  Composition rule below) — not a permanent override.
- **Never beats MUST-stay.** `orchestration`, `verdict`, `mode_d`, `council_review`, `synthesis`
  (+ `schema_recovery`, `cross_wave_merge`) resolve to `claude` unconditionally, before any
  ranking/availability filter runs. Nothing here changes that.

## Schema, field by field

```yaml
version: 1
updated: 2026-07-28

composition_rule:
  form: "effective_rank(model, use_case) = blend(base_scorecard, grounded_rank, confidence, freshness_decay)"
  half_life_days: 45
  note: "..."

use_cases:
  <kebab-id>:
    description: ...
    source_task_classes: [...]
    status: measured | unmeasured
    # measured only, below this line:
    confidence: 0.6
    freshness: 2026-07-28
    provenance:
      rf_run_id: rf_run_...
      method: "..."
      evidence_refs: [...]
    ranking: [ { model, rank, score_hint, rationale }, ... ]
    chain_applied: ["provider/model_id", ...]
    caveats: [ "...", ... ]
```

- **`<kebab-id>`** — one of the 17 taxonomy use-cases. All 17 MUST appear; most start
  `status: unmeasured` with only `description` + `source_task_classes` until grounded.
- **`source_task_classes`** — vocabulary task-class strings this use-case maps from, for
  traceability back to `routing_policy` keys and `task-class-vocabulary.v1.json`.
- **`status`** — `measured` once a pass produced `ranking` + `chain_applied`; else `unmeasured`
  (base `scores{}` scorecard governs alone).
- **`confidence`** (0-1) — weight the grounded rank carries vs. the base scorecard; set by the
  adjudicating pass, reflecting evidence strength and how contested it was.
- **`freshness`** — date the evidence was adjudicated; the other half of the decay term below.
- **`provenance`** — `rf_run_id`, `method` (one line: researcher count, sweep type, adjudicator),
  `evidence_refs` (3-6 strongest source URLs).
- **`ranking`** — top 8 candidates plus any "notable exclusion" (seriously considered, explicitly
  dropped/demoted, with why). Entries: `{model, rank, score_hint, rationale}`; `model` is the exact
  top-level key from `model-registry.yaml`'s `models:` block, not `provider/model_id` (reserved
  for `chain_applied`). Ranks aren't contiguous — an exclusion keeps its real rank (e.g. 20 of 30).
- **`chain_applied`** — the `provider/model_id` chain this pass produced, same format as
  `routing_policy.<task_class>.chain`; what a human copies into the registry at the writeback
  gate. Not auto-synced by anything here.
- **`caveats`** — evidence gaps, contested benchmarks, effort-tier sensitivity, snapshot
  volatility, or trade-off notes a human needs before adopting `chain_applied`.

## Composition rule — worked example

`effective_rank = weight * grounded_score_hint + (1 - weight) * base_scorecard_score`, where
`weight = confidence * 0.5 ^ (days_since_freshness / half_life_days)`.

**Example** — `second-opinion`, model `gemini-3.6-flash`, `confidence: 0.6`, `half_life_days: 45`,
base scorecard `intelligence: 7`, grounded `score_hint: 7`:

| days since freshness | weight | effective_rank |
|---|---|---|
| 0 (fresh) | 0.60 | 7.0 |
| 45 (1 half-life) | 0.30 | 7.0 |
| 90 (2 half-lives) | 0.15 | 7.0 |

Scores agree here, so decay is invisible. Swap in a model the pass demoted hard (`score_hint: 3`,
same base `intelligence: 7`) and the decay becomes visible: day 0 → `0.6*3 + 0.4*7 = 4.6` (a real
demotion); day 90 → `0.15*3 + 0.85*7 = 6.4` (mostly back to the base prior). This describes the
intended behavior for a future resolver-side or reporting-side consumer — nothing in
`resolver.js` computes it today; see "Never read on the resolve path" above.

## Running a new grounding pass

1. **Launch an `rf` run** for provenance — via the node API (`POST /api/runs` on
   `http://10.42.10.76:7432/api/runs`, owner-scoped `RF_TOKEN_AGENT`) or the local `rf` CLI, with
   a descriptive id (`rf_run_<date>_<purpose>`) to cite in `provenance.rf_run_id`.
2. **Research evidence sweep** — parallel research agents gather public benchmarks, vendor evals,
   and practitioner reports for the *specific use-case*, not a generic model comparison — frame
   around the actual task ("which model best adversarially critiques Claude output", not "which
   model is smartest").
3. **Adjudicate** — a spine-tier pass reviews the evidence, resolves disagreements between
   research agents, assigns `confidence`, and drafts `ranking` + `chain_applied` + `caveats`.
4. **Update this YAML and the chain in the same PR** — the human writeback gate. Add/replace the
   use-case's block (`status: measured`) here, and if adopted, hand-edit the corresponding
   `routing_policy.<task_class>.chain` in `model-registry.yaml` in the same commit, with a
   header-comment note. Never let the two drift silently.
5. **Regenerate + redeploy** per the normal registry workflow if `model-registry.yaml` changed
   (`scripts/build-model-registry.py`, then `sync-to-global.sh` / `/redeploy`) — this file has no
   separate generated-JSON step since nothing reads it at runtime.

## Relationship to BP-6 (CCDash empirical prior)

This file and the BP-6 seam (`ccdash-to-delegation-router-routing-prior`, tracked in
`agentic_meta_dev/docs/seams.yaml`) are **two independent evidence sources feeding the same
eventual table** (per-use-case model rankings): this file is curated/research evidence —
point-in-time, human-adjudicated, sourced from public benchmarks/practitioner reports via an `rf`
grounding pass, answering "what does the outside world say is best here." BP-6/CCDash is live
outcome telemetry — continuously accumulated from actual routed task outcomes in this AOS,
answering "what has actually worked, here, for us."

**Merge policy is TBD** (spec OQ-5) — the two are not currently reconciled. CCDash's live feedback
join into the router is itself fail-closed and inert pending a separate feedback-merge
implementation (router-owned cap/floor/sample-defense/human-override/provenance guardrails; see
`model-registry.yaml`'s `validateFeedbackJoin()` constraints). Until that lands, treat this file
as the leading signal for sparse-telemetry use-cases (new task classes, low call-volume routes)
and expect BP-6 to dominate high-volume routes once outcome data is dense.
