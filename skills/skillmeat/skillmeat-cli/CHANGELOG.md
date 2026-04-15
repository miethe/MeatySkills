---
schema_version: 2
doc_type: changelog
title: "skillmeat-cli Skill — Release History"
status: stable
created: 2026-04-14
updated: 2026-04-14
owner: nick
---

# skillmeat-cli Skill — Changelog

All notable changes to the skillmeat-cli skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

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
