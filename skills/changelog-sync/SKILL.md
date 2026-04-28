---
name: changelog-sync
description: |
  Audits CHANGELOG coverage for a git commit range; read-only — surfaces gaps for human remediation.
  Use this skill before a version bump, in CI, or ad-hoc to verify that all non-trivial commits
  are reflected in the changelog. Co-loaded with the release skill on every /release:bump invocation.
  Does not write or modify any files; outputs structured gap reports and exit codes only.
version: 1.0
updated: 2026-04-19
spec: ./SPEC.md
---

# changelog-sync Skill

Audit CHANGELOG coverage for a git commit range. Read-only — surfaces gaps for human remediation.

For the full capability contract, invariants, and enhancement backlog see `./SPEC.md`.

---

## Route Table

| User Intent | Workflow Doc | Canonical Doc |
|-------------|-------------|---------------|
| Audit CHANGELOG coverage for a git range (pre-bump, CI, ad-hoc) | `./workflows/audit-workflow.md` | `.claude/specs/changelog-spec.md` |
| Understand which commit types are exempt from coverage | `./workflows/audit-workflow.md §Skip Patterns` | `.claude/specs/changelog-spec.md §Skip Patterns` |
| Interpret exit codes or consume machine-readable output | `./workflows/audit-workflow.md §Exit Codes` | `./scripts/audit-coverage.py --help` |

---

## Quick Reference

```bash
# Standard pre-bump audit
python .claude/skills/changelog-sync/scripts/audit-coverage.py FROM_TAG TO_REF

# Machine-readable output (used by release skill orchestration)
python .claude/skills/changelog-sync/scripts/audit-coverage.py FROM_TAG TO_REF --json

# Example
python .claude/skills/changelog-sync/scripts/audit-coverage.py v0.31.0 HEAD
```

Exit code `0` = full coverage. Non-zero = gaps present; release must be blocked.

---

## Policy

### Categorization Rules

All coverage decisions follow `.claude/specs/changelog-spec.md`. That file is the authoritative source for:
- Which commit prefixes map to which CHANGELOG sections (Added / Changed / Fixed / etc.)
- Which prefixes are skip-exempt (docs, chore, refactor, test, ci)
- Entry format and example conventions

Do not inline categorization rules here. Load `changelog-spec.md` when answering questions about whether a specific commit requires a CHANGELOG entry.

### Read-Only Invariant

This skill and its script never write to CHANGELOG.md, the git index, or any tracked file. If a gap is found, surface it and stop. Do not propose entries or auto-commit fixes.

### v1.1 Extension Point

Nightly reconciliation (scheduled audit against the active branch) is a planned v1.1 capability tracked as BL-1 in `./SPEC.md`. It is blocked on the scheduled-ops-framework-v1 Phase 0 milestone. When that framework is available, the audit workflow will gain a `nightly` mode section. Until then, the only supported invocation is the manual CLI call documented above.
