---
schema_name: ccdash_document
schema_version: 2

doc_type: spec
doc_subtype: artifact_structure_spec
root_kind: project_plans

title: "Human Brief Artifact Structure Spec"
status: draft
category: specs

feature_slug: human-brief-spec
owner: nick

created: 2026-04-23
updated: 2026-04-23

related_documents:
  - .claude/specs/artifact-structures/ccdash-doc-structure.md
  - .claude/skills/artifact-tracking/schemas/field-reference.md
  - .claude/specs/doc-policy-spec.md
  - .claude/specs/artifact-structures/skill-spec-convention.md

tags: [spec, artifact-structure, human-brief, planning]
---

# Human Brief Artifact Structure Spec

**Version**: 1.0  
**Scope**: `docs/project_plans/human-briefs/` — one file per feature/Epic  
**Enforcement**: Opt-in per feature; required when creation heuristic fires (see §4)

---

## 1. Purpose and Problem

Implementation plans and PRDs serve agents first. As a result they accumulate content that is
high-signal for human orchestrators but low-signal for executing agents — estimation rationale,
critical-path narrative, open-question inventories, orchestration hints, and observable success
behaviors. Loading this content into agent context wastes tokens and dilutes focus.

The `human_brief` doc type extracts that human-orchestrator lens into a dedicated living document,
keeping plans lean and agent-friendly while giving human planners a single reference pane for
the "how do I run this?" layer of a feature.

**Relationship to existing types**:

| Doc Type | Primary Audience | Source of Truth For |
|----------|-----------------|---------------------|
| `prd` | Human + agent | Requirements, goals, acceptance criteria |
| `implementation_plan` | Agent | Task tables, phase structure, quality gates |
| `human_brief` | Human orchestrator | Estimation rationale, wave strategy, OQ ledger, success behaviors |

---

## 2. Frontmatter Schema

### 2.1 Full Schema

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: human_brief
doc_subtype: ""            # optional: epic_brief | feature_brief | meta_brief
root_kind: project_plans

id: ""                     # optional stable ID, e.g. BRIEF-feature-slug
title: ""
status: draft              # enum: draft | in-progress | completed (see §3)
category: human-briefs

feature_slug: ""           # kebab-case, matches PRD/plan feature_slug exactly
feature_family: ""         # versionless slug (omit -v1 suffix)
feature_version: ""        # e.g. v1

# Linkage — all nullable; briefs are opt-in
prd_ref: ""                # slug or relative path to PRD
plan_ref: ""               # slug or relative path to implementation plan
intent_ref: ""             # RESERVED — forward-compat for INTENT.md system; leave null
epic_ref: ""               # RESERVED — forward-compat for Epic-level INTENT.md; leave null

related_documents: []      # list of related briefs, SPIKEs, design specs

owner: ""
contributors: []

audience: [humans]         # REQUIRED — signals agents to skip this file

priority: medium           # enum: low | medium | high | critical
confidence: 0.0            # 0..1 — orchestrator's confidence in the plan

created: ""                # ISO date YYYY-MM-DD
updated: ""                # ISO date YYYY-MM-DD
target_release: ""         # e.g. 2026-Q3

tags: [human-brief]
```

### 2.2 Field Notes

**`audience: [humans]`** — Mandatory. This is the machine-readable signal that agents invoked
for implementation or review tasks must not load this file (see §5).

**`prd_ref` / `plan_ref`** — Required when a linked PRD or plan exists. Nullable only for
meta-work briefs that have no corresponding PRD.

**`intent_ref` / `epic_ref`** — Reserve these fields now; do not populate until the INTENT.md
system is designed. They provide the forward-compat seam so briefs link cleanly into that future
layer without a schema migration.

**`status`** — Reuses the existing lifecycle. See §3. `blocked` is intentionally excluded: briefs
are not execution artifacts and cannot be blocked in the operational sense.

**No `-v1` suffix on filenames** — Unlike PRDs and implementation plans, briefs are living
documents tied to a feature, not versioned deliverables. The file evolves with the feature.

---

## 3. Status Lifecycle

Briefs reuse the existing status enum. No new values are added.

```
draft → in-progress → completed
```

| Status | Meaning for a Brief |
|--------|---------------------|
| `draft` | Skeleton created; sections not yet populated |
| `in-progress` | Actively maintained during feature execution |
| `completed` | Feature shipped; brief archived in place |

`blocked`, `superseded`, `approved` are valid enum values in the global schema but are not
used for `human_brief` docs. Do not set them.

---

## 4. When to Create a Brief

Briefs are opt-in. Apply the following heuristic:

**Create a brief when any of these are true:**
- Feature is ≥8 story points estimated
- Implementation plan has ≥2 phases
- `## Estimation Sanity Check` block would be non-trivial (i.e., anchor comparison exists)
- ≥2 deferred items with non-trivial rationale
- Feature spans ≥2 capability areas (e.g., backend + frontend + infra)
- Feature has notable orchestration complexity (wave coordination, cross-team dependencies)

**Skip a brief when all of these are true:**
- Quick feature (<5 story points, single phase)
- Trivial refactor with no estimation uncertainty
- Single-file bug fix or patch

---

## 5. Agent Consumption Rule

**Agents invoked for implementation, review, or execution tasks MUST NOT load `human_brief`
files unless the task prompt explicitly names the brief.**

Rationale: Briefs contain human-orchestrator narrative. This content is irrelevant to
implementation subagents and costs context budget without improving output quality.

Enforcement mechanism — three layers:
1. `audience: [humans]` frontmatter flag (machine-readable skip signal)
2. This spec, referenced from the planning skill SKILL.md token-discipline section (proposed — see §9)
3. CLAUDE.md Documentation Policy note directing agents to skip `docs/project_plans/human-briefs/` during execution (proposed — see §9)

**Exception**: An agent may be explicitly asked to *populate* an initial brief skeleton extracted
from a plan, or to append a note to the Running Log section. In both cases, the task prompt
must name the brief file explicitly.

---

## 6. Canonical Path and Naming

```
docs/project_plans/human-briefs/[feature-slug].md
```

- **`[feature-slug]`** matches `feature_slug` in the linked PRD/plan exactly
- **Flat directory** — no category subdirs; briefs are per-feature lenses
- **No `-v1` suffix** — brief is a living doc, not a versioned deliverable
- **One brief per feature** — do not create phase-level briefs; briefs span the full feature

Examples:
```
docs/project_plans/human-briefs/agent-artifact-discovery.md
docs/project_plans/human-briefs/enterprise-tier-comparison-scopes.md
docs/project_plans/human-briefs/dvcs-branching.md
```

---

## 7. Linkage Contract

**From PRD/plan to brief**: PRDs and implementation plans gain an optional `human_brief_ref`
frontmatter field. When a brief exists, add:
```yaml
human_brief_ref: "docs/project_plans/human-briefs/[feature-slug].md"
```

**From brief to PRD/plan**: Brief carries `prd_ref` and `plan_ref` in frontmatter.

**Requirement**: No forced linkage. Briefs are opt-in. A plan without `human_brief_ref` is
valid. A brief without a plan (e.g., for exploratory meta-work) is valid with null `plan_ref`.

---

## 8. Required Sections and Skeleton

Size discipline: **target ≤300 lines; hard cap 500 lines**. Prefer pointers over restatement.
If a section would push the brief past 500 lines, extract to a linked appendix file in the same
directory (e.g., `[feature-slug]-estimation-appendix.md`) and add a one-line pointer.

Each section heading is required. Sections may contain `_None identified._` when empty rather
than being omitted — this confirms the section was considered, not skipped.

```markdown
# [Feature Name] — Human Brief

> Living document for human orchestrators. Agents: do not load unless explicitly instructed.
> Status: [draft|in-progress|completed] | Updated: YYYY-MM-DD

---

## 1. Context Pointers

One-line pointers. Do not restate content.

- **PRD**: `docs/project_plans/PRDs/[feature-slug]-prd.md`
- **Plan**: `docs/project_plans/implementation_plans/[feature-slug]-plan.md`
- **Design Specs**: _(link or "None")_
- **SPIKEs**: _(link or "None")_
- **Related Briefs**: _(link or "None")_

---

## 2. Estimation Sanity Check

_Migrated from implementation plan. Human-authored; not agent-relevant._

**Bottom-up total**: X pts / Y engineer-weeks  
**Top-down anchor**: [Comparable past feature] took Z weeks with similar scope  
**Reconciliation**: [1–3 sentences explaining discrepancy or agreement]

H1–H6 heuristic application:
- **H1 (scope clarity)**: ...
- **H2 (tech risk)**: ...
- **H3 (integration surface)**: ...
- **H4 (team familiarity)**: ...
- **H5 (external dependencies)**: ...
- **H6 (test/QA overhead)**: ...

---

## 3. Wave & Orchestration Notes

_Critical path narrative and parallelization hints. Plan owns the phase summary table._

**Critical path**: [Narrative — which phases/tasks gate everything else]  
**Parallel opportunities**: [What can run concurrently and why]  
**Merge order**: [Any ordering constraints on PR merges or branch integration]  
**Cross-feature coupling**: [Dependencies on other in-flight features]

---

## 4. Open Questions Ledger

_Pointer inventory across PRD, plan, design specs, and SPIKE findings. Update status as resolved._

| ID | Source | Question | Status | Resolved By |
|----|--------|----------|--------|-------------|
| OQ-1 | PRD §3 | ... | open | — |
| OQ-2 | Plan Phase 2 | ... | resolved | commit abc123 |

---

## 5. Deferred Items Rationale

_Why items were deferred and what would trigger promotion. Plan owns the triage table._

- **[Item name]**: Deferred because [reason]. Promote when [trigger condition].

---

## 6. Risk Narrative

_Orchestrator-facing risk rationale. Plan owns the per-phase risk mitigation table._

- **[Risk name]**: [Why this is risky at the orchestration level; what to watch for in execution]

---

## 7. What to Watch For

_Gotchas, trap-doors, and retrospective hooks for real-time review during execution._

- [Specific gotcha or pattern to monitor]
- [Integration point that historically breaks]
- [Performance or migration risk to verify in staging]

---

## 8. Expected Success Behaviors

_Observable, human-verifiable post-ship outcomes. Not agent acceptance criteria._

- [ ] [UI behavior to verify manually, e.g. "Filter panel persists selection on page reload"]
- [ ] [Metric to inspect, e.g. "p95 latency on /api/v1/artifacts stays <200ms under 50 rps"]
- [ ] [Regression smoke, e.g. "Existing collection import still completes without 422 errors"]

---

## 9. Running Log

_Append-only. Short notes during execution — surprises, pivots, validated assumptions._
_Agents may append here only if explicitly instructed in a task prompt._

- [YYYY-MM-DD] [Note]
```

---

## 9. Full Example

Below is a realistic skeleton for a fictional feature. Content is illustrative; keep real briefs
this tight or tighter.

```markdown
---
schema_name: ccdash_document
schema_version: 2
doc_type: human_brief
root_kind: project_plans
title: "Enterprise Tier Comparison Scopes — Human Brief"
status: in-progress
category: human-briefs
feature_slug: enterprise-tier-comparison-scopes-v1
feature_family: enterprise-tier-comparison-scopes
feature_version: v1
prd_ref: docs/project_plans/PRDs/enterprise-tier-comparison-scopes-v1-prd.md
plan_ref: docs/project_plans/implementation_plans/enterprise-tier-comparison-scopes-v1-plan.md
intent_ref: ""
epic_ref: ""
related_documents: []
owner: nick
audience: [humans]
priority: high
confidence: 0.75
created: 2026-04-23
updated: 2026-04-23
target_release: 2026-Q3
tags: [human-brief, enterprise]
---

# Enterprise Tier Comparison Scopes — Human Brief

> Living document for human orchestrators. Agents: do not load unless explicitly instructed.  
> Status: in-progress | Updated: 2026-04-23

---

## 1. Context Pointers

- **PRD**: `docs/project_plans/PRDs/enterprise-tier-comparison-scopes-v1-prd.md`
- **Plan**: `docs/project_plans/implementation_plans/enterprise-tier-comparison-scopes-v1-plan.md`
- **Design Specs**: `docs/project_plans/design-specs/tier-comparison-wireframes.md`
- **SPIKEs**: None
- **Related Briefs**: None

---

## 2. Estimation Sanity Check

**Bottom-up total**: 18 pts / 4.5 engineer-weeks  
**Top-down anchor**: CIS Wave 1 (discovery API foundation) was 12 pts, took ~3 weeks actual.
Tier comparison adds a UI surface and enterprise DB layer not present in Wave 1 — ~1.5x
multiplier feels defensible.  
**Reconciliation**: Bottom-up and anchor agree within 10%. Acceptable.

H1–H6:
- **H1 (scope clarity)**: Medium — PRD is clear on API contract, UI scope still has 2 open Qs
- **H2 (tech risk)**: Low-medium — enterprise JSONB queries have a known comparator gotcha (memory captured)
- **H3 (integration surface)**: Medium — touches discovery API, collection router, and new UI tab
- **H4 (team familiarity)**: High — same patterns as CIS Wave 1
- **H5 (external deps)**: None
- **H6 (test/QA)**: Medium — enterprise DB integration tests need PostgreSQL fixture; adds ~2 pts

---

## 3. Wave & Orchestration Notes

**Critical path**: Phase 1 (enterprise DB schema + repo) gates Phase 2 (API surface) which gates
Phase 3 (UI). Phases 1 and 2 can partially overlap after schema migration lands.  
**Parallel opportunities**: Frontend skeleton (Phase 3 component structure) can start during
Phase 2 if API contract is frozen in OpenAPI spec first.  
**Merge order**: Schema migration PR must merge before API router PR; router before frontend.
Do not merge all three in the same release window — give one day between schema and API.  
**Cross-feature coupling**: Depends on CIS Wave 1 discovery endpoints (merged). No in-flight conflicts.

---

## 4. Open Questions Ledger

| ID | Source | Question | Status | Resolved By |
|----|--------|----------|--------|-------------|
| OQ-1 | PRD §4 | Should tier comparison surface in the artifact list view or a dedicated compare page? | open | — |
| OQ-2 | PRD §6 | Include bundle-level rollup in comparison scope for v1 or defer? | open | — |

---

## 5. Deferred Items Rationale

- **Bundle-level rollup**: Deferred pending OQ-2 resolution. Promote when PRD §6 is approved and
  we have usage data showing bundle comparison is top-3 user request.
- **CSV export of comparison results**: Deferred — low PRD priority, adds 3 pts. Promote when
  any enterprise customer requests it in feedback.

---

## 6. Risk Narrative

- **JSONB comparator cache poisoning**: Seen in earlier enterprise work (memory item captured).
  High likelihood of surfacing again on new JSONB columns. Mitigation is in the playbook but
  easy to miss in a new engineer's PR — flag this explicitly in PR review checklist.
- **Migration ordering**: PostgreSQL dialect guards required for every new column. If a reviewer
  merges a migration without `op.get_bind().dialect.name` guard the SQLite path silently breaks.
  Add to PR template for this feature.

---

## 7. What to Watch For

- JSONB `@>` operator usage in enterprise repo tests — must be `@pytest.mark.integration`
- Infinite query pagination: grouped views must exhaust all pages before grouping renders correctly
- OpenAPI contract drift: freeze contract before frontend work begins; any later API change requires
  a UI-side patch PR in the same release

---

## 8. Expected Success Behaviors

- [ ] Comparison panel renders for enterprise users without 500 error when >100 artifacts present
- [ ] Tier badge correctly reflects `local` vs `enterprise` edition routing (check DI factory)
- [ ] Existing collection import completes without regression (smoke: `skillmeat add` on a known source)
- [ ] p95 latency on comparison endpoint <300ms at 20 rps against staging enterprise DB

---

## 9. Running Log

- [2026-04-23] Brief created from plan skeleton. OQ-1 and OQ-2 surfaced during estimation review.
```

---

## 10. Precedent Reference

`docs/project_plans/reports/trackers/dvcs-future-work.md` is the closest existing human-facing
tracker in the codebase. It differs from a brief in two ways: it is cross-feature (not scoped
to one PRD/plan) and it is a report-type tracker rather than a living orchestration lens.
The brief borrows its append-only running log convention and pointer-over-restatement discipline.

---

## 11. Proposed Follow-Ups

The changes below are required to fully activate this spec. None are executed here. Each is a
discrete implementation task.

### 11.1 Planning Skill (`artifact-tracking` + `planning`)

- [ ] **Move Estimation Sanity Check block**: Remove `## Estimation Sanity Check` from
  `implementation-plan-template.md`; add equivalent block to a new `human-brief-template.md`
- [ ] **Update planning workflow step 3.5**: Direct sanity check output to brief, not plan.
  Add pointer line near the top of plan template: `**Human Brief**: [path or "None"]`
- [ ] **Add workflow 5 — "Create Human Brief from Plan"**: Brief follows plan authoring and is
  recommended (not required) per §4 heuristic. Document trigger conditions.
- [ ] **Add agent-consumption rule to SKILL.md**: In the token-discipline section, add one bullet:
  "Do not load `docs/project_plans/human-briefs/` files during execution unless the task
  prompt explicitly names the brief file."

### 11.2 Artifact Tracking Skill (`schemas/field-reference.md`)

- [ ] **Add `human_brief` to `doc_type` enum**: Current recognized values listed in
  `field-reference.md` do not include `human_brief`. Add it.
- [ ] **Add canonical path row**: `human_brief` → `docs/project_plans/human-briefs/[feature-slug].md`
- [ ] **Add recognized linkage fields**: `human_brief_ref`, `intent_ref`, `epic_ref` as valid
  optional fields in the planning doc schema. No new status values.

### 11.3 CLAUDE.md

- [ ] **Add one-line pointer in Documentation Policy table**: Add row for `human_brief` under
  the "Product" bucket: `docs/project_plans/human-briefs/` — human-only, one per feature.
- [ ] **Add spec reference**: Under "Specs (load for specific procedures)", add:
  `.claude/specs/artifact-structures/human-brief-spec.md` — Human Brief structure, frontmatter,
  agent-consumption rule.

---

## 12. artifact-structures/ Reorganization Proposal

> **Proposal only — no files moved here.**

### Current State

```
.claude/specs/artifact-structures/
└── ccdash-doc-structure.md          # Base envelope schema; all doc types specialize this
```

### Proposed State

```
.claude/specs/artifact-structures/
├── README.md                        # Index of all schema specs; entry-point for the subdir
├── ccdash-doc-structure.md          # Base envelope (unchanged; becomes the foundational ref)
├── human-brief-spec.md              # This file — human_brief doc type
├── skill-spec-convention.md         # MOVED from .claude/specs/ root
└── skill-spec-template.md           # MOVED from .claude/specs/ root
```

### Rationale

`artifact-structures/` is the natural home for any spec that defines a document schema or
structure — as distinct from process/policy/workflow specs (changelog, version-bump, doc-policy,
multi-model, etc.) which belong at the root level.

`skill-spec-convention.md` and `skill-spec-template.md` define the `SPEC.md` artifact structure
for skills. They are schema/structure specs, not process specs. Moving them completes the subdir's
purpose and removes ambiguity about where to look for "what does a X doc look like?"

### Entry-Point Question

`ccdash-doc-structure.md` defines the base envelope that every doc type in this subdir
specializes. It should be referenced first in `README.md` as the foundational schema, but it
should **not** be renamed to `README.md` — its current name is self-describing and is referenced
by path from other specs. The proposed `README.md` is a lightweight index only (< 30 lines).

### Proposed README.md Content (Illustrative)

```markdown
# artifact-structures/ — Schema Spec Index

Specs in this directory define the structure of document artifacts used in SkillMeat planning,
tracking, and skill authoring.

## Base Schema

- `ccdash-doc-structure.md` — CCDash shared envelope (schema_version 2); all doc types below
  specialize this base

## Document Type Specs

| Spec | doc_type(s) | Path |
|------|-------------|------|
| `human-brief-spec.md` | `human_brief` | `docs/project_plans/human-briefs/` |

## Skill Artifact Specs

| Spec | Purpose |
|------|---------|
| `skill-spec-convention.md` | SPEC.md structure and frontmatter for custom skills |
| `skill-spec-template.md` | Copy-paste template for new SPEC.md files |
```

### Stay at Root (Process/Policy Specs)

The following do not belong in `artifact-structures/` and should remain at `.claude/specs/` root:

`changelog-spec.md`, `version-bump-spec.md`, `doc-policy-spec.md`, `multi-model-usage-spec.md`,
`project-tracking-spec.md`, `claude-fundamentals-spec.md`, `ui-package-extraction-spec.md`,
`db-first-artifact-listing-spec.md`, `cli-reference-generation-spec.md`, `skills-index.md`

### Implementation Note

Moving `skill-spec-convention.md` and `skill-spec-template.md` requires updating all files that
reference them by path. Known references: `skills-index.md`, `CLAUDE.md` specs section,
skill SPEC.md files that list them as `related_documents`. Run a grep before moving:
`grep -r "skill-spec-convention\|skill-spec-template" .claude/ docs/` to enumerate all
reference sites and update them in the same PR as the move.
