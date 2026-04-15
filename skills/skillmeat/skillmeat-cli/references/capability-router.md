# Capability Router (Progressive Disclosure)

Use this file to map user intent to the minimum docs needed.

## Quick Router

| Intent | Primary Doc | Optional Doc |
|---|---|---|
| Find artifacts for a task | `../workflows/discovery-workflow.md` | `../references/agent-integration.md` |
| Deploy/add artifacts | `../workflows/deployment-workflow.md` | `../references/agent-integration.md` |
| Manage/sync/remove artifacts | `../workflows/management-workflow.md` | `../references/agent-integration.md` |
| Share/import bundles | `../workflows/bundle-workflow.md` | `../references/agent-integration.md` |
| Render scaffold files or manage templates | `../workflows/scaffold-workflow.md` | `./command-quick-reference.md` |
| Memory items or context modules | `../workflows/memory-context-workflow.md` | `./command-quick-reference.md` |
| BOM signing, verification, or attestation | `../workflows/supply-chain-workflow.md` | `../references/agent-integration.md` |
| Artifact version history or rollback | `../workflows/versioning-workflow.md` | `./command-quick-reference.md` |
| OAuth login or credential management | `../workflows/auth-workflow.md` | `../references/agent-integration.md` |
| Enterprise migration setup | `../workflows/enterprise-workflow.md` | `../references/agent-integration.md` |
| Error recovery or network failures | `../workflows/error-handling.md` | `./command-quick-reference.md` |

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
