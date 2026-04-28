# Heuristic Attribution Rules

Maps observed variance patterns to the most likely heuristic failure (H1–H6 in `planning/references/estimation-heuristics.md`). Use during Step 7 of `recipes/plan-retrospective.md`.

A single overrun can trigger multiple heuristics. Flag all that match; the output document distinguishes primary cause (highest-evidence) from contributing causes.

## Attribution Matrix

| Symptom | Likely Heuristic | Evidence to cite |
|---------|------------------|------------------|
| Phase 1 (Database) ratio close to 1.0× but Phases 2–4 (Repo/Service/Router) all ≥2× | **H1** (noun-counting) | New table count vs `(actual_pts_phases_2-4 / 2)` ratio. If new tables ≥ ratio, H1 is the primary miss. |
| Repository phase 2× over while non-repo phases on-target | **H2** (dual-impl multiplier) | Count of `*Local*Repository` + `*Enterprise*Repository` file pairs vs single-impl assumption. |
| One service alone consumed >40% of phase actual; service description matches algorithmic trigger words | **H3** (algorithmic flag) | Quote the service description; cite test file LOC and number of test scenarios actually written. |
| Plan total / sum-of-phase-areas < 0.8 in original plan AND overall ratio ≥1.5× | **H4** (bundle-vs-sum) | Original plan total vs Σ(per-area independent estimate); show the gap. |
| Estimate had no anchor reference, OR anchor cited but actual landed >30% off the anchor's known cost | **H5** (anchor reference) | Quote the anchor field (or note its absence); compare to actual. |
| Router phase ≥1.8×, plus DTOs/DI/OpenAPI commits show up across many phases | **H6** (plumbing budget) | Count of files matching `(schemas|dependencies|openapi|migrations)/` not attributed to a specific phase task. |
| All phases approximately equal multiplier (e.g., all 1.5×) with no concentration | Likely **H1 + H6 combined** (under-counted nouns and plumbing both pulled the floor up) | Show flat distribution; point to noun count and plumbing files separately. |
| Phase 5 (Testing) much larger than estimated, others on-target | Usually **H3** retrospectively (algorithmic service test matrix understated) OR genuine quality investment | Distinguish: if test files are concentrated on one service → H3; if tests are evenly distributed → quality investment, not a heuristic miss. |
| Multiple new commits modifying the plan or PRD itself during execution | NOT a heuristic failure → **scope_change** | Cite git log on plan path; estimate scope-change impact in pts. |
| Progress files mention waiting on external dep, blocked >3 days | NOT a heuristic failure → **external_blocker** | Quote progress blocker entries. |
| Mid-flight SPIKE-shaped commits (large research notes, exploratory branches) | NOT a heuristic failure → **discovery_work** | Suggests `confidence-check` skill should have flagged this pre-implementation. |

## Direction of Failure

Always record direction along with the heuristic:

- `under_estimate`: actual > estimate (most common; what these rules target)
- `over_estimate`: actual < estimate (less common; usually means cancelled scope or strong reuse)
- `wrong_distribution`: total on-target but per-phase wildly off (suggests batching/parallelism error, not estimation per se)

When tuning heuristics across reviews, only consistent same-direction failures should drive constant adjustments.

## Confidence Scoring

Tag each attribution with confidence:

- `high`: Clear single-cause pattern, evidence strongly supports one heuristic.
- `medium`: Plausible attribution but multiple candidates plausible; pick best-fit.
- `low`: Weak signal; record but don't include in tuning aggregation.

Only `high` confidence attributions count toward the "≥3 reviews flag the same heuristic" tuning trigger.

## Examples

**Example 1 — ica-team-features-filtering retrospective**
- Symptom: 8.5pt → ~28pt (~3.3×), all phases over by similar margin, router phase especially compressed (32 endpoints/2pts).
- Attribution:
  - **H1 (high)**: 8 new tables → noun floor was 16 pts, plan had 8.5
  - **H2 (high)**: 5 repos × dual-impl → repo subtotal should have been ~4.5 not 2.5
  - **H3 (high)**: ArtifactCompatibilityService at 1.25 vs realistic 3–5
  - **H4 (high)**: 7 capability areas, no per-area sum
  - **H5 (high)**: no anchor cited
  - **H6 (medium)**: plumbing scattered, hard to isolate
- Primary: H1 + H4 (these alone would have moved the estimate from 8.5 → 14+). Secondary: H2, H3.
- Direction: `under_estimate` across the board.
