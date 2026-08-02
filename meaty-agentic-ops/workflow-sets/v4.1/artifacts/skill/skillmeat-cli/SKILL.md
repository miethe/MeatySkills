---
name: skillmeat-cli
description: |
  Manage SkillMeat and Claude Code environments through natural language.
  Use this skill for artifact discovery/deployment/management, bundles,
  MCP and context entity operations, and Memory & Context workflows.
  This skill uses progressive disclosure: load only the specific workflow or
  reference docs needed for the current user request.
---

# SkillMeat CLI Skill

High-level orchestrator for SkillMeat capabilities.

This file is intentionally concise. Use it to route to focused docs in
`references/` and `workflows/` based on user intent.

**AOS correlation:** artifact manifests and exports produced by AOS runs should preserve
`aos_artifact_uuid`, parent `aos_feature_uuid`/`aos_run_uuid`, and native aliases. Contract:
`docs/agentic-operator/contracts/aos-correlation.md`.

## Progressive Disclosure Rules

1. Start from user intent, not from command memorization.
2. Open only the minimal docs needed for the task.
3. Do not load every workflow file by default.
4. Prefer one primary workflow doc plus one reference doc when needed.
5. If memory CLI commands are unavailable, fall back to API equivalents and
   state that fallback explicitly.

Use routing map:
- `./references/capability-router.md`

## Capability Coverage

This skill covers:

- Artifact discovery and recommendations
- Artifact deployment and update management
- **Orchestration scripts** (Claude Code Dynamic Workflows — flat `.js/.ts/.py/.sh`) as first-class deployable artifacts
- Collection and sync operations
- Bundle create/import/sign/inspect workflows
- MCP and context entity command usage
- Confidence scoring, context boosting, gap detection
- Caching/performance-aware operation
- Error handling and recovery patterns
- Memory & Context workflows (item/module/pack/extract/search)

## Claude Code Dynamic Workflows (ORCHESTRATION) — do not conflate with WORKFLOW

Claude Code Dynamic Workflow definition files (the flat scripts the `Workflow` tool runs,
e.g. `.claude/workflows/execute-plan.js`) **are deployable SkillMeat artifacts** — type
**`orchestration`**. They are *not* a SkillMeat-internal concept, and they are *distinct*
from SkillMeat's own `workflow` type. Treating a `.claude/workflows/*.js` file as
"skillmeat-native / not deployable" is the classic mistake — deploy it like any artifact.

| | **ORCHESTRATION** (`orchestration`) | **WORKFLOW** (`workflow`) |
|---|---|---|
| What | Claude Code Dynamic Workflow script | SkillMeat multi-stage execution process |
| Shape | flat file: `.js` / `.ts` / `.py` / `.sh` | directory + manifest (`WORKFLOW.yaml/json`) |
| Deploys to | `.claude/workflows/<name>.js` (extension preserved) | SkillMeat-managed workflow definition |
| Add | `skillmeat add orchestration <file>` | (managed via `workflow` commands) |

```bash
# Add a Claude Code Dynamic Workflow to the collection, then deploy it to a project:
skillmeat add orchestration .claude/workflows/execute-plan.js --yes
skillmeat deploy execute-plan --project .        # → .claude/workflows/execute-plan.js
```

Only local paths are accepted for `add orchestration` (not fetched from GitHub). Full flow:
`./workflows/deployment-workflow.md` § "Claude Code Dynamic Workflows (ORCHESTRATION)".

## Intent Routing

When a request arrives, route it first:

1. Capability discovery/search/recommendation:
- Open `./workflows/discovery-workflow.md`
- Optional: `./workflows/gap-detection.md`

2. Deploy/add artifact to project:
- Open `./workflows/deployment-workflow.md`
- **Includes Claude Code Dynamic Workflow scripts** (`.claude/workflows/*.js` etc.) — see § "Claude Code Dynamic Workflows (ORCHESTRATION)". Add with `skillmeat add orchestration <file>`, deploy like any artifact.

3. Inspect/update/remove/sync artifacts:
- Open `./workflows/management-workflow.md`

3a. Pre-execution artifact provisioning (manifest-driven deploy/teardown for a project's declared
    artifact set — `.claude/aos-artifacts.yaml` + a plan's `required_artifacts`):
- Open `./workflows/provisioning-workflow.md`
- Rule: `.claude/rules/artifact-provisioning.md`

4. Share/import setups and signing:
- Open `./workflows/bundle-workflow.md`

5. Confidence/context-aware recommendation logic:
- Open `./workflows/context-boosting.md`
- Optional: `./workflows/confidence-integration.md`

6. Memory capture/consumption flows:
- Open `./workflows/memory-context-workflow.md`
- Optional: `./references/agent-integration.md` (integration pattern)

7. CLI command syntax quick lookup:
- Open `./references/command-quick-reference.md`

8. Troubleshooting failures:
- Open `./workflows/error-handling.md`

9. claudectl alias behavior/setup:
- Open `./references/claudectl-setup.md`

## Memory & Context Handling Policy

When user asks for memory operations:

1. Prefer target CLI surface:
- `skillmeat memory item ...`
- `skillmeat memory module ...`
- `skillmeat memory pack ...`
- `skillmeat memory extract ...`
- `skillmeat memory search ...`

2. Verify availability quickly:
```bash
skillmeat memory --help
```

3. If CLI returns 422/400 (common for `memory item create`), use API fallback:
- `POST /api/v1/memory-items?project_id=<BASE64_ID>` — create items (anchors as string array)
- `GET /api/v1/memory-items?project_id=<BASE64_ID>&status=candidate` — list items
- `/api/v1/context-modules` — module operations
- `/api/v1/context-packs/preview` and `/generate` — pack operations
- See `workflows/memory-context-workflow.md` § "API Fallback Procedure" for proven curl patterns

4. Safety defaults:
- Keep extracted memories as `candidate`
- Do not auto-promote extracted items
- Confirm before bulk/deprecate/merge operations

## Permission Protocol

For mutating actions, require explicit user confirmation:

- Deploying artifacts
- Bulk updates/removals
- Memory extraction apply
- Memory merges and bulk lifecycle changes

Allowed without extra confirmation (read-only):

- Search/list/show/preview commands
- Diagnostics and health checks

## Output Expectations

- Be explicit about what command/action is being taken.
- Report important command results clearly and briefly.
- When using fallback paths, state fallback reason in one sentence.
- Keep recommendations concrete and tied to current task context.

## Recommended Starting Point

For most tasks:

1. Open `./references/capability-router.md`
2. Select one primary workflow file
3. Execute and report results
