---
name: artifact-tracking
description: "Token-efficient tracking for AI orchestration. CLI-first for status updates (~50 tokens), agent fallback for complex ops (~1KB). Use when: updating task status, querying blockers, creating progress files, validating phases."
---

# Artifact Tracking Skill

Token-efficient tracking artifacts for AI agent orchestration.

## Quick Operations (CLI First)

| Operation | Command | Tokens |
|-----------|---------|--------|
| Mark complete | `python scripts/update-status.py -f FILE -t TASK-X -s completed` | ~50 |
| Batch update | `python scripts/update-batch.py -f FILE --updates "T1:completed,T2:completed"` | ~100 |
| Query pending | `python scripts/query_artifacts.py --status pending` | ~50 |
| Validate | `python scripts/validate_artifact.py -f FILE` | ~50 |
| Update fields | `python scripts/update-field.py -f FILE --set "priority=high"` | ~50 |
| Scan migration | `python scripts/migrate-frontmatter.py --scan` | ~100 |

**Scripts location**: `.claude/skills/artifact-tracking/scripts/`

## Script Inventory

| Script | Purpose |
|---|---|
| `update-status.py` | Update one task status in progress frontmatter |
| `update-batch.py` | Batch-update multiple task statuses |
| `manage-plan-status.py` | Read/update/query planning doc status and arbitrary fields |
| `validate_artifact.py` | Validate frontmatter against schema (`doc_type` auto-detect, strict mode) |
| `query_artifacts.py` | Query metadata across planning/progress/worknotes docs |
| `migrate-frontmatter.py` | Scan/dry-run/migrate missing `schema_version`/`doc_type` |
| `update-field.py` | Generic `--set` and `--append` updates with schema validation |

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
