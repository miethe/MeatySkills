---
title: "Feature Contract: [Feature Name]"
schema_version: 2
doc_type: feature_contract
status: draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
feature_slug: "feature-name"
category: "features"
estimated_points: 5
tier: 1
owner: null
priority: medium
risk_level: low
changelog_required: false
related_documents: []
spike_ref: null
prd_ref: null
plan_ref: null
commit_refs: []
pr_refs: []
files_affected: []
---

# How To Use This Template

This template is for **Tier 1 features (3–8 points)**. Copy this file to `docs/project_plans/feature_contracts/[category]/[slug].md`, fill in each section, then:

1. Submit for review (Opus design block + brief sanity pass).
2. Once approved, delegate the entire contract to a single `feature-sprint-executor` agent for autonomous implementation.
3. Mandatory `task-completion-validator` review of the completion report against acceptance criteria and validation requirements.
4. Opus commits if review passes.

If the feature grows beyond 8 points during contract review, **promote to Tier 2** by authoring a PRD and Implementation Plan instead of retrofitting this contract. Don't try to stretch Tier 1 for genuinely complex work.

---

# Feature Contract: [Feature Name]

## 1. Goal

<!-- guidance: Write one clear, concise statement of what should be built. This is the North Star. It should answer "What does done look like?" in one sentence. -->

[One sentence describing the feature goal]

---

## 2. User / Actor

<!-- guidance: Identify who benefits from this feature. Be specific about the user role or actor (end user, admin, developer, etc.). -->

- **Primary user**: [User role and context]
- **Secondary users** (if applicable): [Other roles or actors]

---

## 3. Job To Be Done

<!-- guidance: Follow the "When [situation], the user wants to [action], so they can [outcome]" template. Explain the motivation, not just mechanics. -->

When **[situation/context]**, the user wants to **[take action]**, so they can **[achieve outcome or benefit]**.

---

## 4. Scope

### In Scope

<!-- guidance: List specific features, components, or behaviors that this contract covers. Be concrete. -->

- [Feature/component 1]
- [Feature/component 2]
- [Feature/component 3]

### Out of Scope

<!-- guidance: Explicitly list what is NOT part of this feature. This prevents scope creep during implementation. -->

- [Deliberately excluded area 1]
- [Deliberately excluded area 2]
- [Future work / related but separate feature]

---

## 5. UX / Behavior Requirements

<!-- guidance: Describe how the feature behaves from the user's perspective. Include interaction flow, UI states, error handling, and any special cases. Be observable and testable. -->

- [Requirement 1: What the user sees/does]
- [Requirement 2: How the system responds]
- [Requirement 3: Edge case or error state handling]
- [Requirement 4: Optional/advanced behavior]

---

## 6. Data Requirements

<!-- guidance: Describe what data needs to exist, change, or be stored. Include entity definitions, new fields, state mutations, and any schema implications. -->

- **Entities affected**: [List entities that change]
- **New fields** (if any): [Field name, type, constraints]
- **State changes**: [What state transitions occur]
- **Storage implications**: [Any schema migrations, new tables, or index needs]

---

## 7. API / Integration Requirements

<!-- guidance: Document all endpoints, external service calls, or integration points. Include request/response schemas if known, or pointer to contracts if defined elsewhere. -->

**New or modified endpoints:**
- [Endpoint method and path] - [Brief description]
- [Endpoint method and path] - [Brief description]

**External service calls** (if any):
- [Service name] - [What operation, frequency, error handling]

**Internal service dependencies:**
- [Service/module] - [What capability is needed]

---

## 8. Architecture Constraints

<!-- guidance: Explain what existing patterns must be followed, what areas are protected, and what new dependencies (if any) are acceptable. -->

**Must follow existing patterns in:**
- [File/module/pattern]
- [File/module/pattern]

**Must not change** (protected areas):
- [Protected component or API]
- [Protected behavior or schema]

**New dependencies:**
- Allowed? **[Yes / No]**
- If yes, justify: [Justification]
- If no constraints on new deps, state: *No new dependencies expected.*

---

## 9. Acceptance Criteria

<!-- guidance: List observable, testable outcomes that prove the feature is complete. Use checkboxes. Each criterion should be verifiable without ambiguity. -->

- [ ] [Observable outcome 1 — describe what is true when complete]
- [ ] [Observable outcome 2]
- [ ] [Observable outcome 3]
- [ ] [Observable outcome 4 — include UX behavior if applicable]
- [ ] [Observable outcome 5 — include error/edge case handling if applicable]

---

## 10. Validation Requirements

<!-- guidance: List the specific checks that must pass before the feature is considered complete. Reference the project's validation guide (docs/validation.md or CLAUDE.md validation section). -->

- [ ] **Typecheck** passes (`tsc --noEmit` or equivalent)
- [ ] **Lint** passes (flake8, eslint, etc.)
- [ ] **Tests** added or updated for meaningful behavior
- [ ] **Relevant tests pass** (unit, integration, or E2E)
- [ ] **Build** passes (`npm run build`, `pytest`, etc.)
- [ ] **Docs updated** (if needed: README, API docs, CHANGELOG, or architecture docs)
- [ ] **No unrelated changes** introduced

---

## 11. Risk Areas

<!-- guidance: Identify areas where things could go wrong, unexpected complexity could hide, or cross-cutting impacts exist. Be specific. -->

- **[Risk area 1]**: [Why it's risky, what could go wrong]
- **[Risk area 2]**: [Why it's risky, mitigation if known]
- **[Risk area 3]** (if applicable): [Cross-cutting concern or dependent system]

---

## 12. Implementation Notes

<!-- guidance: Optional suggested path or hints. The executing agent may propose improvements if justified. Include pointers to similar code, existing patterns, or gotchas. -->

**Suggested approach** (agent may improve):
- [Step 1: What to start with]
- [Step 2: What to implement next]
- [Step 3: How to validate]

**Similar existing code**:
- Reference: [Path to similar implementation or pattern]
- Reason: [Why to follow this pattern]

**Known gotchas**:
- [Gotcha 1 if any are known]
- [Gotcha 2 if any are known]

---

## 13. Completion Report Required

The executing agent must produce a Completion Report including:

- **Files changed**: List of all modified/new files with brief reason
- **Tests run**: What tests were added/updated and results
- **Validation results**: Table of all validation commands and their results (pass/fail/not applicable)
- **Deviations from contract**: Any material changes to the contract during implementation and why
- **Risks / Limitations**: Any remaining risks or known limitations
- **Follow-up recommendations**: Suggested next steps or follow-on work

See `.claude/skills/dev-execution/validation/completion-criteria.md` for the full Completion Report template.

---

## Metadata & References

**Tier**: 1 (3–8 points)

**Execution Mode**: Autonomous Feature Sprint (Mode C) — single sprint to completion, no phase orchestration

**Reviewer**: `task-completion-validator` (mandatory)

**Related Documents**:
- [Link to relevant architecture docs, if any]
- [Link to design specs, prototypes, or related PRDs, if any]
- [Link to existing similar features or patterns]

---

## Notes for Agents

This contract is your specification. Implement to satisfy the acceptance criteria and pass validation. If you find:

- **Scope ambiguity**: Ask one focused question or make a conservative assumption and note it in the Completion Report.
- **Impossible constraints**: Flag in the Completion Report before attempting workarounds.
- **Better implementation path**: Document the deviation in the Completion Report with justification.

Stay within scope. Avoid cleanup, refactors, or feature expansion beyond this contract. The reviewer will check for scope drift.
