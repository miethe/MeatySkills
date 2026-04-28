---
name: release
description: "End-to-end release orchestration for SkillMeat. Routes five intents (version bump, regen openapi, regen SDK, audit coverage, rollover changelog) to the single linear release-orchestration workflow. Use when running /release:bump or coordinating a tagged release."
version: 1.1
updated: 2026-04-27
spec: ./SPEC.md
---

# Release Skill

Orchestration guidance for executing a complete, validated SkillMeat release — from version bump through git tag and GitHub release creation.

## Quick Start

Load this skill when:
- Running `/release:bump`
- Preparing a tagged release on main
- Running a dry-run preview of the full release sequence
- Investigating why the audit gate rejected a tag

**Always co-load with `changelog-sync`** when invoked via `/release:bump` (required pair per CLAUDE.md Command-Skill Bindings).

## Route Table

| Intent | Workflow Section | Canonical Spec |
|--------|-----------------|----------------|
| Bump the project version to a new semver | `workflows/release-orchestration.md §Step 1: Version Bump` | `.claude/specs/version-bump-spec.md` |
| Regenerate `openapi.json` from the live app | `workflows/release-orchestration.md §Step 2: Regen OpenAPI` | `skillmeat/api/CLAUDE.md §Endpoint Inventory Maintenance` |
| Regenerate SDK client from `openapi.json` | `workflows/release-orchestration.md §Step 3: Regen SDK` | `.claude/specs/version-bump-spec.md §3. OpenAPI Spec + Generated SDK` |
| Audit CHANGELOG coverage before tagging | `workflows/release-orchestration.md §Step 4: Audit Gate` | `.claude/specs/changelog-spec.md` |
| Roll over `[Unreleased]` to versioned section | `workflows/release-orchestration.md §Step 5: Rollover Changelog` | `.claude/specs/changelog-spec.md`, `.claude/specs/version-bump-spec.md §CHANGELOG Roll-Forward` |
| Check skill alignment with new version | `workflows/release-orchestration.md §Step 10: Skill Alignment` | `.claude/specs/version-bump-spec.md §6. Skill SPEC.md alignment` |
| Commit, tag, and create GitHub release | `workflows/release-orchestration.md §Step 7–9: Commit, Tag, Release` | `.claude/specs/version-bump-spec.md §Git Tagging` |

## Execution

For a full release, read `workflows/release-orchestration.md` and follow the steps in order. The workflow is a single linear flow — steps are not optional and cannot be reordered.

**Dry-run** (non-destructive preview through Step 5):

```bash
# Dry-run everything up to and including changelog rollover
python .claude/skills/release/scripts/rollover-changelog.py \
  --version X.Y.Z --date YYYY-MM-DD --dry-run
```

Steps 7–9 (commit, tag, release) are always destructive; confirm with the operator before executing.

## Audit Gate Policy

`audit-coverage.py` must exit zero before a tag is created. If it exits non-zero:

1. Print the full gap list to the operator.
2. Halt — do not proceed to rollover, commit, or tag.
3. Ask the operator to update `[Unreleased]` to cover the flagged commits, then re-run.

The `--force` flag bypasses the audit gate. **Agents must never pass `--force` without an explicit human instruction in the current conversation.** When a human operator passes `--force`, the workflow must print a visible warning and ask for confirmation before continuing. See `workflows/release-orchestration.md §Force-Bypass Protocol`.

## Key Invariants

1. Audit gate blocks tagging — `audit-coverage.py` exit zero is a hard prerequisite.
2. `version-bump-spec.md` is the authoritative list of bump targets — do not add targets here.
3. CHANGELOG rollover (`rollover-changelog.py`) must complete before `git tag` is created.
4. OpenAPI regeneration must precede SDK regeneration — never skip or reverse the order.
5. Scripts are the sole implementation — invoke them; do not reimplement their logic.

Full invariant set: `SPEC.md §3. Invariants & Constraints`

## Pre-commit Hook (optional)

A `commit-msg` hook warns (but never blocks) when a user-facing commit is made without a corresponding `[Unreleased]` CHANGELOG entry.

### Installation

```bash
# Run from the repository root
ln -s ../../.claude/hooks/check-changelog-entry.sh .git/hooks/commit-msg
```

The symlink is relative so it survives directory renames. Uninstall by removing `.git/hooks/commit-msg`.

### Behaviour

- Skips commits whose subject matches a skip prefix (`chore`, `refactor`, `test`, `docs`, `ci`, `build`, `style`, merge commits, version bumps).
- For all other commits, checks whether `CHANGELOG.md` is staged with an `[Unreleased]` diff line.
- If no `[Unreleased]` update is staged, prints a warning to stderr and exits 0.
- Never blocks: always exits 0.

### Opt-out (single commit)

```bash
SKILLMEAT_SKIP_CHANGELOG_CHECK=1 git commit ...
```

### Files

| File | Purpose |
|------|---------|
| `.claude/hooks/check-changelog-entry.sh` | Shell wrapper (symlink target) |
| `.claude/hooks/check-changelog-entry.py` | Python helper with detection logic |
| `tests/unit/skills/test_check_changelog_entry.py` | Test suite (36 cases) |

Full specification: `.claude/specs/changelog-spec.md §Pre-commit Hook`

---

## Detailed References

- **Orchestration flow**: `./workflows/release-orchestration.md`
- **Capability contract**: `./SPEC.md`
- **Version bump targets**: `.claude/specs/version-bump-spec.md`
- **CHANGELOG rules**: `.claude/specs/changelog-spec.md`
- **Audit script**: `.claude/skills/release/scripts/audit-coverage.py`
- **Rollover script**: `.claude/skills/release/scripts/rollover-changelog.py`
