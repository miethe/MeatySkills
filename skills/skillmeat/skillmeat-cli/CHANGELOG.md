---
schema_version: 2
doc_type: changelog
title: "skillmeat-cli Skill — Release History"
status: stable
created: 2026-04-14
updated: 2026-04-27
owner: nick
---

# skillmeat-cli Skill — Changelog

All notable changes to the skillmeat-cli skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [1.2.0] — 2026-04-27

### Added

- **`aligned_app_version` frontmatter**: SPEC.md now tracks `aligned_app_version: 0.35.0` for explicit CLI surface versioning
- **Scaffold remote-repo and PR patterns**: `scaffold-workflow.md` documents `--from-repo`, `--output-pr`, `--use-llm-analyzer`, `--scope`, and `--auto-confirm` flags introduced in v0.35.0
- **Enterprise import flags**: `enterprise-workflow.md` now covers `--filter-type`, `--filter-tag`, `--dry-run`, `--tier`, and `--conflict` options for `enterprise import --from-collection`
- **Snapshot command group**: `versioning-workflow.md` updated to reflect `snapshot` as a proper command group with `snapshot list` as an explicit subcommand
- **`skillmeat discover` coverage**: `discovery-workflow.md` updated from aspirational design to active documentation for the shipped `skillmeat discover` command (v0.35.0); covers text-based intent, `--file`, `--types`, `--bundle`, `--install`, and `--yes` flows; SPEC.md BL-8 promoted to `shipped`

### Changed

- **SPEC.md capability coverage**: Updated from v0.30.3 (9 command groups, 26 subcommands) to v0.35.0 (10 command groups, 30+ subcommands); added `dvcs tiering status` row (new command group, no workflow yet); added `snapshot list` row; corrected scaffold row to point to `scaffold-workflow.md`
- **SPEC.md pending markers removed**: supply-chain, versioning, auth, and enterprise workflows no longer marked "pending 3C.2" — all are active
- **SKILL.md route table**: Scaffold row description expanded to include remote-repo and PR generation use cases

---

## [1.1.0] — 2026-04-14

### Added

- **SPEC.md**: Introduced skill specification with capability coverage matrix, invariants, and enhancement backlog
- **Consolidated supply-chain workflow**: Merged BOM signing, verification, and attestation operations into single unified workflow
- **Consolidated versioning workflow**: Merged snapshot, history, and rollback operations into single workflow

### Changed

- **SKILL.md**: Rewritten as lean route-table (<150 lines) with intent → workflow → canonical docs mapping
- **Workflow restructuring**: Reduced from 13 files to 8 core workflows, each under 400 lines
- **Progressive disclosure**: All workflows now reference canonical CLI docs as source of truth; removed duplicated command syntax
- **References**: Updated capability-router to map 8 core workflows; archived deprecated reference materials

### Removed

- **7 speculative workflows**: Archived rating-system, caching, confidence-integration, context-boosting, gap-detection, advanced-integration, agent-self-enhancement (no CLI surface)
- **Duplicate content**: Consolidated integration-tests.md reference (archived, user docs are source of truth)

### Deprecated

- `references/integration-tests.md`: Superseded by canonical user docs at `docs/user/guides/cli/commands.md`

---

## [1.0.0] — 2026-04-14

### Initial Release

- **skillmeat-cli skill** established as primary agent interface for SkillMeat CLI operations
- **13 initial workflows**: discovery, deployment, management, bundle, scaffold, memory-context, auth, enterprise, supply-chain (bom), versioning (snapshot/history), error-handling, plus speculative workflows
- **Coverage**: 49 CLI commands across 15 command groups (init, add, deploy, list, search, bundle, scaffold, template, memory, auth, enterprise, bom, attest, snapshot, history, rollback, etc.)
