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

### Matching a Commit to a CHANGELOG Entry

A reportable commit is considered covered when ANY of the following appears literally in the
`[Unreleased]` (or target version) section:

1. Its short (7-char) commit SHA.
2. The first 40 characters of its de-prefixed, lowercased subject.
3. Its cited PR number, e.g. `#403` — matched against `(PR #403)`/`(#403)` style citations, the
   house convention for attributing an entry to its originating pull request.
4. A **consolidated-coverage declaration**: an HTML comment anywhere in the section,
   `<!-- covers: <token> [<token> ...] -->`, where each token is either a commit SHA (7-40 hex
   chars) or a `#NNN` PR number. This lets one prose entry claim several commits at once — the
   normal case for a squashed campaign, where the individual commit subjects (e.g. `squash: M5
   memory — ...`) don't read as changelog prose but the campaign's PR number or constituent SHAs
   are known. Example:

   ```markdown
   ### Added
   - Enterprise/project memory now binds to PostgreSQL (PR #470).
     <!-- covers: 1f4379da4, 80db25ab1, #470 -->
   ```

Prefixes `squash`, `campaign`, `papercuts`, and `test-infra` are skip-exempt (see
`.claude/specs/changelog-spec.md`) — they mark process/consolidation commits, not standalone
user-facing changes; the work they carry is expected to already have its own `feat`/`fix` entry or
a consolidated-coverage declaration as above. A release's own tagging/rollover commit (house style:
`Release vX.Y.Z (#NNN)`, no Conventional Commit prefix) is likewise skip-exempt — its content IS the
changelog rollover, not a change that needs its own entry.

### v1.1 Extension Point

Nightly reconciliation (scheduled audit against the active branch) is a planned v1.1 capability tracked as BL-1 in `./SPEC.md`. It is blocked on the scheduled-ops-framework-v1 Phase 0 milestone. When that framework is available, the audit workflow will gain a `nightly` mode section. Until then, the only supported invocation is the manual CLI call documented above.
