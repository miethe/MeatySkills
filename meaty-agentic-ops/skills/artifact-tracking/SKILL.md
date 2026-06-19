---
name: artifact-tracking
description: "Token-efficient tracking for AI orchestration. CLI-first for status updates (~50 tokens), agent fallback for complex ops (~1KB). Use when: updating task status, querying blockers, creating progress files, validating phases."
---

# Artifact Tracking Skill

Token-efficient tracking artifacts for AI agent orchestration.

## Quick Operations (CLI First)

| Operation | Command | Tokens |
|-----------|---------|--------|
| Mark complete | `python scripts/update-status.py -f FILE -t TASK-X -s completed --started TS --completed TS` | ~50 |
| Batch update | `python scripts/update-batch.py -f FILE --updates "T1:completed,T2:completed"` | ~100 |
| Query pending | `python scripts/query_artifacts.py --status pending` | ~50 |
| Validate | `python scripts/validate_artifact.py -f FILE` | ~50 |
| Update fields | `python scripts/update-field.py -f FILE --set "priority=high"` | ~50 |
| Scan migration | `python scripts/migrate-frontmatter.py --scan` | ~100 |
| Phase gate | `python scripts/validate-phase-completion.py -f FILE` | ~50 |
| AC coverage | `python scripts/ac-coverage-report.py --plan PLAN --progress P` | ~100 |
| AC dry-check | `python scripts/ac-coverage-report.py --plan PLAN --dry` | ~50 |

**Scripts location**: `.claude/skills/artifact-tracking/scripts/`

## Script Inventory

| Script | Purpose |
|---|---|
| `update-status.py` | Update one task status; enforces completion gate (timestamps/evidence required) |
| `update-batch.py` | Batch-update multiple task statuses |
| `manage-plan-status.py` | Read/update/query planning doc status and arbitrary fields |
| `validate_artifact.py` | Validate frontmatter against schema (`doc_type` auto-detect, strict mode) |
| `validate-phase-completion.py` | Block phase `completed` if any task missing `started`/`completed`/`verified_by`/`evidence` |
| `ac-coverage-report.py` | Two-way AC↔task coverage matrix; `--dry` checks vague ACs for `target_surfaces` |
| `query_artifacts.py` | Query metadata across planning/progress/worknotes docs |
| `migrate-frontmatter.py` | Scan/dry-run/migrate missing `schema_version`/`doc_type` |
| `update-field.py` | Generic `--set` and `--append` updates with schema validation |

## Completion Gate (§4.4 of delivery-quality spec)

`update-status.py -s completed` **rejects** unless at least one of:
1. Both `--started <ISO-8601>` and `--completed <ISO-8601>` are supplied, OR
2. At least one `--evidence` item is provided.

Use `--force` to override; a WARNING is printed to stderr. This gate prevents
batch-flip completions with null timing signals (failure class: Batch-flip completion).

```bash
# Correct — with timing
python scripts/update-status.py -f FILE -t T7-003 -s completed \
    --started 2026-04-22T10:00Z --completed 2026-04-22T17:00Z \
    --evidence "commit:abc123" --verified-by P16-003

# Force override (log WARNING, use sparingly)
python scripts/update-status.py -f FILE -t T7-003 -s completed --force
```

New flags:

| Flag | Type | Purpose |
|---|---|---|
| `--started` | ISO-8601 string | Writes `started:` on the task |
| `--completed` | ISO-8601 string | Writes `completed:` on the task |
| `--evidence KEY:VALUE` | Repeatable | Appends to `evidence:` list (`commit:sha`, `screenshot:path`, `test:path`) |
| `--verified-by TASK_ID` | Repeatable | Appends to `verified_by:` list; deduplicates |
| `--force` | Flag | Bypass completion gate (logs WARNING) |

## Phase Exit Gate

Run before marking any phase `completed`. Fails nonzero if any completed task
is missing `started`, `completed`, `verified_by`, or `evidence`.

```bash
# Human report
python scripts/validate-phase-completion.py -f .claude/progress/prd/phase-7-progress.md

# JSON (for scripting)
python scripts/validate-phase-completion.py -f FILE --json
```

## AC Coverage Matrix

Verify every AC in the implementation plan is referenced by at least one
verification task, and every verification task cites at least one AC.

```bash
# Full matrix (phase exit)
python scripts/ac-coverage-report.py \
    --plan docs/project_plans/implementation_plans/my-plan.md \
    --progress .claude/progress/prd/phase-13-progress.md \
    --progress .claude/progress/prd/phase-16-progress.md

# Plan approval gate: reject vague ACs without target_surfaces
python scripts/ac-coverage-report.py --plan PLAN --dry

# JSON output
python scripts/ac-coverage-report.py --plan PLAN --progress P --json
```

AC format in implementation plans (structured block after heading):

```markdown
#### AC R3.4: Status Distribution filter narrows planning surfaces
- target_surfaces:
  - components/Planning/PlanningSummaryPanel.tsx
  - components/Planning/PlanningGraphPanel.tsx
- verified_by: [P16-003, P16-012-smoke]
```

## Plan Status Management

| Operation | Command | Tokens |
|-----------|---------|--------|
| Read status | `python scripts/manage-plan-status.py --read FILE` | ~50 |
| Update status | `python scripts/manage-plan-status.py --file FILE --status STATUS` | ~50 |
| Update any field | `python scripts/manage-plan-status.py --file FILE --field priority --value high` | ~50 |
| Query plans | `python scripts/manage-plan-status.py --query --status STATUS --type TYPE` | ~100 |

**Use for**: PRDs, implementation plans, phase plans, SPIKEs, quick-feature plans, design-specs, meta-plans, and reports. `design-spec`, `meta-plan`, and `report` are supported types in `--type` alongside the original five.

## File Locations

| Type | Location | Limit |
|------|----------|-------|
| Progress | `.claude/progress/[prd]/phase-N-progress.md` | ONE per phase |
| Context | `.claude/worknotes/[prd]/context.md` | ONE per PRD |
| Bug fixes | `.claude/worknotes/fixes/bug-fixes-YYYY-MM.md` | ONE per month |
| Observations | `.claude/worknotes/observations/observation-log-MM-YY.md` | ONE per month |

**Policy**: `.claude/specs/doc-policy-spec.md`

## YAML Quick Reference (v2)

```yaml
---
type: progress
schema_version: 2
doc_type: progress
prd: "prd-name"
feature_slug: "prd-name"
phase: 2
status: in_progress
created: 2026-02-19
updated: 2026-02-19
prd_ref: null
plan_ref: null
commit_refs: []
pr_refs: []

owners: ["agent-name"]
contributors: []

tasks:
  - id: "TASK-2.1"
    status: "pending"
    assigned_to: ["agent-name"]
    dependencies: []

parallelization:
  batch_1: ["TASK-2.1"]
---
```

## Schema Inventory

| Schema | Purpose |
|---|---|
| `envelope.schema.yaml` | Shared CCDash frontmatter envelope |
| `prd.schema.yaml` | PRD frontmatter |
| `implementation-plan.schema.yaml` | Implementation plan frontmatter |
| `phase-plan.schema.yaml` | Phase breakdown frontmatter |
| `spike.schema.yaml` | SPIKE frontmatter |
| `quick-feature.schema.yaml` | Quick feature frontmatter |
| `design-spec.schema.yaml` | Design specification / ideation frontmatter (maturity gradient: idea → promoted) |
| `meta-plan.schema.yaml` | Workflow/process/tooling plans in `.claude/plans/` |
| `report.schema.yaml` | Report frontmatter (extended: `report_category`, `promoted_to`, `source`) |
| `feature-contract.schema.yaml` | Tier 1 Feature Contract (3–8 pt features; replaces PRD + Implementation Plan) |
| `progress.schema.yaml` | Progress tracking (backward-compatible) |
| `context.schema.yaml` | Context worknotes (backward-compatible) |
| `bug-fix.schema.yaml` | Bug-fix logs (backward-compatible) |
| `observation.schema.yaml` | Observation logs (backward-compatible) |

Field-level guidance: `.claude/skills/artifact-tracking/schemas/field-reference.md`

## Post-Implementation Updates

After committing or opening a PR, update traceability fields:

```bash
python scripts/update-field.py -f FILE --append "commit_refs=<SHA>"
python scripts/update-field.py -f FILE --append "pr_refs=#123"
```

Use `commit_refs` and `pr_refs` on PRDs, plans, phase docs, and progress files so CCDash can correlate planning docs with delivery artifacts.

## Detailed References

- **Creating files**: `./creating-artifacts.md`
- **Updating tasks**: `./updating-artifacts.md`
- **Querying data**: `./querying-artifacts.md`
- **Validating**: `./validating-artifacts.md`
- **Orchestration**: `./orchestration-reference.md`
- **Best practices**: `./best-practices.md`
- **Common patterns**: `./common-patterns.md`
- **Format spec**: `./format-specification.md`
- **Templates**: `./templates/`
- **Schemas**: `./schemas/`
