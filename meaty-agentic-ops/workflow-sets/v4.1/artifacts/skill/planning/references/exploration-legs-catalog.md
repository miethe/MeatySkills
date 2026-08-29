# Exploration Legs Catalog

Reference for the four canonical investigation legs used in the Pre-Commitment Exploration workflow (`/plan:explore`). Each leg runs as a SPIKE sub-invocation via `/plan:spike --leg-of=<charter-path>` and deposits its output in `docs/project_plans/exploration/[idea-slug]/spikes/`.

**Full workflow context**: `.claude/skills/planning/SKILL.md` → "Workflow: Pre-Commitment Exploration"
**Meta plan**: `.claude/plans/plan-explore-pre-commitment-exploration-v1.md` §3.2

---

## Leg Types

### `technical` — Technical Feasibility

**Purpose**: Determine whether the idea is buildable within the existing architecture, at what cost, and with what constraints.

**When to include**: Always include unless the technical shape is fully understood (e.g., a direct re-skin of an existing component with no new data contracts).

**Recommended subagent**: `spike-writer` (primary) or `research-technical-spike`

**Question template**:
> "Is [idea] technically feasible inside the existing [CCDash layered architecture / relevant system]? Identify the primary integration points, estimate story-point rough order (using H5 anchor if a comparable feature exists), and flag any architectural decisions that must be made before implementation."

**Expected output shape**:
- Feasibility assessment: `feasible | infeasible | feasible-with-constraints`
- Integration points: list of files/layers affected
- Rough story-point estimate (or range) with H5 anchor reference
- Open architectural questions (OQ-* format)
- Confidence score: 0.0–1.0

**Confidence-scoring guidance**:
- `>= 0.8`: The spike found direct precedent in the codebase; integration points are enumerated; no unknown unknowns remain
- `0.5–0.79`: Integration points are identified but one or more design decisions are unresolved
- `< 0.5`: Significant unknowns remain; consider a follow-up technical spike before synthesizing

---

### `value` — Value / Desirability

**Purpose**: Determine whether users actually need this, would use it, and whether the absence causes measurable pain today.

**When to include**: Include when the idea is user-facing or when the "should we want this?" question is uncertain. May be skipped for pure infrastructure changes with no direct user impact.

**Recommended subagent**: `ux-researcher` (primary) or `search-specialist`

**Question template**:
> "Do users of [product] currently experience pain from the absence of [idea]? Find evidence in session logs, support requests, user feedback, or usage patterns that corroborates or refutes the value hypothesis: '[hypothesis from charter]'. What is the counterfactual — what do users do today instead?"

**Expected output shape**:
- Evidence summary: citations from logs, requests, or research
- User segments affected and estimated frequency
- Counterfactual behavior (current workaround, if any)
- Value confidence score: 0.0–1.0

**Confidence-scoring guidance**:
- `>= 0.8`: Multiple independent evidence sources corroborate the hypothesis; clear user segment identified
- `0.5–0.79`: Some evidence exists but it is indirect or from a small sample
- `< 0.5`: No direct evidence found; hypothesis is speculative; value leg may need a follow-up user research pass

---

### `risk` — Risk / Blast Radius

**Purpose**: Identify what could go wrong — technically, operationally, and organizationally — and whether any deal-killers exist beyond the one declared in the charter.

**When to include**: Always include for Tier 2/3 candidates. Optional for Tier 1 when `risk_level` is already assessed as low.

**Recommended subagent**: `backend-architect` (primary) or `data-layer-expert`

**Question template**:
> "What are the top risks of building [idea]? Consider: data migration impact, backward-compatibility constraints, performance implications, blast radius for existing features, operational complexity increase, and organizational risks (cross-team dependencies, third-party constraints). Assess the charter's declared `deal_killer` and confirm or refute it."

**Expected output shape**:
- Risk register: table of risks with severity (`critical | high | medium | low`), likelihood, and mitigation
- Deal-killer assessment: confirm, refute, or surface additional deal-killers
- Blast-radius map: which existing features or data could be affected
- Risk confidence score: 0.0–1.0 (confidence that the risk picture is complete, not that risk is low)

**Confidence-scoring guidance**:
- `>= 0.8`: Risks are enumerated with concrete mitigations; no unknown-unknown categories remain
- `0.5–0.79`: Risks identified but some mitigations are speculative or incomplete
- `< 0.5`: Significant unknowns in the risk picture; do not proceed to `go` verdict without resolving

---

### `prior-art` — Comparable Prior Art

**Purpose**: Surface existing internal or external solutions — similar past features in this codebase, comparable artifacts in the SkillMeat collection, open-source patterns, or industry precedents — to avoid re-inventing and to establish an estimation anchor.

**When to include**: Include when no H5 anchor exists (the technical leg reports no comparable past feature). Optional when the technical leg already surfaces a strong internal anchor.

**Recommended subagent**: `search-specialist` (primary) or `docs-seeker`

**Question template**:
> "Find comparable existing solutions for [idea]: (1) internal — search this codebase and planning history for features with similar data contracts, UX patterns, or service logic; (2) external — search for open-source libraries, industry patterns, or published approaches. For each, assess: how close is the match? What is the delta? Can we reuse or adapt rather than build from scratch?"

**Expected output shape**:
- Internal matches: list of comparable past features with similarity score and delta description
- External matches: open-source options or published patterns with adoption assessment
- Recommended anchor: the single best H5 comparable with justification
- Build-vs-adapt recommendation and confidence

**Confidence-scoring guidance**:
- `>= 0.8`: Strong internal or external anchor found with clear delta analysis
- `0.5–0.79`: Partial match found; delta is significant but estimable
- `< 0.5`: No close analog found; estimation will be speculative; flag this explicitly in the feasibility brief

---

## Composing Legs

### How many legs to run

| Scenario | Recommended legs |
|----------|-----------------|
| Greenfield capability, high uncertainty, Tier 3 candidate | All four legs |
| Known capability area, main question is scope/risk, Tier 2 | `technical` + `risk` (+ `value` if desirability is uncertain) |
| Infrastructure or internal tooling change, no user-facing impact | `technical` + `risk` |
| Enhancement to existing well-understood feature | `technical` alone (or skip exploration entirely) |
| Idea with no internal precedent and uncertain market demand | `technical` + `value` + `prior-art` |

**Minimum**: One leg (typically `technical`). Running zero legs defeats the purpose of the charter.

**Default**: Run `technical` + `risk` for any Tier 2/3 candidate. Add `value` when desirability is uncertain. Add `prior-art` when no H5 anchor exists.

### What skipping a leg signals

| Skipped leg | Signal |
|-------------|--------|
| `technical` | The technical shape is fully understood from existing code; no new patterns required |
| `value` | The feature is internal infrastructure with no direct user-facing impact, or value is already established by prior research |
| `risk` | The change is fully additive (no existing code paths modified, no migration required); only appropriate for strictly greenfield additions |
| `prior-art` | A strong H5 anchor already exists from the technical leg; no need for separate prior-art research |

**Anti-pattern**: Skipping all legs to save time then synthesizing a verdict from the charter hypothesis alone. The synthesis phase requires at least one leg's output; a charter-only verdict is not a feasibility brief.

### Parallelism

Legs run in parallel by default. The `/plan:explore` command spawns one Task per leg simultaneously. Use `--sequential` only when:
- A later leg depends on the output of an earlier leg (e.g., `prior-art` needs the `technical` leg's list of integration points to search against)
- Token or rate-limit constraints make parallel execution impractical

---

## Synthesis Input Requirements

The synthesis phase (Phase 3) assembles the feasibility brief from leg outputs. Each leg must deposit its output in `docs/project_plans/exploration/[idea-slug]/spikes/[leg-id]-findings.md` before synthesis begins.

Synthesis cannot proceed until:
- All expected leg outputs are present (or explicitly marked `partial` with reason)
- The charter `timebox_days` has not been exceeded
- Confidence scores are populated for each leg

If a leg times out or returns empty: mark the leg `partial` with a note, proceed with synthesis, and surface the gap explicitly in the feasibility brief's Investigation Summary table.
