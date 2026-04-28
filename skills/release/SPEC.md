---
schema_version: 2
doc_type: skill_spec
skill_name: release
skill_version: 1.1.0
status: stable
created: 2026-04-16
updated: 2026-04-27
owner: nick
source_docs:
  - .claude/specs/version-bump-spec.md
  - .claude/specs/changelog-spec.md
  - .claude/skills/release/scripts/rollover-changelog.py
related_skills: [changelog-sync, artifact-tracking, dev-execution]
affects_commands: ["/release:bump"]
---

<!-- Convention reference: .claude/specs/artifact-structures/skill-spec-convention.md -->

# release — Skill Specification

> **Reading this file**: This is the versioned capability contract for the `release` skill.
> For invocation-time routing, see `SKILL.md` in this same directory.

---

## 1. Purpose & Scope

**Mission**: Orchestrate end-to-end SkillMeat release operations — version bumping, API contract regeneration, coverage auditing, CHANGELOG rollover, and git tagging — so that agents and human operators can execute a complete, validated release from a single skill invocation.

The `release` skill owns the ordered sequence of steps that transform a development-complete branch into a tagged, published release. It wraps deterministic scripts (`rollover-changelog.py`, `audit-coverage.py`) with an audit gate that prevents tagging when coverage gaps exist, enforces canonical ordering per `version-bump-spec.md`, and surfaces actionable gap reports when the audit fails.

**In scope**:
- Bumping the project version across all canonical locations (per `version-bump-spec.md`)
- Regenerating `openapi.json` from the live FastAPI app
- Regenerating SDK client artifacts that derive from `openapi.json`
- Running `audit-coverage.py` to validate CHANGELOG entry coverage before tagging
- Rolling over `[Unreleased]` to a versioned section using `rollover-changelog.py`
- Creating the git commit, annotated tag, and GitHub release via `gh release create`

**Out of scope**:
- Editing CHANGELOG entries — this skill audits and rolls over; content creation belongs to the developer and the `changelog-sync` skill's capture workflow
- Publishing to PyPI or other package registries — not part of the v1 release flow
- Nightly/scheduled CHANGELOG reconciliation — deferred to v1.1 (see BL-1); requires `scheduled-ops-framework-v1`
- Pre-commit hook installation — deferred to v1.1 (see BL-2)
- CI/CD pipeline integration beyond `gh release create` — out of v1 scope

---

## 2. Capability Coverage

| Intent | Workflow / Section | Canonical Doc |
|--------|-------------------|---------------|
| Bump the project version to a new semver | `workflows/release-orchestration.md §Step 1: Version Bump` | `.claude/specs/version-bump-spec.md` |
| Regenerate `openapi.json` from the live app | `workflows/release-orchestration.md §Step 2: Regen OpenAPI` | `skillmeat/api/CLAUDE.md §Endpoint Inventory Maintenance` |
| Regenerate SDK client from `openapi.json` | `workflows/release-orchestration.md §Step 3: Regen SDK` | — |
| Audit CHANGELOG coverage before tagging | `workflows/release-orchestration.md §Step 4: Audit Gate` | `.claude/specs/changelog-spec.md` |
| Roll over `[Unreleased]` to versioned section | `workflows/release-orchestration.md §Step 5: Rollover` | `.claude/specs/changelog-spec.md` |
| Check skill alignment with new version (advisory) | `workflows/release-orchestration.md §Step 6: Skill Alignment` | `.claude/specs/version-bump-spec.md §6. Skill SPEC.md alignment` |
| Create git commit, annotated tag, GitHub release | `workflows/release-orchestration.md §Step 7: Commit & Tag` | `.claude/specs/version-bump-spec.md §Validation Checklist` |

> When no canonical doc exists for an intent, `—` is shown in the Canonical Doc column. See BL-3 for planned SDK doc gap.

---

## 3. Invariants & Constraints

1. **Audit gate blocks tagging**: `audit-coverage.py` must exit zero before a tag is created. If the audit exits non-zero, the skill presents the gap report and halts. The `--force` flag bypasses the gate — agents must not pass `--force` without explicit human instruction.
   _Source_: Implementation plan SKILL-001, `version-bump-spec.md`

2. **Version-bump-spec is canonical**: All version bump targets (files that must be updated, order of operations, validation checklist) are defined in `.claude/specs/version-bump-spec.md`. The `release` skill must not add, remove, or reorder bump targets independently — amendments require updating `version-bump-spec.md` first.

3. **CHANGELOG rollover precedes tagging**: `rollover-changelog.py` must complete successfully (exit zero, `[Unreleased]` renamed to the new version) before `git tag` is created. A tag must never be cut against a CHANGELOG with `[Unreleased]` as the current-version header.

4. **OpenAPI regeneration precedes SDK regeneration**: `openapi.json` must be regenerated from the live app before any SDK client artifacts are generated. Agents must not skip the OpenAPI step and regenerate the SDK from a stale schema.

5. **Scripts are the authoritative implementation**: `rollover-changelog.py` and `audit-coverage.py` under `scripts/` are the sole implementation of their respective capabilities. Agents must invoke these scripts directly rather than reimplementing their logic inline.

6. **Dry-run is safe; tagging is destructive**: Any step up to and including `rollover-changelog.py --dry-run` is non-destructive and may be run freely. `git tag` and `gh release create` are destructive and require confirmation before execution in interactive contexts.

7. **Rollover idempotency is enforced by the script**: `rollover-changelog.py` warns when `[Unreleased]` is already rolled (no entries) and errors when `[Unreleased]` is absent entirely. The skill must surface these warnings/errors to the operator and halt on error.

---

## 4. Enhancement Backlog

- **[BL-1] Nightly CHANGELOG reconciliation**: Scheduled async job to audit commit-to-changelog coverage daily and file a GitHub issue when gaps exceed a configurable threshold.
  _Status_: deferred
  _Rationale_: Requires `scheduled-ops-framework-v1` Phase 0 (async job infrastructure) to be complete. Revisit when that framework ships. Detailed spec in implementation plan §"Deferred v1.1 Features".

- **[BL-2] Pre-commit hook for changelog warning**: Git `commit-msg` hook that warns (never blocks) when a user-facing commit has no `[Unreleased]` CHANGELOG entry.
  _Status_: **shipped in v1.0.1**
  _Implementation_: `.claude/hooks/check-changelog-entry.sh` + `.claude/hooks/check-changelog-entry.py`; installation instructions in `SKILL.md §Pre-commit Hook` and `.claude/specs/changelog-spec.md §Pre-commit Hook`.
  _Note_: Unblocked from `scheduled-ops-framework-v1` dependency by simplifying to a warn-only `commit-msg` hook with no hook-manager requirement.

- **[BL-3] Jules agent integration for automated gap remediation**: Integrate with Jules to automatically draft CHANGELOG entries for commits that are flagged as missing by `audit-coverage.py`.
  _Status_: deferred
  _Rationale_: Jules integration depends on resolved Jules API contract and stable `changelog-sync` skill v1.1 workflow definitions. Intentionally out of v1 scope per implementation plan §"Design Decisions".

---

## 5. Changelog

### v1.1.0 — 2026-04-27
- Added advisory skill alignment check (Step 6 in orchestration workflow)
- New bash snippet in `version-bump-spec.md §Step 10` surfaces skills whose `aligned_app_version` is behind the release version
- Added `§6. Skill SPEC.md alignment` to the Manual Update Required section of `version-bump-spec.md` (advisory entry, not a hard requirement)
- Capability coverage table updated with new intent row
- Steps 6–8 in `release-orchestration.md` renumbered to 7–9 to accommodate the new advisory step

### v1.0.1 — 2026-04-17
- Shipped BL-2 (pre-commit hook): `.claude/hooks/check-changelog-entry.sh` + `.claude/hooks/check-changelog-entry.py`
- Hook warns (never blocks) when a user-facing commit lacks a `[Unreleased]` CHANGELOG entry
- Added "Pre-commit Hook (optional)" section to `SKILL.md` with installation instructions
- Added "Pre-commit Hook" subsection to `.claude/specs/changelog-spec.md`
- 36-case test suite at `tests/unit/skills/test_check_changelog_entry.py`
- Updated `Out of scope` description: pre-commit hook removed from out-of-scope list

### v1.0.0 — 2026-04-16
- Initial SPEC.md authored
- Capability coverage matrix: 6 intents across 1 orchestration workflow (`release-orchestration.md`)
- Invariants section: 7 non-negotiable rules covering audit gate, version-bump-spec authority, rollover ordering, OpenAPI-SDK ordering, script authority, dry-run safety, and idempotency
- Enhancement backlog: BL-1 through BL-3 (nightly reconciliation, pre-commit hook, Jules integration) — all deferred to v1.1
- Status: stable

---

## 6. Integration Points

| Agent / Command | Invocation Pattern | Notes |
|-----------------|--------------------|-------|
| `lead-pm` | `Skill("release")` | Invokes for end-to-end release coordination; owns the final tagging decision |
| Opus orchestrators | `Skill("release")` | Loaded before delegating version bump + release commit batches |
| `/release:bump` | `Skill("release")` then `Skill("changelog-sync")` | Required skill pair per CLAUDE.md §Command-Skill Bindings |

**Co-loaded with**: `changelog-sync` (required for `/release:bump`; audits coverage before the release skill rolls over the CHANGELOG).

**References**:
- `.claude/specs/version-bump-spec.md` — authoritative bump target list and step-by-step procedure
- `.claude/specs/changelog-spec.md` — CHANGELOG categorization rules, skip patterns, entry conventions
- `.claude/specs/skills-index.md` — skill registry entry for `release` and `changelog-sync`

---

## 7. Success Signals

- Agents invoke `rollover-changelog.py` and `audit-coverage.py` via script path rather than reimplementing changelog logic inline, keeping orchestration prompts under 200 tokens for the script-invocation step.
- The audit gate halts the release flow and presents the gap report when coverage is insufficient; operators never discover missing CHANGELOG entries after a tag is cut.
- `--force` bypass is never passed by an agent without a preceding explicit human instruction in the conversation — agents surface the gap report and ask for confirmation instead.
- CHANGELOG `[Unreleased]` is absent in every tagged commit; `git log --oneline --decorate` shows the rollover commit immediately preceding the tag.
- Dry-run invocations of the full release sequence complete without side effects, allowing agents to preview the release before committing.
- Agents do not re-read `version-bump-spec.md` during a release to discover bump targets — the orchestration workflow encodes the ordered steps so agents follow the script without redundant reads.
- On error (missing `[Unreleased]`, audit gaps, OpenAPI generation failure), the skill halts with a structured error message that names the failed step and the corrective action, rather than producing a partial release state.
