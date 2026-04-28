# Audit Workflow

Detailed guidance for running `audit-coverage.py` and interpreting its output.

---

## Overview

The audit workflow checks that every non-skip-patterned commit in a git range has a corresponding entry in CHANGELOG.md's `[Unreleased]` section. It is the read-only gate that runs **before** version bump and tag.

---

## Pre-Bump Audit Behavior

### When to Run

Run the audit immediately before executing the `rollover-changelog.py` rollover step. The canonical sequence in the `release` skill orchestration is:

```
1. version bump prep
2. regen openapi
3. regen SDK
4. audit-coverage (THIS STEP — blocks if exit non-zero)
5. rollover-changelog
6. git commit + tag
7. gh release create
```

If the audit exits non-zero, steps 5–7 do not execute (unless `--force` is passed to the release orchestration). The engineer must update `[Unreleased]` and re-run.

### Invocation

```bash
# Standard audit
python .claude/skills/changelog-sync/scripts/audit-coverage.py FROM_TAG TO_REF

# Machine-readable (used by release skill)
python .claude/skills/changelog-sync/scripts/audit-coverage.py FROM_TAG TO_REF --json

# Examples
python .claude/skills/changelog-sync/scripts/audit-coverage.py v0.31.0 HEAD
python .claude/skills/changelog-sync/scripts/audit-coverage.py v0.31.0 v0.32.0 --json
```

`FROM_TAG` is the previous release tag (exclusive lower bound). `TO_REF` is the target ref (inclusive upper bound, typically `HEAD` or the new version tag).

---

## Skip Patterns

The script filters commits using skip-patterns defined in `.claude/specs/changelog-spec.md`. Commit subjects matching any of the exempt prefixes are excluded from coverage requirements.

**Current exempt prefixes** (authoritative list is in `changelog-spec.md`):
- `docs:` / `docs(*):`
- `chore:` / `chore(*):`
- `refactor:` / `refactor(*):`
- `test:` / `test(*):`
- `ci:` / `ci(*):`
- Merge commits (filtered via `git log --no-merges`)

Any commit NOT matching an exempt prefix must have a corresponding entry in `[Unreleased]`. The script checks for SHA match or subject-substring match.

---

## Expected Output

### Coverage Table (human-readable, default mode)

```
CHANGELOG Coverage Audit: v0.31.0..HEAD
========================================

COVERED   abc1234  feat(api): add marketplace source validation
COVERED   def5678  fix(cli): undeploy requires --force in non-TTY
SKIPPED   ghi9012  chore: bump dependency versions
GAP       jkl3456  feat(web): new artifact filter sidebar

Coverage: 2/3 non-skip commits covered (66.7%)
Gaps found: 1

  jkl3456  feat(web): new artifact filter sidebar
```

### Gap List

The gap list enumerates each uncovered commit as a two-column entry: SHA and subject. This is the actionable list the engineer uses to add `[Unreleased]` entries.

### JSON Output (--json flag)

```json
{
  "from_tag": "v0.31.0",
  "to_ref": "HEAD",
  "total_commits": 4,
  "skip_count": 1,
  "covered_count": 2,
  "gap_count": 1,
  "coverage_pct": 66.7,
  "gaps": [
    {
      "sha": "jkl3456",
      "subject": "feat(web): new artifact filter sidebar"
    }
  ]
}
```

The JSON schema is a stable interface. See SPEC.md §3 Invariant 6 for the stability contract.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Full coverage — all non-skip commits have matching `[Unreleased]` entries |
| `1` | Coverage gaps found — gap list printed; release must be blocked |
| `2` | Script error (missing args, git not available, CHANGELOG.md not found, etc.) |

The `release` skill orchestration treats exit code `1` as a blocking failure. The engineer must add `[Unreleased]` entries for each gap and re-run.

---

## Remediation Pattern

When the audit exits `1`:

1. Open `CHANGELOG.md`.
2. Under `## [Unreleased]`, add an entry for each commit in the gap list. Follow the categorization rules in `.claude/specs/changelog-spec.md` to determine the correct section (Added / Changed / Fixed / Deprecated / Removed / Security).
3. Commit the CHANGELOG update: `git add CHANGELOG.md && git commit -m "docs(changelog): add missing Unreleased entries for v0.32.0"`
4. Re-run the audit: `python .claude/skills/changelog-sync/scripts/audit-coverage.py FROM_TAG HEAD`
5. Confirm exit code `0`, then proceed with the release flow.

---

## v1.1 Nightly Reconciliation Hook (Placeholder)

This workflow is intentionally single-mode in v1: manual pre-bump invocation only.

A nightly reconciliation mode is planned as BL-1 in `../SPEC.md`. When implemented (v1.1), this section will be extended with:
- Scheduled invocation instructions (cron expression, scheduled-ops-framework-v1 config)
- Notification channel configuration (Slack webhook, GitHub issue)
- Drift threshold settings (warn vs. block thresholds for staleness)

Until the scheduled-ops-framework-v1 Phase 0 milestone is reached, do not add timed or hook-based invocations. The only supported entry point is the manual CLI call above.
