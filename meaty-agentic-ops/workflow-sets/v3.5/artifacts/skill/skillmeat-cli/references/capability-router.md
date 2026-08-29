# Capability Router (Progressive Disclosure)

Use this file to map user intent to the minimum docs needed.

## Quick Router

| Intent | Primary Doc | Optional Doc |
|---|---|---|
| Find artifacts for a task | `../workflows/discovery-workflow.md` | `../workflows/gap-detection.md` |
| Deploy/add artifacts | `../workflows/deployment-workflow.md` | `../references/agent-integration.md` |
| Deploy a Claude Code Dynamic Workflow script (`.claude/workflows/*.js`) | `../workflows/deployment-workflow.md` § "Claude Code Dynamic Workflows (ORCHESTRATION)" | — |
| Manage/sync/remove artifacts | `../workflows/management-workflow.md` | `../workflows/caching.md` |
| Share/import bundles | `../workflows/bundle-workflow.md` | `../references/integration-tests.md` |
| MCP/context entities commands | `./command-quick-reference.md` | `../references/agent-integration.md` |
| Recommendation quality/scoring | `../workflows/context-boosting.md` | `../workflows/confidence-integration.md` |
| Error recovery | `../workflows/error-handling.md` | `./integration-tests.md` |
| Memory consume/capture loop | `../workflows/memory-context-workflow.md` | `./agent-integration.md` |
| claudectl alias setup/behavior | `./claudectl-setup.md` | `./command-quick-reference.md` |

## Memory Request Router

If user asks for memory capabilities, choose path:

1. "Generate context for current task"
- Open `../workflows/memory-context-workflow.md`
- Use pack preview/generate flow

2. "Capture learnings from this run"
- Open `../workflows/memory-context-workflow.md`
- Use extract preview/apply flow

3. "Triage candidate memories"
- Open `../workflows/memory-context-workflow.md`
- Use promote/deprecate/merge flow

4. "Command syntax for memory"
- Open `./command-quick-reference.md`

## Memory CLI Reference

Memory commands are fully implemented. Documentation:
- `./command-quick-reference.md`
- `../workflows/memory-context-workflow.md`

## Minimal-Load Guidance

- Do not read every workflow file.
- Prefer one primary workflow file for execution.
- Load one additional reference file only if blocked.
- Return to this router when intent changes.
