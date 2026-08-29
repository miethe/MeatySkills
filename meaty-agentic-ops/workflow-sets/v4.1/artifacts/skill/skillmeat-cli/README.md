# SkillMeat CLI Skill

Natural language interface for SkillMeat operations across artifacts, project setup, sharing, and Memory & Context workflows.

## Capability Scope

- Artifact discovery, recommendation, and deployment
- Collection and sync lifecycle management
- Bundle create/import/sign/inspect workflows
- MCP and context-entity CLI operations
- Confidence/context-aware recommendation support
- Caching and error-recovery playbooks
- Memory capture, triage, module composition, and context-pack generation

## Progressive Disclosure Entry Point

Start with:
- `./SKILL.md` (routing and policy)
- `./references/capability-router.md` (intent -> doc map)

Then load only the minimal workflow/reference docs needed for the active task.

## Fast Path Commands

### Artifact Management

```bash
skillmeat search "<query>" --type skill
skillmeat add skill <source>
skillmeat deploy <artifact-name>
skillmeat list
skillmeat sync --all
```

### Memory & Context (Target CLI)

```bash
skillmeat memory item create --project <project> --type decision --content "..."
skillmeat memory item list --project <project> --status candidate
skillmeat memory module create --project <project> --name "API Debug"
skillmeat memory pack preview --project <project> --module <module-id> --budget 4000
skillmeat memory pack generate --project <project> --module <module-id> --output ./context-pack.md
skillmeat memory extract preview --project <project> --run-log ./run.log
skillmeat memory extract apply --project <project> --run-log ./run.log
```

## Current State Note

If `skillmeat memory ...` is not yet available in the installed CLI, use API fallbacks:

- `/api/v1/memory-items`
- `/api/v1/context-modules`
- `/api/v1/context-packs/preview`
- `/api/v1/context-packs/generate`

Always communicate fallback usage clearly.

## Recommended Agentic Workflow

## 1. Before coding (consume memory)

1. Determine project.
2. Preview context pack for module/task.
3. Generate pack and inject/use in prompt context.

## 2. During/after coding (capture memory)

1. Capture run log or session summary.
2. Run extraction in preview mode.
3. Apply extraction to candidate queue.
4. Triage candidates (promote/edit/deprecate/merge).

## 3. Periodic maintenance

1. Review candidate backlog.
2. Deprecate stale entries.
3. Refresh modules and pack budgets.

## Safety Rules

- Never deploy artifacts or mutate memory state without explicit user permission.
- For extraction, preview first unless user explicitly requests direct apply.
- For merges and bulk actions, show what will change before execution.
- Keep project scope explicit in all memory operations.

## Suggested Prompt Patterns

### Artifact Suggestion

"This task would benefit from `<artifact>`. Want me to add and deploy it?"

### Memory Suggestion

"I can generate a context pack from your active project memory before we continue. Proceed?"

### Capture Suggestion

"I can extract candidate memories from this run and queue them for review. Proceed?"

## File Structure

```
.claude/skills/skillmeat-cli/
├── SKILL.md
├── README.md
├── references/
│   ├── capability-router.md
│   ├── command-quick-reference.md
│   ├── agent-integration.md
│   ├── claudectl-setup.md
│   └── integration-tests.md
├── workflows/
│   ├── discovery-workflow.md
│   ├── deployment-workflow.md
│   ├── management-workflow.md
│   ├── bundle-workflow.md
│   ├── memory-context-workflow.md
│   └── ...additional workflow modules
├── templates/
└── scripts/
```

## Related Docs

- `./SKILL.md`
- `./references/capability-router.md`
- `./references/command-quick-reference.md`
- `./references/agent-integration.md`
- `./workflows/memory-context-workflow.md`
