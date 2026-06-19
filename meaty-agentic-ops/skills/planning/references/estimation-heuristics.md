# Estimation Heuristics

Practical rules for sizing PRDs and implementation plans more accurately. Apply these **bottom-up** before locking a top-level estimate. If the bottom-up sum disagrees with the top-down "feels like a Medium" intuition, **trust the bottom-up sum**.

These heuristics were extracted from a post-mortem on `ica-team-features-filtering-v1` (estimated 8.5 pts, landed ~3–4×). The failure modes are general; the rules below apply to any plan that introduces multiple new domain entities, dual implementations, or algorithmic services.

## Quick Sanity Checks (run before locking the estimate)

For every plan, the author MUST be able to answer these in writing in the plan's "Estimation Sanity Check" subsection:

1. **Noun count**: How many new domain nouns (tables / first-class entities with CRUD) does this plan introduce?
2. **Layer multiplier**: Does the project use dual-edition (or dual-implementation) repositories? If so, is the multiplier applied?
3. **Algorithmic flag**: Does any service description contain `dependency`, `resolution`, `graph`, `conflict detection`, `cycle`, `solver`, `inference`, `ranking`, or `scheduling`? If yes, has it been SPIKE'd or budgeted as algorithmic?
4. **Bundle decomposition**: If the PRD packages ≥3 capability areas, has the plan estimated each area independently and summed them?
5. **Anchor reference**: Which prior completed feature is the closest analog, what did it actually cost, and is this estimate within ±30% of that?
6. **Huge-file touch**: Does any task touch a file >2K lines? If yes, is the 2× multiplier applied and the file listed in High-Friction Surfaces?

If any answer is "no" or "haven't checked," the estimate is not ready to lock.

## The Heuristics

### H1 — Noun-Counting Rule

> **~2 pts per new CRUD-with-RBAC domain noun**, before cross-cutting features.

A "domain noun" is a new database table that owns a first-class concept (favorites, skill_groups, selections, saved_filters — not join tables or audit logs). Each one drags along: DTO pair (request/response), repository (interface + implementations), service with auth checks, router with 3–6 endpoints, OpenAPI schemas, unit + integration tests.

**Application**: 8 new tables → ≥12 pt floor before any algorithmic services or UI.

**When it doesn't apply**: Tables that are purely additive columns on existing entities, log/audit tables with no read API, or simple key/value caches. These are 0.25–0.5 pts each.

### H2 — Dual-Implementation Multiplier

> **When the repo layer requires parallel implementations (e.g., local + enterprise, SQLite + PostgreSQL with divergent SQLAlchemy styles, or v1 + v2 of an API), multiply repository-layer estimates by ~1.8×.**

This codebase requires every repository to ship 3 files: interface ABC + `LocalX` (SQLA 1.x `session.query()`) + `EnterpriseX` (SQLA 2.x `select()` + `_tenant_select()`). Estimating "the repository" as one unit is the most common under-counting failure.

**Application**: 5 repositories at single-impl 0.5 pt each = 2.5 pts → after multiplier = ~4.5 pts.

**When it doesn't apply**: Pure local-edition or pure enterprise-edition features, or features that only touch existing repository methods.

### H3 — Algorithmic Service Flag

> **Any service whose description contains `dependency`, `resolution`, `graph`, `conflict detection`, `cycle`, `solver`, `inference`, `ranking`, `scheduling`, `merge`, `diff`, or `transform` should either be SPIKE'd first or budgeted at 3+ pts with an explicit fixture/test list.**

These services have algorithmic surface area (correctness invariants, edge cases, performance constraints) that doesn't compress into a "stateless service" line item. The implementation cost is dominated by the test matrix, not the happy path.

**Application**: A "stateless dependency resolver with cycle detection and version conflicts" is **never** 1.25 pts. It's 3–5 pts standalone, often with a SPIKE precursor.

**Required when flagged**: List the specific test scenarios in the task acceptance criteria (diamond dep, version range overlap, cycle, missing prereq, incompatibility flag, etc.). If you can't enumerate ≥5 scenarios, you don't understand the surface yet — SPIKE first.

### H4 — Bundle-vs-Sum Check

> **When a PRD packages ≥3 capability areas under one slug, the plan total must be ≥ Σ(per-area estimates), not a rounded-down "package price."**

Bundling related capabilities into one PRD for cohesion is good. But the bundling does **not** compress per-area work — each area still needs its own tables, services, endpoints, and tests. The "package price" anchoring effect (top-level "Medium, 8 pts" then back-solving the phase table to fit) is the most insidious failure mode.

**Application**: Plans bundling ≥3 capability areas must include a per-area estimate table:

| Capability Area | Independent Estimate | Notes |
|-----------------|---------------------|-------|
| A | 2 pts | — |
| B | 1.5 pts | shares DTO with A |
| C | 3 pts | algorithmic (H3) |
| ... | ... | ... |
| **Σ** | **floor for plan total** | |

Plan total ≥ Σ. Any compression below Σ requires written justification (e.g., "shared DTO between A and B saves 0.5 pts").

### H5 — Anchor Reference Comparison

> **Before locking an estimate, cite one prior completed feature of similar surface area, name its actual cost, and justify any delta >30%.**

The codebase has multiple comparable completed features (e.g., `collections`, `deployment-sets`, `bundles`, `git-connections`). Each is a "table + repo + service + router + tests" backend slice and the actual SP cost is recoverable from CCDash AAR or git history.

**Application**: Add to the plan's Estimation Sanity Check:

```markdown
**Anchor**: `<feature-slug>` (PRD path)
**Anchor actual cost**: <X pts> over <Y weeks>
**Anchor surface**: <N tables, M endpoints, K services>
**This plan surface**: <N tables, M endpoints, K services>
**Estimate delta vs anchor**: <±X%>
**Delta justification**: <one paragraph>
```

If your plan introduces **more** nouns than the anchor but estimates **less**, stop and re-derive bottom-up.

### H6 — Hidden Plumbing Budget

> **Add an explicit ~15–20% line item for "cross-cutting plumbing": DTOs, DI factory wiring, feature-flag branches, OpenAPI schema regeneration, RLS policies, endpoint inventory updates, CHANGELOG entries.**

These tasks are real, recurring, and routinely glossed in trailing bullets ("OpenAPI schema," "feature flag gating," "RBAC checks"). On a 12-pt feature, plumbing is 2 pts of work that nobody estimated.

**Application**: After summing per-phase estimates, add a "Cross-Cutting Plumbing" row at ~15–20% of subtotal. Prefer estimating it once at the plan level over scattering 0.1-pt fragments across every router task.

### H7 — Huge-File Touch Multiplier

> **Any task whose `files_affected` includes a file >2K lines costs ≥2× its point estimate in agent dispatches** — even for additive or localized edits.

This is distinct from the whole-file-refactor Tier-2 override in `planning/SKILL.md` (which exempts in-place edits). A giant file forces repeated grep/sed navigation and is the dominant driver of context-blows and fix-cycles.

**Application**: `wc -l` every file in scope at planning time. List files >2K lines in a plan-level **"High-Friction Surfaces"** note. Apply a ≥2× multiplier to each task touching one, and mandate the anti-blow guardrail prompt block (do-not-read-whole, grep -n + sed only, budget ≤40 tool uses, STOP-and-report-partial — see `.claude/specs/workflows/large-file-refactor-decomposition-spec.md`) for those tasks. Evidence: a ~5,100-line router drove 2-4× per task across an entire Tier-3 plan.

## Anti-Patterns

| Anti-Pattern | Symptom | Fix |
|--------------|---------|-----|
| Top-down anchoring | Plan total set first, phase table back-solved to fit | Bottom-up only; phase table sums to plan total, not vice versa |
| Endpoint compression | "8 routers, 32 endpoints, 2 pts" (~0.06 pt/endpoint) | ≥0.25 pt per CRUD endpoint group; ≥0.5 pt per algorithmic endpoint |
| Single-impl assumption | Repo estimates ignore local+enterprise split | Apply H2 multiplier |
| Algorithmic glossing | "Stateless service that resolves dependencies" at <2 pts | Apply H3; enumerate test scenarios or SPIKE |
| Capability bundling | 7 capability areas, 8.5 pt total | Apply H4; per-area sum is the floor |
| No anchor | "Feels like a Medium" | Apply H5; cite a comparable completed feature |
| Plumbing omission | DTOs, DI, OpenAPI, RLS implicit in "etc." | Apply H6; explicit 15–20% line item |
| Huge-file glossing | Task touching a 5k-line file estimated at face points | Apply H7; 2× multiplier + High-Friction Surfaces note |

## Estimation Sanity Check Template

Insert this section into every implementation plan immediately after the Phase Summary table.

```markdown
### Estimation Sanity Check

**Noun count (H1)**: <N> new domain nouns → ≥<N×2> pt floor
**Dual-impl multiplier (H2)**: <applied? Y/N — if N, why not>
**Algorithmic flag (H3)**: <list any flagged services and budgeted pts>
**Bundle decomposition (H4)**:
  | Area | Independent Est. | Notes |
  |------|-----------------|-------|
  | ...  | ...             | ...   |
  | **Σ** | **<X> pts**    |       |
**Anchor (H5)**: <feature-slug> cost <X pts>; this plan delta <±Y%>; justification: <...>
**Plumbing budget (H6)**: <X pts> (~<Y%> of subtotal)
**Huge-file touch (H7)**: <files >2K lines in scope + 2× applied? Y/N>

**Bottom-up total**: <X pts>
**Top-down intuition**: <Y pts>
**Locked estimate**: <Z pts> (if Z < bottom-up, write justification below)
```

## When to Re-Apply These Heuristics

- **Pre-implementation**: Always, before locking the plan estimate.
- **Mid-flight**: If a phase comes in >50% over its estimate, re-run the heuristics on remaining phases.
- **Post-completion**: Run a `plan-review` (see `plan-review` skill) on every completed plan ≥5 pts. Update anchors and tune heuristic constants if a pattern emerges across ≥3 retrospectives.

## Related References

- `.claude/skills/planning/references/subagent-assignments.md` — Agent assignments per task type.
- `.claude/skills/planning/references/multi-model-guidance.md` — Model routing.
- `.claude/skills/plan-review/SKILL.md` — Post-implementation retrospective workflow that feeds heuristic tuning.
