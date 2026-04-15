---
schema_version: 2
doc_type: skill_spec
skill_name: skillmeat-cli
skill_version: 1.1.0
status: stable
created: 2026-04-14
updated: 2026-04-14
owner: nick
source_docs:
  - docs/user/guides/cli/commands.md
  - docs/user/guides/cli/reference.md
related_skills:
  - artifact-tracking
  - planning
  - debug
affects_commands: []
---

<!-- Convention reference: .claude/specs/skill-spec-convention.md -->

# skillmeat-cli — Skill Specification

> **Reading this file**: This is the versioned capability contract for the `skillmeat-cli` skill.
> For invocation-time routing, see `SKILL.md` in this same directory.

---

## 1. Purpose & Scope

**Mission**: Enable agents to orchestrate SkillMeat CLI operations — artifact lifecycle, bundle management, supply-chain security, memory workflows, authentication, and enterprise migration — using natural language, while always deferring to canonical user docs as the authoritative source of command syntax.

**In scope**:
- Artifact discovery, deployment, update, and removal (`list`, `show`, `deploy`, `remove`)
- Bundle lifecycle: create, add/remove members, publish, import, export, deploy (`bundle *`)
- Scaffold and template operations: render from bundle, manage templates (`scaffold`, `template *`)
- Supply-chain security: BOM signing, verification, key generation, restoration, pre-commit hooks (`bom *`, `attest *`)
- Version and history: activity history, rollback, snapshot management (`history`, `snapshot`, `rollback`)
- Authentication: device-code OAuth, PAT storage, credential lifecycle (`auth login`, `auth token`, `auth logout`)
- Enterprise migration: collection import to enterprise edition (`enterprise import --from-collection`)
- Memory & Context: item creation, consumption, context pack previews (via `skillmeat memory *` and API fallback)
- Error recovery: network errors, rate limits, validation failures, retry patterns (cross-cutting)

**Out of scope**:
- Internal application logic in `skillmeat/core/`, `skillmeat/api/`, or `skillmeat/cache/` — use `python-backend-engineer` or `data-layer-expert`
- Speculative agent capabilities without current CLI surface: confidence scoring, context boosting, gap detection, rating system, advanced integration, agent self-enhancement, multi-layer caching — see Enhancement Backlog (§4)
- Web UI operations — use `ui-engineer-enhanced` or `frontend-developer`
- Writing or modifying the SkillMeat codebase itself
- Generating new skills or agent prompts — use `skill-creator` or `ai-artifacts-engineer`

---

## 2. Capability Coverage

Intents map to workflow files in `workflows/` and to the canonical user docs agents must consult for authoritative command syntax. When a workflow file does not yet exist (marked "new — pending 3C"), it will be created in Phase 3C of the refresh plan.

| Intent | Workflow / Section | Canonical Doc |
|--------|--------------------|---------------|
| Find, search, or recommend an artifact | `workflows/discovery-workflow.md` | `docs/user/guides/cli/commands.md § "Core Commands"` |
| Deploy or add an artifact to a project | `workflows/deployment-workflow.md` | `docs/user/guides/cli/commands.md § "Deployment"` |
| List, inspect, sync, or remove artifacts | `workflows/management-workflow.md` | `docs/user/guides/cli/commands.md § "Core Commands"` |
| Create, sign, publish, import, or export a bundle | `workflows/bundle-workflow.md` | `docs/user/guides/cli/commands.md § "Bundle"` — pending rename to `bundle-and-scaffold-workflow.md` in 3C.2 |
| Render scaffold files or manage templates | `workflows/bundle-workflow.md` | `docs/user/guides/cli/commands.md § "Scaffold"` and `§ "Template"` |
| Sign, verify, or restore artifacts via BOM; manage Ed25519 keys; install/uninstall pre-commit hooks | new — pending 3C.2: `workflows/supply-chain-workflow.md` | `docs/user/guides/cli/commands.md § "SkillBOM"` |
| View artifact activity history, rollback to a version, or restore a snapshot | new — pending 3C.2: `workflows/versioning-workflow.md` | `docs/user/guides/cli/commands.md § "Versioning"` |
| Authenticate via device-code OAuth, store a PAT, or revoke credentials | new — pending 3C.2: `workflows/auth-workflow.md` | `docs/user/guides/cli/commands.md § "Authentication"` |
| Create, list, or show attestation records | new — pending 3C.2: `workflows/supply-chain-workflow.md` | `docs/user/guides/cli/commands.md § "Attestation"` |
| Migrate a local collection to enterprise edition | new — pending 3C.2: `workflows/enterprise-workflow.md` | `docs/user/guides/cli/commands.md § "Core Commands"` |
| Capture, search, or consume memory items; preview or load context packs | `workflows/memory-context-workflow.md` | `CLAUDE.md § "Memory System"` and `skillmeat/api/CLAUDE.md` |
| Recover from errors: network failures, rate limits, validation errors | `workflows/error-handling.md` | `docs/user/guides/cli/reference.md § "Exit Codes"` |
| CLI command syntax quick lookup | `references/command-quick-reference.md` | `docs/user/guides/cli/reference.md` |

> When no canonical doc exists for an intent, `—` appears in the Canonical Doc column; a backlog entry in §4 tracks the work to create one.

---

## 3. Invariants & Constraints

1. **Canonical docs are the source of truth for command syntax**: Agents must route to `docs/user/guides/cli/commands.md` or `docs/user/guides/cli/reference.md` for all command flags, argument formats, and exit codes. Workflow files provide agent-specific patterns (e.g., batch strategies, error recovery); they do not duplicate command syntax from user docs.

2. **Progressive disclosure — open only what is needed**: Agents must open the single most relevant workflow file for the current intent. Loading all workflow files by default is a violation of this invariant. See `SKILL.md § "Progressive Disclosure Rules"`.

3. **No speculative CLI coverage**: Workflow files must only document features with a live CLI surface (i.e., a command in `skillmeat/cli/commands/`). Aspirational or backend-only features belong in the Enhancement Backlog (§4), not in active workflows. Agents must not guide users toward commands that do not exist.
   _Source_: gap matrix at `.claude/worknotes/skill-spec-convention-and-skillmeat-cli-refresh/cli-audit-gap-matrix.md § "Speculative Workflows"`

4. **Workflow files must stay under 400 lines**: Any workflow file exceeding 400 lines must be split, with the overflow in a supporting reference file. This limit ensures agents load concise, targeted context.
   _Source_: `.claude/plans/skill-spec-convention-and-skillmeat-cli-refresh.md § "Phase 3C"`

5. **Memory CLI fallback is explicit**: When `skillmeat memory item create` returns a 422 or 400, agents must fall back to the API endpoint documented in `CLAUDE.md § "Memory System"` and state the fallback explicitly in their output.
   _Source_: `.claude/rules/memory.md` invariant 2

6. **No duplication of SKILL.md routing content**: This SPEC.md documents the capability contract; `SKILL.md` documents invocation-time routing. Content must not be copied between them. Cross-reference by section name only.
   _Source_: `.claude/specs/skill-spec-convention.md § "2.3 Anti-patterns"`

7. **SPEC.md must be updated in the same commit as source docs**: When `docs/user/guides/cli/commands.md` or `docs/user/guides/cli/reference.md` change (new commands, renamed flags), the Capability Coverage table in this SPEC.md must be updated in the same commit.
   _Source_: `.claude/specs/skill-spec-convention.md § "3.3 Staleness Protocol"`

---

## 4. Enhancement Backlog

Ideas from the 7 archived speculative workflows are preserved here. Each entry includes the source workflow archived and the CLI prerequisite that would trigger restore.

- **[BL-1] Rating system**: Allow agents to record post-deployment artifact ratings to improve future recommendations via `skillmeat rate <artifact> --score <1-5>`.
  _Status_: deferred
  _Source workflow archived_: `workflows/archived/rating-system.md` (1148 lines)
  _CLI prerequisite_: `skillmeat rate` command ships in CLI surface.
  _Rationale_: No current CLI command; rating logic lives in backend API only. Restore when `skillmeat rate` is added to `skillmeat/cli/commands/`.

- **[BL-2] Multi-layer caching guidance**: Document agent-facing cache management: metadata TTL, search result caching, score cache invalidation.
  _Status_: deferred
  _Source workflow archived_: `workflows/archived/caching.md` (1052 lines)
  _CLI prerequisite_: `skillmeat cache *` commands exist (`cache status`, `cache refresh`, `cache clear`, `cache config`) but are internal optimization; restore when agent-facing cache tuning workflows are needed.
  _Rationale_: Current cache commands are admin/infrastructure. No agent workflow needed yet.

- **[BL-3] Confidence scoring integration**: Guide agents to use match API confidence scores when selecting between candidate artifacts (`/api/v1/match` with semantic + keyword scoring).
  _Status_: deferred
  _Source workflow archived_: `workflows/archived/confidence-integration.md` (708 lines)
  _CLI prerequisite_: CLI wrapper for `/api/v1/match` with score output; or `skillmeat match --verbose` flag.
  _Rationale_: Match API exists (`docs/user/guides/cli/commands.md § "Scoring and Matching"`) but confidence integration patterns are internal to the API layer; no agent-facing CLI workflow yet.

- **[BL-4] Context boosting**: Adjust artifact recommendations based on project type analysis (e.g., boost Python skills for Python repos).
  _Status_: deferred
  _Source workflow archived_: `workflows/archived/context-boosting.md` (817 lines)
  _CLI prerequisite_: `skillmeat match --context-boost` or equivalent flag that surfaces project-type scoring.
  _Rationale_: Context analysis lives in `skillmeat/core/services/`; no agent-facing CLI surface exists yet.

- **[BL-5] Automatic gap detection**: Proactively suggest missing capabilities by analyzing current project `.claude/` contents against available artifacts.
  _Status_: candidate
  _Source workflow archived_: `workflows/archived/gap-detection.md` (718 lines)
  _CLI prerequisite_: `skillmeat suggest` command or equivalent agent-facing gap analysis command.
  _Rationale_: High value for orchestrators; blocked on CLI surface. Good candidate for a near-term spike.

- **[BL-6] Agent self-enhancement**: Enable agents to detect their own capability gaps and invoke `skillmeat add` autonomously to fill them mid-task.
  _Status_: deferred
  _Source workflow archived_: `workflows/archived/agent-self-enhancement.md` (271 lines)
  _CLI prerequisite_: Depends on BL-5 (gap detection); also requires confirmed permission model for autonomous installs.
  _Rationale_: Blocked on BL-5 and on defining safe autonomy boundaries. Revisit after BL-5 ships.

- **[BL-7] Advanced agent integration patterns**: Proactive artifact suggestions during task planning; deep integration with dev-execution workflow.
  _Status_: deferred
  _Source workflow archived_: `workflows/archived/advanced-integration.md` (651 lines)
  _CLI prerequisite_: None strictly required, but depends on BL-3 (confidence) and BL-5 (gap detection) for meaningful signal.
  _Rationale_: Aspirational orchestration patterns; premature to document until confidence + gap-detection workflows are stable.

- **[BL-8] Discovery CLI surface**: Natural-language artifact discovery via a dedicated CLI command rather than guided agent search patterns.
  _Status_: candidate
  _Source workflow_: `workflows/discovery-workflow.md` (598 lines, retained as future design doc)
  _CLI prerequisite_: `skillmeat search <query>` already exists; `skillmeat discover` or `skillmeat recommend` for intent-based matching.
  _Rationale_: Current discovery-workflow.md is aspirational; `skillmeat search` covers basic cases. Evaluate after BL-3 (confidence scoring) is available.

- **[BL-9] Memory CLI reliability**: Resolve `skillmeat memory item create` returning 422 so API fallback is not required in normal workflows.
  _Status_: planned
  _Rationale_: API fallback is documented and functional but adds friction. Fix should be in `skillmeat/cli/commands/memory.py` argument parsing.

---

## 5. Changelog

### v1.0.0 — 2026-04-14

- Initial SPEC.md authored at stable status (skipping draft; published directly as part of Phase 3B.1)
- Capability coverage matrix: 13 intents across 8 active workflows (6 existing + 4 pending 3C.2 consolidations)
- Reflects post-audit state: 13 workflows audited → 6 active core, 4 new consolidations pending, 7 archived speculative
- Enhancement Backlog: 9 entries absorbing ideas from 7 archived workflows (rating-system, caching, confidence-integration, context-boosting, gap-detection, agent-self-enhancement, advanced-integration)
- Aligned to CLI surface as of SkillMeat v0.30.3 (9 command groups, 26 subcommands)
- Phase reference: `.claude/plans/skill-spec-convention-and-skillmeat-cli-refresh.md § "3B.1"`

---

## 6. Integration Points

Agents that invoke this skill and the context in which they use it:

| Agent / Command | Invocation Pattern | Notes |
|-----------------|--------------------|-------|
| `python-backend-engineer` | `Skill("skillmeat-cli")` | Uses memory-context and error-handling workflows when implementing CLI-adjacent backend features |
| `ui-engineer-enhanced` | `Skill("skillmeat-cli")` | References management and deployment workflows when building artifact list/deploy UI interactions |
| `lead-architect` | `Skill("skillmeat-cli")` | Uses discovery and bundle workflows when planning feature scaffolding |
| `lead-pm` | `Skill("skillmeat-cli")` | Uses management and memory-context workflows for request-log and tracking operations |
| `feature-planner` | `Skill("skillmeat-cli")` | References capability coverage when scoping CLI-dependent features |
| `platform-engineer` | `Skill("skillmeat-cli")` | Uses supply-chain and auth workflows for enterprise deployment and credential management |
| `spike-writer` | `Skill("skillmeat-cli")` | References discovery and bundle workflows when writing CLI integration spikes |

**Co-loaded with**: `artifact-tracking` when progress updates are required alongside CLI operations. `planning` when CLI workflows are part of a multi-phase plan.

**No `/dev:*` command bindings**: This skill has no automatic binding to dev workflow commands. Agents invoke it explicitly via `Skill("skillmeat-cli")`.

---

## 7. Success Signals

- Agents route to the correct single workflow file on first attempt, without opening multiple workflow files or re-reading `SKILL.md` mid-task.
- Agents cite `docs/user/guides/cli/commands.md` or `docs/user/guides/cli/reference.md` when providing command syntax — not workflow files — confirming canonical doc routing is working.
- No agent produces a `skillmeat` command invocation that does not exist in the CLI surface (i.e., no speculative commands from archived workflows leak into agent output).
- When `skillmeat memory item create` returns 422, agents immediately switch to the API fallback and state the fallback explicitly, without requiring a re-prompt — confirming invariant 5 is enforced.
- Token usage per typical intent stays under 8,000 tokens: a routing read of `SKILL.md` (~100 tokens) plus one workflow file (~400 lines × ~18 tokens/line ≈ 7,200 tokens), without cascading reads of all 13 workflow files.
- The 4 pending workflow files (supply-chain, versioning, auth, enterprise) are created in Phase 3C.2 before agents report routing failures for those intents.
- Quarterly review finds the Capability Coverage table (§2) matches the current CLI surface — no stale `[stale - verify]` markers remain for more than one quarter.
