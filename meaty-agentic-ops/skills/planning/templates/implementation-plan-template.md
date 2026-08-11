---
title: "Implementation Plan: Feature Name" # Human-readable implementation plan title
schema_version: 2 # CCDash frontmatter schema version
doc_type: implementation_plan # Must remain `implementation_plan`
it_schema: 1 # Plan-frontmatter schema version (.claude/skills/planning/references/plan-frontmatter-schema.md). MUST.
status: draft # draft|planning|in-progress|review|completed|superseded
created: YYYY-MM-DD # Initial creation date (YYYY-MM-DD)
updated: YYYY-MM-DD # Last edit date (YYYY-MM-DD)
feature_slug: "feature-name" # Kebab-case feature identifier
feature_version: "v1" # Version label for this feature document set
tier: 2 # 0|1|2|3 complexity/routing tier. MUST.
prd_ref: /docs/project_plans/PRDs/category/feature-name-v1.md # Parent PRD path (required)
plan_ref: null # Root implementation plan should be null
scope: "Describe implementation boundary in one sentence" # Scope summary used in dashboards
effort_estimate: "TBD" # Total effort estimate (points/days)
architecture_summary: null # Optional high-level architecture summary
related_documents: [] # Related docs (PRD, ADRs, diagrams, specs)
references:                    # Categorized reference paths for execution workflows
  user_docs: []                # User-facing docs relevant to this feature
  context: []                  # Agent context files (.claude/context/key-context/)
  specs: []                    # Spec files (.claude/specs/)
  related_prds: []             # Related PRD paths or progress directories
spike_ref: null          # Set after SPIKE research
adr_refs: []             # Add as decisions are made
deferred_items_spec_refs: [] # Design specs authored for deferred/research items (populated during final phase)
findings_doc_ref: null       # Path to .claude/findings/[feature-slug]-findings.md — created lazily on first in-flight finding
charter_ref: null        # Set if charter-driven SPIKE
changelog_ref: null      # Set during doc finalization
changelog_required: true # true if feature has user-facing changes requiring a CHANGELOG entry; false to skip DOC-001
test_plan_ref: null      # Set if formal test plan created
plan_structure: unified  # unified|independent — unified for single plan, independent for multi-week features
progress_init: auto      # auto|pre-created — auto if planning generates progress files, pre-created if done during planning
owner: null # Single accountable owner (name or agent)
contributors: [] # Supporting contributors
priority: medium # low|medium|high|critical
risk_level: medium # low|medium|high|critical
context_class: null # [C1|C2|C3|C4] — sizes AGENT CONTEXT, not behavior. See plan-doctrine.md § Context class / estimation-heuristics.md.
category: "product-planning" # Planning taxonomy label
tags: [implementation, planning, phases, tasks] # Search/filter tags
milestone: null # Optional release/milestone marker
commit_refs: [] # Commit SHAs added during implementation
pr_refs: [] # Pull request refs (e.g., #123)
files_affected: [] # Key files expected to change
# --- Canonical plan-frontmatter schema (it_schema: 1) — structural planning lens fields ---
# Author open_questions and decisions as YAML lists (NOT body prose / linked files). The capture
# pipeline projects these onto the command-center plan-lens. See plan-frontmatter-schema.md §5.4.
planning_maturity: in_progress # idea|scoped|in_progress|shipped — derives from status if absent. SHOULD.
open_questions: [] # SHOULD. List of str, or {q, owner, status}. Primary enrichment target.
decisions: [] # SHOULD. List of {decision, rationale, status}. Canonical home for decisions.
decision_gates: [] # SHOULD. List of {gate, status}; derived from decisions where status=pending.
success_metrics: [] # SHOULD. List of measurable outcomes (CR-3 → Node.meta).
contributors_note: null # (contributors above is the canonical author list)
scores: {} # SHOULD (seed). {strategic_value, urgency, leverage, execution_readiness, risk, ...}. M2 engine owns runtime recompute.
acceptance_criteria: [] # SHOULD (plan-level rollup; per-task AC lives on tasks[] in progress files).
required_artifacts: [] # SHOULD. List of {type, name, skillmeat_ref, status, lifecycle, scope, note}. See plan-frontmatter-schema.md §5.7 + references/required-artifacts-guidance.md. Also settable per-phase under wave_plan.phases[].required_artifacts.
# Agent-facing context (projected onto Node.agent_* columns) — make delegation prompts PR-reviewable:
execution_mode: unassigned # human|agent|hybrid|autonomous|system|unassigned. SHOULD.
agent_title: null # SHOULD. Short delegation title for the feature/phase node.
agent_summary: null # SHOULD. One-line summary for the agent picking up this node.
agent_context: null # SHOULD (md). Context block the executing agent needs.
# Optional: omit for sequential phase-number-ordered execution (safe fallback for Tier 0/1 and strictly sequential Tier 2 plans)
# wave_plan.phases[] entries MAY carry phase-level agent_title/agent_summary/agent_context,
# entry_criteria: [], exit_criteria: [], and node_type (work_package|milestone|...).
# No plan-time model/provider/profile/orchestrator_model pins on phase entries — routing
# constraints (MUST-stay classes, offload-eligibility) live in the decisions block; provider and
# model per leg are resolved at dispatch time by the `delegation-router` skill.
wave_plan:
  serialization_barriers:           # Files that force serialization if written by >1 phase in the same wave
    - skillmeat/api/openapi.json    # Common barriers: openapi.json, CLAUDE.md, README.md, .claude/settings.json
  phases:
    - id: P1
      depends_on: []                # [] = no dependencies; runs in wave 1
      isolation: shared             # shared | worktree (use worktree for migrations, auth, experiments)
      parallelizable: true          # false = force solo wave even when deps allow parallel
      owner_skills: []              # Skills pre-loaded into phase-owner agent (full SKILL.md injected at startup)
      files_affected:               # Files this phase writes; used for serialization-barrier intersection check
        - skillmeat/cache/models/example.py
        - skillmeat/cache/migrations/202605_xx_add_example.py
    - id: P2
      depends_on: [P1]
      isolation: shared
      owner_skills: [skillmeat-cli]
      files_affected:
        - skillmeat/api/routers/example.py
        - skillmeat/api/openapi.json    # touches serialization barrier; will conflict with P3 below
    - id: P3
      depends_on: [P1]
      isolation: worktree               # Mode D risk (auth scope) → isolated branch; commit before returning
      owner_skills: [frontend-design]
      files_affected:
        - skillmeat/web/components/example/example-card.tsx
        - skillmeat/api/openapi.json    # also touches barrier → split from P2 into adjacent wave (pass 2)
    - id: P4
      depends_on: [P2, P3]
      isolation: shared
      files_affected:
        - tests/integration/test_example.py
  waves:                              # Derived: run two-pass algorithm (topological sort → barrier split)
    - [P1]                            # Wave 1: no deps
    - [P2]                            # Wave 2: P2 and P3 would be concurrent but collide on openapi.json
    - [P3]                            # Wave 3: forced to adjacent wave by barrier collision
    - [P4]                            # Wave 4: waits for both P2 and P3
---

# Implementation Plan: [Feature Name]

> **Legacy/expanded template.** New Tier 2/3 plans use
> [`milestone-plan-template.md`](milestone-plan-template.md) — the thin, milestone-first default
> under [`plan-doctrine.md`](../references/plan-doctrine.md). This template remains in use for
> **in-flight plans** authored before the doctrine landed, and as the **dispatch-time task
> expansion** an orchestrator generates from a milestone's AC for economy-class executors — that
> expansion is a render, never stored back into the plan.

> **Model policy:** [`docs/agentic-operator/MODEL-ROUTING.md`](../../../../docs/agentic-operator/MODEL-ROUTING.md) (§1.5 scorecard) is canonical. This template carries no plan-time model or agent pins — routing constraints (MUST-stay classes, offload-eligibility, capability bar) belong in the decisions block, never a model id. Provider/model per leg is resolved at dispatch time by the `delegation-router` skill; the platform skills (`ica-delegate`, `codex`, `gemini-cli`) only execute the decision.

**Plan ID**: `IMPL-{YYYY-MM-DD}-{FEATURE-NAME}`
**Date**: YYYY-MM-DD
**Author**: [Implementation Planner Agent]
**Human Brief**: [path to human brief, or "N/A — not created (feature too small)"]
**Related Documents**:
- **PRD**: `/docs/project_plans/PRDs/[feature-name]-v1.md`
- **ADRs**: [Links to relevant Architecture Decision Records]

**Complexity**: [Small | Medium | Large | XL]
**Total Estimated Effort**: [Total story points]
**Target Timeline**: [Start date] - [End date]

## Executive Summary

[2-3 sentences describing the implementation approach, key milestones, and success criteria]

## Acceptance Criteria

[Observable, checkable criteria this plan must satisfy — the narrative summary. The AC -> command
-> evidence matrix below owns verification detail; do not duplicate per-task AC prose here.]

- [AC-1: ...]
- [AC-2: ...]

## Named Risks

- **[Risk, sharpest first].** [Why it bites, and what the executor should do about it.]
- **[Risk].** [...]

## AC -> command -> evidence

The single home for verification detail. The PRD owns narrative AC; this matrix owns proof.

| AC | Command | Evidence of pass |
|---|---|---|
| [AC-1] | `[exact command]` | [what output proves it] |
| [AC-2] | `[exact command]` | [what output proves it] |

## Implementation Strategy

### Architecture Sequence

Following MeatyPrompts layered architecture:
1. **Database Layer** - Tables, indexes, RLS policies
2. **Repository Layer** - DB I/O, transactions, cursor pagination
3. **Service Layer** - Business logic, DTOs, validation
4. **API Layer** - FastAPI routers, endpoints, OpenAPI docs
5. **UI Layer** - React components from @miethe/ui
6. **Testing Layer** - Unit, integration, E2E
7. **Documentation Finalization** - CHANGELOG, README, context, guides
8. **Deployment Layer** - Feature flags, monitoring, rollout

### Parallel Work Opportunities

[Identify tasks that can be done in parallel to optimize timeline]

### Critical Path

[Identify the critical path that determines overall timeline]

## Deferred Items & In-Flight Findings Policy

### Deferred Items

Deferred items are tasks or features intentionally pushed to a future phase, a backlog, or held pending further research before implementation. They are distinct from scope cuts — they represent work the team acknowledges and plans to track.

**Rule**: Every deferred item MUST have a corresponding design-spec authoring task in the final phase (Documentation Finalization, DOC-006). The resulting design-spec path is appended to `deferred_items_spec_refs` in this plan's frontmatter.

#### Deferred Items Triage Table

| Item ID | Category | Reason Deferred | Trigger for Promotion | Target Spec Path |
|---------|----------|-----------------|-----------------------|-----------------|
| — | — | — | — | — |

*Populate during planning. Categories: `research-needed`, `scope-cut`, `backlog`, `spike-needed`, `dependency-blocked`.*

### In-Flight Findings

Findings are discoveries made during execution: plan/reality mismatches, unexpected bugs or gotchas, schema gaps, or constraints not visible at planning time.

**Lazy-creation rule**: The findings doc is NOT pre-created. Create it only on the FIRST real finding (this should be rare). Path: `.claude/findings/[feature-slug]-findings.md`.

**On creation**:
1. Set `findings_doc_ref` in this plan's frontmatter to the new path
2. Append the path to `related_documents`
3. If the finding is load-bearing (affects scope, architecture, or acceptance criteria), add a new design-spec authoring task row (DOC-006) in the Documentation Finalization phase and append the resulting spec path to `deferred_items_spec_refs`

### Quality Gate

The final phase (Documentation Finalization) cannot be sealed until:
- All deferred items have a design-spec path in `deferred_items_spec_refs`, OR are explicitly marked N/A with rationale in the triage table
- If `findings_doc_ref` is populated: findings doc finalized and status advanced from `draft` → `accepted`

**Reference**: `.claude/skills/planning/references/deferred-items-and-findings.md`

## Phase Breakdown

**Column conventions** (apply to every phase task table below):
- `Estimate` — Task size (story points OR hours; team convention).
- No plan-time `Subagent(s)` / `Model` / `Effort` columns — provider, model, and executor are
  resolved at dispatch time by the `delegation-router` skill against the live registry, never
  authored per task. Routing constraints (MUST-stay classes, offload-eligibility, capability bar)
  belong in the decisions block, phrased as constraints — never as model ids.

### Phase 1: Database Foundation

**Duration**: [X days]
**Dependencies**: None

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Dependencies |
|---------|-----------|-------------|-------------------|----------|--------------|
| DB-001 | Schema Design | Create database schema | Schema validates, migrations run cleanly | 3 pts | None |
| DB-002 | RLS Policies | Implement Row Level Security | Security enforces correct boundaries | 2 pts | DB-001 |
| DB-003 | Indexes & Performance | Add indexes for query optimization | Query performance meets benchmarks | 1 pt | DB-001 |

**Phase 1 Quality Gates:**
- [ ] Schema migrations run successfully
- [ ] RLS policies enforce correct boundaries
- [ ] Performance benchmarks met
- [ ] Database backup/recovery tested

---

### Phase 2: Repository Layer

**Duration**: [X days]
**Dependencies**: Phase 1 complete

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Dependencies |
|---------|-----------|-------------|-------------------|----------|--------------|
| REPO-001 | Base Repository | Create repository interface | Interface supports CRUD + pagination | 2 pts | DB-003 |
| REPO-002 | Query Methods | Implement specific queries | All queries use cursor pagination | 3 pts | REPO-001 |
| REPO-003 | Transaction Handling | Add rollback on errors | Exceptions trigger automatic rollback | 2 pts | REPO-001 |

**Phase 2 Quality Gates:**
- [ ] All CRUD operations working
- [ ] Cursor pagination implemented
- [ ] Transaction rollback working
- [ ] Repository tests achieve >80% coverage

---

### Phase 3: Service Layer

**Duration**: [X days]
**Dependencies**: Phase 2 complete

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Dependencies |
|---------|-----------|-------------|-------------------|----------|--------------|
| SVC-001 | DTO Definitions | Create DTOs for request/response | DTOs validate with schemas | 2 pts | REPO-003 |
| SVC-002 | Business Logic | Implement core business logic | Logic passes unit tests, returns DTOs | 5 pts | SVC-001 |
| SVC-003 | Error Handling | Implement error patterns | Errors use ErrorResponse envelope | 1 pt | SVC-002 |
| SVC-004 | Observability | Add OpenTelemetry spans | Spans/logs for all operations | 2 pts | SVC-002 |

**Phase 3 Quality Gates:**
- [ ] Business logic unit tests pass
- [ ] DTOs validate correctly
- [ ] ErrorResponse envelope used
- [ ] OpenTelemetry instrumentation complete

---

### Phase 4: API Layer

**Duration**: [X days]
**Dependencies**: Phase 3 complete

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Dependencies |
|---------|-----------|-------------|-------------------|----------|--------------|
| API-001 | Router Setup | Create API router with endpoints | Routes defined with OpenAPI docs | 2 pts | SVC-004 |
| API-002 | Request Validation | Implement request validation | Invalid requests return 400 | 2 pts | API-001 |
| API-003 | Response Formatting | Standardize response formats | Consistent envelope, cursor pagination | 1 pt | API-002 |
| API-004 | Authentication | Integrate Clerk authentication | Endpoints properly secured | 2 pts | API-001 |

**Phase 4 Quality Gates:**
- [ ] All endpoints return correct responses
- [ ] OpenAPI documentation complete
- [ ] ErrorResponse envelope consistent
- [ ] Authentication working correctly

---

### Phase 5: UI Layer

**Duration**: [X days]
**Dependencies**: Phase 4 complete (can start design earlier)

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Dependencies |
|---------|-----------|-------------|-------------------|----------|--------------|
| UI-001 | Component Design | Design/update UI components | Components support all states | 3 pts | API-004 |
| UI-002 | Hooks Implementation | Create state management hooks | Hooks handle loading/error/success | 2 pts | UI-001 |
| UI-003 | Component Implementation | Implement components in @miethe/ui | Components render correctly | 3 pts | UI-002 |
| UI-004 | API Integration | Integrate with backend API | UI reflects backend functionality | 3 pts | UI-003 |
| UI-005 | Accessibility | Implement a11y features | WCAG 2.1 AA compliance | 2 pts | UI-004 |
| UI-006 | Responsive Design | Ensure mobile responsiveness | Works on all device sizes | 2 pts | UI-004 |

**Phase 5 Quality Gates:**
- [ ] Components render in all states
- [ ] User interactions work correctly
- [ ] Accessibility requirements met
- [ ] Mobile responsiveness validated
- [ ] Backend integration working

---

### Phase 6: Testing Layer

**Duration**: [X days]
**Dependencies**: Previous phases complete

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Dependencies |
|---------|-----------|-------------|-------------------|----------|--------------|
| TEST-001 | Unit Tests | Create unit tests for all layers | >80% code coverage | 5 pts | UI-006 |
| TEST-002 | Integration Tests | Create API integration tests | All endpoints tested | 3 pts | TEST-001 |
| TEST-003 | Component Tests | Create component tests | All UI interactions tested | 3 pts | TEST-001 |
| TEST-004 | E2E Tests | Create end-to-end tests | Critical paths covered | 2 pts | TEST-003 |
| TEST-005 | Performance Tests | Create performance benchmarks | Performance targets met | 2 pts | TEST-002 |
| TEST-006 | Accessibility Tests | Automated a11y testing | A11y tests pass | 1 pt | TEST-003 |

**Phase 6 Quality Gates:**
- [ ] Code coverage >80%
- [ ] All tests passing in CI/CD
- [ ] E2E tests cover critical journeys
- [ ] Performance benchmarks met
- [ ] Accessibility compliance validated

---

### Phase 7: Documentation Finalization

**Duration**: 0.5-1 day
**Dependencies**: All implementation phases complete

#### Overview

Evaluate and update all documentation affected by this feature. All doc tasks delegate to skill-equipped agents. Docs should be concise and usage-focused, not verbose. Context files follow progressive disclosure (CLAUDE.md pointers only, detail in key-context).

#### Required Evaluation Areas

| Area | When to Include | Delegation Target |
|------|----------------|-------------------|
| CHANGELOG.md | User-facing changes (new features, breaking changes, deprecations) | `changelog-generator` agent |
| README.md | Features, CLI commands, screenshots, or version changed | `documentation-writer` agent |
| User/dev docs | New features or changed behavior that users need to know about | `documentation-writer` agent |
| Context files | Changes affect agent behavior, architectural patterns, or dev workflow | `documentation-writer` agent |
| Project-level custom skills | Changes affect domain of a custom skill (CLI commands, capabilities, workflows) | `ai-artifacts-engineer` (SPEC/SKILL) + `documentation-writer` (workflows) |

#### Context File Update Rules

- **CLAUDE.md** (root or nested): Pointer layer only — add one-liner + path reference, ≤3 lines per addition
- **Key-context files** (`.claude/context/key-context/`): Detail lives here — update existing files, create new only when genuinely needed
- **Rules** (`.claude/rules/`): Update when invariants change

#### Task Table

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Dependencies |
|---------|-----------|-------------|-------------------|----------|--------------|
| DOC-001 | Update CHANGELOG | Add entry for user-facing changes under `[Unreleased]` following Keep A Changelog format. Categorization rules and skip patterns are in `.claude/specs/changelog-spec.md`. Skip this task (set `changelog_required: false` in plan frontmatter) only when the feature has zero user-facing changes. Agent must verify that `[Unreleased]` contains an entry matching this feature before the release gate. | Entry exists under `[Unreleased]` with correct categorization; `changelog_ref` frontmatter set to `CHANGELOG.md` | 0.5 pts | All impl phases |
| DOC-002 | Update README | Rebuild README if features/CLI/screenshots/version changed | README reflects current state | 0.5 pts | All impl phases |
| DOC-003 | Update user/dev docs | Update relevant docs under `docs/` for changed behavior | Docs accurate and concise | 0.5-1 pts | All impl phases |
| DOC-004 | Update context files | Update CLAUDE.md, key-context, rules for agent-relevant changes | Additions follow progressive disclosure | 0.5-1 pts | All impl phases |
| DOC-005 | Update plan frontmatter | Set status=completed, populate commit_refs, files_affected, updated | Frontmatter complete per lifecycle spec | 0.5 pts | DOC-001 through DOC-004 |
| DOC-006 | Author design specs for deferred items | For each item in the "Deferred Items" triage table, author a design_spec at `docs/project_plans/design-specs/[item-slug].md` with `maturity: shaping` (or `idea` if research/SPIKE needed), set `prd_ref` to the parent PRD, and append the resulting path to this plan's `deferred_items_spec_refs`. Skip with "N/A — no deferred items" if the triage table is empty. | All deferred items have corresponding design_specs OR documented as N/A | 0.5-2 pts | All impl phases |
| DOC-007 | Finalize findings doc & promote load-bearing findings | If `findings_doc_ref` is populated: ensure all phase findings captured, advance status from `draft` → `accepted`, populate `promoted_to` with this plan's path. For any load-bearing findings, ensure a design_spec was authored (coordinate with DOC-006). Skip with "N/A — no findings captured" if `findings_doc_ref` is null. | Findings doc finalized OR marked N/A | 0.5-1 pts | DOC-006 |
| DOC-008 | Update affected project-level skills | For each custom skill whose domain is touched by this plan (check the repo's skill roster — `.claude/specs/skills-index.md` in skillmeat, the skills dir + `docs/ARTIFACT-UPSTREAM-REGISTRY.md` in AOS repos): update SPEC.md Capability Coverage matrix, bump SPEC.md Changelog + `updated` date, refresh affected workflow files, update skills-index.md version if bumped. Skip with "N/A — no project-level skill domains affected" if none apply. | All affected custom skills have current SPEC.md + workflows, OR documented as N/A | 0.5-2 pts | All impl phases |

**Phase 7 Quality Gates:**
- [ ] CHANGELOG `[Unreleased]` section contains an entry matching this feature (required if `changelog_required: true`; verify via `.claude/specs/changelog-spec.md` before release gate)
- [ ] README updated (if applicable)
- [ ] User/dev docs updated (if applicable)
- [ ] Context files updated (if applicable)
- [ ] Plan frontmatter complete
- [ ] Design specs authored for all deferred items (or N/A with rationale)
- [ ] Findings doc finalized if any findings captured during execution
- [ ] Project-level custom skills updated (or N/A with rationale)
- [ ] `deferred_items_spec_refs` and `findings_doc_ref` frontmatter populated

---

### Phase 8: Deployment Layer

**Duration**: [X days]
**Dependencies**: All phases complete

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Dependencies |
|---------|-----------|-------------|-------------------|----------|--------------|
| DEPLOY-001 | Feature Flags | Implement feature flags | Feature can be toggled safely | 1 pt | DOC-005 |
| DEPLOY-002 | Monitoring | Add telemetry and monitoring | All operations instrumented | 2 pts | DEPLOY-001 |
| DEPLOY-003 | Staging Deployment | Deploy to staging | Feature works in staging | 1 pt | DEPLOY-002 |
| DEPLOY-004 | Production Rollout | Execute production rollout | Rollout completed successfully | 2 pts | DEPLOY-003 |
| DEPLOY-005 | Post-Launch Monitoring | Monitor and respond | Feature stable in production | 1 pt | DEPLOY-004 |

**Phase 8 Quality Gates:**
- [ ] Feature flags working
- [ ] Monitoring and alerting active
- [ ] Staging deployment successful
- [ ] Production rollout completed
- [ ] Post-launch metrics healthy

---

## Wrap-Up: Feature Guide & PR

**Triggered**: Automatically after the final implementation phase is sealed (all phase quality gates pass). This is NOT a separate numbered phase — it is a post-implementation close-out step.

### Step 1 — Feature Guide

Delegate to `documentation-writer` (haiku) to create `.claude/worknotes/<feature-slug>/feature-guide.md`.

**Frontmatter**:
```yaml
---
doc_type: feature_guide
feature_slug: "<feature-slug>"
prd_ref: <path to parent PRD>
plan_ref: <path to this implementation plan>
spike_ref: <spike path if any, else null>
adr_refs: []   # populate from plan frontmatter
created: <today>
---
```

**Required sections** (keep total under 200 lines):
1. **What Was Built** — 2-4 sentences: the core capability delivered and why
2. **Architecture Overview** — key files/layers touched; link to ADRs for decisions
3. **How to Test** — per-edition instructions (local + enterprise where applicable); include CLI commands or API calls
4. **Test Coverage Summary** — brief statement of what is covered and at what level
5. **Known Limitations** — items deferred or deliberately out of scope

**Audience**: Developer/stakeholder reference now; future supplement to CHANGELOG for users who want more detail than a changelog entry provides.

Commit the feature guide before opening the PR.

### Step 2 — Open PR

After the feature guide is committed, open the pull request:

```bash
gh pr create \
  --title "<concise feature title (≤70 chars)>" \
  --body "$(cat <<'EOF'
## Summary
- <bullet 1>
- <bullet 2>
- <bullet 3>

## Feature Guide
.claude/worknotes/<feature-slug>/feature-guide.md

## Test plan
- [ ] All unit + integration tests pass
- [ ] Smoke-tested locally (local edition)
- [ ] Smoke-tested in enterprise stack (if applicable)

🤖 Generated with Claude Code
EOF
)"
```

Derive the PR summary bullets directly from the implementation plan's Executive Summary and the CHANGELOG entry authored in Documentation Finalization.

---

## Risk Mitigation

### Technical Risks

| Risk | Impact | Likelihood | Mitigation Strategy |
|------|--------|------------|-------------------|
| Database performance issues | High | Medium | Pre-optimize queries, add indexes |
| Integration failures | High | Low | Isolated testing, rollback procedures |
| UI/UX complexity | Medium | Medium | Early designer review, user testing |

### Schedule Risks

| Risk | Impact | Likelihood | Mitigation Strategy |
|------|--------|------------|-------------------|
| Scope creep | Medium | High | Change request process |
| Resource constraints | High | Medium | Task prioritization, phased delivery |
| Dependency delays | Medium | Medium | Parallel work streams |

---

## Resource Requirements

### Team Composition
- Backend Developer: 2 FTE (phases 1-4), part-time (5-8)
- Frontend Developer: 1 FTE (phase 5), part-time (1-4, 6-8)
- UI/UX Designer: Part-time (phase 5, reviews)
- DevOps Engineer: Part-time (throughout), FTE (phase 8)
- QA Specialist: Part-time (phase 6)

### Skill Requirements
- TypeScript/JavaScript, FastAPI, SQLAlchemy, React, React Query
- PostgreSQL, Git, CI/CD, OpenTelemetry, Storybook
- Accessibility (WCAG 2.1 AA), Performance optimization

---

## Success Metrics

### Delivery Metrics
- On-time delivery (±10%)
- Code coverage >80%
- Performance benchmarks met
- Zero P0/P1 bugs in first week

### Business Metrics
- [Feature-specific metrics]
- Error rate <1%
- User satisfaction >4/5

### Technical Metrics
- 100% API documentation
- 100% WCAG 2.1 AA compliance
- Security review passed

---

## Communication Plan

- Daily standups for progress/blockers
- Weekly status reports on milestones
- Formal phase reviews
- Bi-weekly stakeholder updates

---

## Post-Implementation

- Performance monitoring dashboards
- Error tracking and resolution
- User feedback collection
- Technical debt planning
- Feature iteration based on usage

---

**Progress Tracking:**

See `.claude/progress/[feature-name]/all-phases-progress.md`

---

**Implementation Plan Version**: 1.0
**Last Updated**: YYYY-MM-DD
