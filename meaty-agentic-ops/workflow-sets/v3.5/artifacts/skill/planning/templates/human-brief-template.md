---
schema_name: ccdash_document
schema_version: 2

doc_type: human_brief
doc_subtype: ""            # optional: epic_brief | feature_brief | meta_brief
root_kind: project_plans

id: ""                     # optional stable ID, e.g. BRIEF-feature-slug
title: "[Feature Name] — Human Brief"
status: draft              # draft | in-progress | completed
category: human-briefs

feature_slug: ""           # kebab-case, matches PRD/plan feature_slug exactly
feature_family: ""         # versionless slug (omit -v1 suffix)
feature_version: ""        # e.g. v1

prd_ref: ""                # slug or relative path to PRD
plan_ref: ""               # slug or relative path to implementation plan
intent_ref: ""             # RESERVED — forward-compat for INTENT.md system; leave null
epic_ref: ""               # RESERVED — forward-compat for Epic-level INTENT.md; leave null

related_documents: []      # related briefs, SPIKEs, design specs

owner: ""
contributors: []

audience: [humans]         # REQUIRED — signals agents to skip this file

priority: medium           # low | medium | high | critical
confidence: 0.0            # 0..1 — orchestrator's confidence in the plan

created: ""                # YYYY-MM-DD
updated: ""                # YYYY-MM-DD
target_release: ""         # e.g. 2026-Q3

tags: [human-brief]
---

# [Feature Name] — Human Brief

> Living document for human orchestrators. Agents: do not load unless explicitly instructed.
> Status: draft | Updated: YYYY-MM-DD

---

## 1. Context Pointers

One-line pointers. Do not restate content.

- **PRD**: `docs/project_plans/PRDs/[category]/[feature-slug]-v1.md`
- **Plan**: `docs/project_plans/implementation_plans/[category]/[feature-slug]-v1.md`
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

**Critical path**: [Which phases/tasks gate everything else]
**Parallel opportunities**: [What can run concurrently and why]
**Merge order**: [Ordering constraints on PR merges or branch integration]
**Cross-feature coupling**: [Dependencies on other in-flight features]

---

## 4. Open Questions Ledger

_Pointer inventory across PRD, plan, design specs, and SPIKE findings. Update status as resolved._

| ID | Source | Question | Status | Resolved By |
|----|--------|----------|--------|-------------|
| OQ-1 | PRD §? | ... | open | — |

---

## 5. Deferred Items Rationale

_Why items were deferred and what would trigger promotion. Plan owns the triage table._

- **[Item name]**: Deferred because [reason]. Promote when [trigger condition].

_None identified._

---

## 6. Risk Narrative

_Orchestrator-facing risk rationale. Plan owns the per-phase risk mitigation table._

- **[Risk name]**: [Why this is risky at the orchestration level; what to watch for in execution]

_None identified._

---

## 7. What to Watch For

_Gotchas, trap-doors, and retrospective hooks for real-time review during execution._

- [Specific gotcha or pattern to monitor]

_None identified._

---

## 8. Expected Success Behaviors

_Observable, human-verifiable post-ship outcomes. Not agent acceptance criteria._

- [ ] [UI behavior to verify manually]
- [ ] [Metric to inspect]
- [ ] [Regression smoke to run]

---

## 9. Running Log

_Optional. Append-only. Short notes during execution — surprises, pivots, validated assumptions._
_Agents may append here only if explicitly instructed in a task prompt._

- [YYYY-MM-DD] Brief created.
