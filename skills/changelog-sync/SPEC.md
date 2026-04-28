---
schema_version: 2
doc_type: skill_spec
skill_name: changelog-sync
skill_version: 1.0.1
status: stable
created: 2026-04-16
updated: 2026-04-17
owner: nick
source_docs:
  - .claude/specs/changelog-spec.md
  - .claude/skills/changelog-sync/scripts/audit-coverage.py
related_skills: [release, artifact-tracking]
affects_commands: [/release:bump]
---

# changelog-sync Skill SPEC

## 1. Purpose & Scope

The `changelog-sync` skill provides read-only CHANGELOG coverage auditing for a given git range. Its mission is to surface gaps between merged commits and recorded `[Unreleased]` entries before a release is cut, allowing humans to remediate the gaps rather than silently shipping an incomplete changelog.

**In scope**:
- Auditing coverage for a git commit range (FROM_TAG to TO_REF)
- Filtering commits against skip-patterns defined in `.claude/specs/changelog-spec.md`
- Producing a coverage table and an actionable gap list
- Exiting non-zero when at least one non-skip-patterned commit has no matching CHANGELOG entry
- Acting as the audit gate component inside the `release` skill's pre-bump flow

**Out of scope**:
- Writing or modifying CHANGELOG.md entries (human responsibility)
- Rolling over `[Unreleased]` to a versioned section (handled by `release` skill via `rollover-changelog.py`)
- Scheduling or running audits on a timer (v1.1 — requires scheduled-ops-framework-v1)
- Interactive gap resolution or Jules integration (v1.1 — deferred)
- Any mutation of git history, tags, or the working tree

---

## 2. Capability Coverage

| Intent | Workflow / Section | Canonical Doc |
|--------|--------------------|---------------|
| Audit CHANGELOG coverage for a git range | `workflows/audit-workflow.md` | `.claude/specs/changelog-spec.md` |
| Understand skip-pattern rules | `workflows/audit-workflow.md §Skip Patterns` | `.claude/specs/changelog-spec.md §Skip Patterns` |
| Interpret audit exit codes | `workflows/audit-workflow.md §Exit Codes` | `scripts/audit-coverage.py --help` |
| Consume machine-readable audit output | `workflows/audit-workflow.md §JSON Output` | `scripts/audit-coverage.py --json` |

---

## 3. Invariants & Constraints

1. **Audit is strictly read-only.** The skill and its underlying script must never modify CHANGELOG.md, the git index, or any tracked file. Any write operation is a defect.

2. **Exit non-zero on coverage gaps.** When one or more non-skip-patterned commits have no matching CHANGELOG entry, `audit-coverage.py` MUST exit with a non-zero status code. Callers (e.g., the `release` skill orchestration flow) must treat this as a blocking failure unless `--force` is explicitly passed.

3. **Skip-patterns are authoritative in changelog-spec.** The set of commit prefixes and patterns that exempt a commit from coverage requirements is defined solely in `.claude/specs/changelog-spec.md`. The script reads this definition; the skill must not duplicate or override it inline.

4. **v1 supports a single audit flow only.** There is no scheduled, webhook-triggered, or CI-integrated path in v1. The sole entry point is the CLI invocation documented in `workflows/audit-workflow.md`. Nightly or commit-hook variants are v1.1 scope.

5. **Human remediation only.** The skill surfaces gaps and stops. It does not propose changelog entries, auto-commit fixes, or invoke Jules. Gap resolution is a human action performed before re-running the audit.

6. **`--json` output is stable contract.** The JSON schema emitted by `audit-coverage.py --json` is a stable interface consumed by the `release` skill orchestration. Breaking changes to that schema require a MINOR version bump of this SPEC.

---

## 4. Enhancement Backlog

- **[BL-1] Nightly reconciliation cron**: Schedule `audit-coverage.py` to run against the current branch nightly and post a summary to a configured Slack channel or GitHub comment.
  _Status_: deferred
  _Rationale_: Requires scheduled-ops-framework-v1 Phase 0 completion for async job scheduling and webhook infrastructure. Promotion trigger: framework available and integrated.

- **[BL-2] Jules interactive gap resolution**: After surfacing gaps, invoke Jules agent to draft candidate CHANGELOG entries for human review and one-click acceptance.
  _Status_: deferred
  _Rationale_: Depends on BL-1 (scheduled ops) and Jules agent API stability. Deferred to v1.1 planning cycle.

- **[BL-3] Pre-commit hook integration**: Run a lightweight coverage check on `git commit` for commits that modify feature code, warning if `[Unreleased]` has not been updated in the same changeset.
  _Status_: **shipped in v1.0.1** (as part of release skill v1.0.1)
  _Implementation_: `.claude/hooks/check-changelog-entry.sh` + `.claude/hooks/check-changelog-entry.py`; optional manual installation documented in `release/SKILL.md §Pre-commit Hook` and `.claude/specs/changelog-spec.md §Pre-commit Hook`.
  _Note_: Unblocked from scheduled-ops-framework-v1 dependency by implementing as a warn-only `commit-msg` hook requiring no hook manager.

---

## 5. Changelog

### v1.0.1 — 2026-04-17
- BL-3 shipped: pre-commit hook (`commit-msg`) warns when user-facing commit lacks `[Unreleased]` entry
- Hook files: `.claude/hooks/check-changelog-entry.sh`, `.claude/hooks/check-changelog-entry.py`
- Updated BL-3 status from deferred to shipped; noted unblocking rationale

### v1.0.0 — 2026-04-16
- Initial SPEC.md authored as part of changelog-release-automation-v1 Phase 3
- Capability coverage matrix: 4 intents mapped to `workflows/audit-workflow.md`
- 6 invariants defined (read-only constraint, exit-code contract, skip-pattern source, v1 single-flow, human-only remediation, JSON stability)
- Enhancement backlog: BL-1 (nightly), BL-2 (Jules), BL-3 (pre-commit) — all deferred on scheduled-ops-framework-v1

---

## 6. Integration Points

| Agent / Command | Invocation | Notes |
|-----------------|------------|-------|
| `release` skill orchestration | Script invoked directly: `python .claude/skills/changelog-sync/scripts/audit-coverage.py FROM_TAG TO_REF` | Audit gate in pre-bump flow; non-zero exit blocks tag unless `--force` passed |
| `/release:bump` | Loads `release` skill which delegates here | Indirect invocation via release orchestration flow |
| `python-backend-engineer` | `Skill("changelog-sync")` | Used when implementing or debugging audit behavior |
| `dev-execution` checklist | Phase completion gate reference | Checklist items reference this skill for pre-release audit step |

---

## 7. Success Signals

- Audit runs complete in under 5 seconds for typical release ranges (< 200 commits).
- Coverage table output is human-readable without post-processing: commit SHA, subject, and coverage status on one line each.
- `--json` flag produces valid JSON that the `release` skill parses without errors on every invocation.
- Zero false positives: skip-patterned commits (docs, chore, refactor, test) never appear in the gap list.
- Pre-release audit blocks the tag on the first invocation when gaps exist, giving the engineer a clear list of commits needing entries.
- After human remediation, a second audit invocation exits 0 and the release flow proceeds uninterrupted.
