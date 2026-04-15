---
schema_version: 2
doc_type: report
report_category: archive-index
title: skillmeat-cli Archived Workflows
description: Index of 7 speculative workflow files archived in Phase 3C.4; preserved for reference until CLI features are ready for restoration
feature_slug: skill-spec-convention-and-skillmeat-cli-refresh
created: 2026-04-14
updated: 2026-04-14
---

# Archived Workflows Index

This directory contains 7 workflow files archived in Phase 3C.4 of the skillmeat-cli refresh initiative. These workflows document speculative agent capabilities that currently lack a corresponding CLI command surface. They are preserved here as reference documentation and as design input for future enhancement work.

The original audit consolidating these findings can be found at `.claude/findings/skillmeat-cli-workflow-audit.md`. The Enhancement Backlog section of `.claude/skills/skillmeat-cli/SPEC.md` § 4 maintains detailed restoration prerequisites and rationale for each archived workflow.

---

## Archived Files

| Filename | Archived | Backlog ID | Rationale |
|----------|----------|------------|-----------|
| `rating-system.md` | 2026-04-14 | [BL-1] | No current `skillmeat rate` command exists. CLI prerequisite before restore. |
| `caching.md` | 2026-04-14 | [BL-2] | Internal cache optimization; no agent-facing CLI workflow needed yet. |
| `confidence-integration.md` | 2026-04-14 | [BL-3] | Speculative confidence scoring; `/api/v1/match` exists but no CLI wrapper yet. |
| `context-boosting.md` | 2026-04-14 | [BL-4] | Context analysis backend exists; no agent-facing CLI surface for project-type boosting. |
| `gap-detection.md` | 2026-04-14 | [BL-5] | Aspirational; requires `skillmeat suggest` command or equivalent gap analysis CLI. |
| `agent-self-enhancement.md` | 2026-04-14 | [BL-6] | Depends on BL-5 (gap detection) + permission model for autonomous installs. |
| `advanced-integration.md` | 2026-04-14 | [BL-7] | Too generic; depends on BL-3 (confidence) and BL-5 (gap detection) for meaningful signal. |
| `integration-tests.md` | 2026-04-14 | [PHASE-3D] | CLI syntax/usage duplication (1,852 lines, ~80% overlap with `docs/user/guides/cli/commands.md`). Canonical CLI docs are single source of truth; skill SKILL.md enforces this. Archived in 3D.2 audit. |

---

## Restoration Policy

To restore any archived workflow back to active use:

1. **Verify CLI surface**: Add the corresponding command to `skillmeat/cli/commands/` (e.g., `skillmeat rate` for BL-1, `skillmeat suggest` for BL-5).

2. **Update SPEC.md backlog**: Locate the backlog entry in `.claude/skills/skillmeat-cli/SPEC.md` § 4 and confirm all CLI prerequisites are met.

3. **Move file back**: Run `git mv workflows/archive/<filename> workflows/` to restore the file to the active workflows directory.

4. **Refresh metadata**: Update the workflow file's frontmatter (created date, updated date, and feature_slug if applicable); add a `canonical_doc_pointer` referencing the corresponding user-facing CLI command documentation in `docs/user/guides/cli/commands.md`.

5. **Update routing**: Ensure `SKILL.md` route table includes the restored workflow's intent(s) and that the Capability Coverage matrix in `SPEC.md` § 2 is updated to point to the restored workflow file.

6. **Single commit**: Group all changes (file move, metadata refresh, SPEC.md/SKILL.md updates) into one commit with message: "restore: activate [intent] workflow from archive — [BL-N] prerequisites met"

---

_Last updated: 2026-04-14_
