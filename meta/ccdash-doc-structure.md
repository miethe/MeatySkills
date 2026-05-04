# Document Frontmatter Improvement Spec (Future Schema)

Last updated: 2026-03-14
Status: Proposed

This spec defines a recommended structure for documentation frontmatter so CCDash can ingest richer, higher-quality data for linking, filtering, analytics, and lifecycle tracking.

This document is intentionally forward-looking and includes fields not currently required by the app.

## 1. Design Goals

- Improve entity linking precision (`document <-> feature/task/session/document`).
- Make documents consistently filterable across type, status, owners, release, risk, and outcome.
- Enable timeline and delivery analytics without parsing free-form markdown.
- Preserve backward compatibility with existing frontmatter styles.

## 2. Shared Envelope (Recommended for All Doc Types)

Use this baseline in every doc:

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: implementation_plan   # enum: prd|implementation_plan|phase_plan|report|progress|spec|design_doc|spike|bug_doc|document
doc_subtype: ""                # optional subtype for finer categorization
root_kind: project_plans        # enum: project_plans|progress

id: DOC-optional-stable-id      # optional stable ID (canonical path remains source of truth)
title: ""
status: draft                   # enum: draft|pending|in_progress|review|completed|deferred|blocked|archived
category: ""

feature_slug: ""
feature_version: ""            # e.g. v1, v2
feature_family: ""             # canonical/versionless slug
prd_ref: ""                    # slug/path/id
plan_ref: ""                   # slug/path/id
related_documents: []           # list[path|id]
related_features: []            # list[slug]
blocked_by: []                  # list[feature_slug] — documents that must complete before this one can start
sequence_order: null            # int|null — recommended execution order within feature_family (0 = first; null = unsequenced)
linked_sessions: []             # list[session-id]
linked_tasks: []                # list[task-id]

owner: ""
owners: []
contributors: []
reviewers: []
approvers: []

request_log_ids: []
commit_refs: []
pr_refs: []

priority: medium                # enum: low|medium|high|critical
risk_level: medium              # enum: low|medium|high|critical
confidence: 0.0                 # 0..1

created: ""                    # ISO timestamp
updated: ""                    # ISO timestamp
target_release: ""             # e.g. 2026-Q2
milestone: ""

tags: []
labels: []

files_affected: []
context_files: []
```

## 3. Proposed Per-Doc-Type Schemas and Value

## 3.1 PRD

### Value to CCDash

- Better product-level filtering (`persona`, `priority`, `target_release`).
- Requirement-level traceability from PRD -> Plan -> Progress -> Sessions.
- Success-metric rollups across features.

### Proposed YAML

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: prd
doc_subtype: product_requirements
root_kind: project_plans

id: DOC-prd-feature-x-v1
title: Feature X PRD
status: in_progress
category: features

feature_slug: feature-x-v1
feature_family: feature-x
feature_version: v1
blocked_by: []
sequence_order: null

owner: product-owner
contributors: [engineering-lead, designer]
reviewers: [engineering-manager]

problem_statement: ""
personas: ["admin", "operator"]
goals:
  - id: G1
    title: ""
    metric: ""
non_goals: []

requirements:
  - id: FR-1
    type: functional             # functional|non_functional|constraint
    title: ""
    description: ""
    priority: high
    acceptance_criteria:
      - ""

success_metrics:
  - id: M1
    name: conversion_rate
    baseline: 0.0
    target: 0.0
    unit: "%"

dependencies: []
risks:
  - id: R1
    level: medium
    description: ""
    mitigation: ""

prd_ref: ""
plan_ref: ""
related_documents: []
request_log_ids: []
commit_refs: []

created: ""
updated: ""
target_release: 2026-Q2
priority: high
risk_level: medium
confidence: 0.8

tags: [prd, product]
```

## 3.2 Implementation Plan

### Value to CCDash

- Stronger phase/status analytics and execution planning views.
- Better dependency and gating visibility.
- Cleaner mapping from planned deliverables to progress files and sessions.

### Proposed YAML

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: implementation_plan
doc_subtype: implementation_plan
root_kind: project_plans

title: Feature X Implementation Plan
status: in_progress
category: features

feature_slug: feature-x-v1
feature_family: feature-x
feature_version: v1
prd_ref: feature-x-v1
blocked_by: []
sequence_order: null

owner: engineering-lead
contributors: [backend-dev, frontend-dev]

scope:
  in_scope: []
  out_of_scope: []

architecture_summary: ""
rollout_strategy: ""
rollback_strategy: ""
observability_plan: ""
security_considerations: []
test_strategy: []

dependencies:
  internal: []
  external: []

phases:
  - id: P1
    phase: 1
    title: Foundation
    status: pending
    entry_criteria: []
    exit_criteria: []
    deliverables: []

effort_estimate:
  engineering_weeks: 0
  story_points: 0

request_log_ids: []
commit_refs: []
related_documents: []

created: ""
updated: ""
target_release: 2026-Q2
priority: high
risk_level: medium
confidence: 0.75

tags: [plan, implementation]
```

## 3.3 Phase Plan

### Value to CCDash

- More granular phase-level filtering and progress forecasting.
- Cleaner phase-to-task/session linking.

### Proposed YAML

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: phase_plan
doc_subtype: phase_plan
root_kind: project_plans

title: Feature X Phase 1 Plan
status: pending
category: features

feature_slug: feature-x-v1
prd_ref: feature-x-v1
plan_ref: feature-x-v1

phase: 1
phase_token: "1"
phase_title: Foundation
phase_goal: ""

tasks:
  - id: TASK-1.1
    title: ""
    status: pending
    owner: ""
    estimate_points: 0
    depends_on: []

entry_criteria: []
exit_criteria: []

request_log_ids: []
commit_refs: []
related_documents: []

created: ""
updated: ""
priority: high
risk_level: medium

tags: [phase, plan]
```

## 3.4 Report

### Value to CCDash

- Enables report dashboards by period/type/quality/impact.
- Improves measurable outcome tracking vs plan/PRD targets.
- Supports incident/postmortem linkage to fixes and sessions.

### Proposed YAML

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: report
doc_subtype: implementation_report   # implementation_report|status_report|postmortem|benchmark|qa_report
root_kind: project_plans

title: Feature X Phase 1 Report
status: completed
category: reports

feature_slug: feature-x-v1
prd_ref: feature-x-v1
plan_ref: feature-x-v1

report_period:
  start: ""
  end: ""

summary: ""
outcome: success                     # success|partial|failed|blocked

metrics:
  - id: M1
    name: task_completion_pct
    baseline: 0
    actual: 0
    target: 0
    unit: "%"

findings:
  - id: F1
    severity: medium
    title: ""
    description: ""

decisions:
  - id: D1
    title: ""
    rationale: ""

action_items:
  - id: A1
    title: ""
    owner: ""
    due_date: ""
    status: pending

request_log_ids: []
commit_refs: []
pr_refs: []
linked_sessions: []
related_documents: []

created: ""
updated: ""

priority: medium
risk_level: low
confidence: 0.9

tags: [report]
```

## 3.5 Progress (Phase)

### Value to CCDash

- Better real-time operational visibility and blocker analytics.
- More reliable task/session/commit lineage.
- Improved burn-up and trend chart capability.

### Proposed YAML

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: progress
doc_subtype: progress_phase
root_kind: progress

title: Feature X Phase 1 Progress
status: in_progress
category: progress

feature_slug: feature-x-v1
feature_family: feature-x
prd_ref: feature-x-v1
plan_ref: feature-x-v1

phase: 1
phase_token: "1"
phase_title: Foundation

overall_progress: 35
total_tasks: 20
completed_tasks: 7
deferred_tasks: 2
in_progress_tasks: 4
blocked_tasks: 2

velocity:
  completed_last_7d: 5
  completed_last_24h: 1

blockers:
  - id: B1
    title: ""
    owner: ""
    opened_at: ""
    severity: high

tasks:
  - id: TASK-1.1
    title: ""
    status: in-progress          # pending|in-progress|completed|deferred|blocked|review
    owner: ""
    priority: high
    estimated_effort: 4h
    started_at: ""
    completed_at: ""
    session_id: ""
    git_commit: ""
    request_log_id: ""
    dependencies: []
    deliverables: []

request_log_ids: []
commit_refs: []
linked_sessions: []
related_documents: []
files_modified: []
context_files: []

created: ""
updated: ""

tags: [progress, phase]
```

## 3.6 Progress (All Phases)

### Value to CCDash

- Supports feature-level aggregation view without joining multiple phase files.
- Faster high-level dashboards.

### Proposed YAML

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: progress
doc_subtype: progress_all_phases
root_kind: progress

title: Feature X All Phases Progress
status: in_progress
category: progress

feature_slug: feature-x-v1
prd_ref: feature-x-v1
plan_ref: feature-x-v1

overall_progress: 52
phase_summaries:
  - phase: 1
    status: completed
    progress: 100
  - phase: 2
    status: in_progress
    progress: 40

total_tasks: 64
completed_tasks: 33
deferred_tasks: 4
in_progress_tasks: 12
blocked_tasks: 3

request_log_ids: []
commit_refs: []
related_documents: []

created: ""
updated: ""

tags: [progress, all-phases]
```

## 3.7 Progress (Quick Feature)

### Value to CCDash

- Better disambiguation for short-lived efforts.
- Cleaner separation from long-running multi-phase features.

### Proposed YAML

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: progress
doc_subtype: progress_quick_feature
root_kind: progress

title: Quick Feature XYZ Progress
status: in_progress
category: quick-features

feature_slug: quick-feature-xyz-v1
prd_ref: ""
plan_ref: ""

overall_progress: 60
total_tasks: 5
completed_tasks: 3
deferred_tasks: 1
in_progress_tasks: 1
blocked_tasks: 0

tasks: []
request_log_ids: []
commit_refs: []
linked_sessions: []

created: ""
updated: ""

tags: [progress, quick-feature]
```

## 3.8 Technical Spec

### Value to CCDash

- Improves architecture/dependency search.
- Enables API/data-contract linking to implementation and report docs.

### Proposed YAML

```yaml
schema_name: ccdash_document
schema_version: 2

doc_type: spec
doc_subtype: technical_spec
root_kind: project_plans

title: Feature X API Spec
status: review
category: specs

feature_slug: feature-x-v1
prd_ref: feature-x-v1
plan_ref: feature-x-v1

api_contracts:
  - service: ccdash
    endpoint: /api/documents
    method: GET
    version: v1

data_contracts:
  - name: PlanDocument
    version: 1
    schema_ref: docs/document-frontmatter-current-implementation-spec-2026-02-19.md

dependencies: []
compatibility_notes: []
breaking_changes: []

request_log_ids: []
commit_refs: []
related_documents: []

created: ""
updated: ""

tags: [spec, api]
```

## 4. Recommended Rollout

1. Add `schema_name` and `schema_version` to all new docs.
2. Add shared envelope fields to templates first.
3. Backfill type-specific fields incrementally per directory.
4. Introduce validation tooling (lint) to prevent drift.
5. Expand DB columns only for high-value stable fields; keep long-tail data in `metadata_json`.

## 5. Validation Rules (Recommended)

- `doc_type`, `status`, `root_kind` must be enum values.
- `feature_slug` should be kebab-case and versioned when applicable.
- `phase`/`phase_token` should be numeric for phase docs.
- Task counters should be internally consistent (`completed <= total`, etc.).
- IDs in `linked_sessions` and `request_log_ids` should match known formats.
- `blocked_by` entries should reference valid `feature_slug` values from other documents in the same `feature_family`.
- `sequence_order` should be a non-negative integer when set; documents with the same `sequence_order` can execute in parallel.
