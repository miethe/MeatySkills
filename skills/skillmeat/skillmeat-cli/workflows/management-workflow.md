---
skill: skillmeat-cli
workflow_id: management
canonical_docs:
  - docs/user/guides/cli/commands.md
  - docs/user/guides/cli/reference.md
version: 1.1
updated: 2026-04-14
---

# Management Workflow

**Canonical docs for command syntax**: `docs/user/guides/cli/commands.md § "Core Commands"`, `§ "Updates & Status"`, `§ "Configuration"`, `§ "Phase 2: Sync Commands"`.

This workflow covers agent-specific patterns for inspecting, updating, syncing, and removing artifacts. Do not duplicate flag lists — consult canonical docs for all `--option` details.

---

## Supported Commands (Live CLI Surface)

| Command | Intent |
|---------|--------|
| `skillmeat list` | List collection artifacts (filtered by type, collection) |
| `skillmeat show NAME` | Inspect a single artifact |
| `skillmeat remove NAME` | Remove artifact from collection |
| `skillmeat update` | Update one or all artifacts to latest |
| `skillmeat status` | Show collection status and drift |
| `skillmeat sync-check` | Check project drift against collection |
| `skillmeat sync-pull` | Pull collection updates into project |
| `skillmeat sync-preview` | Preview what sync-pull would change |
| `skillmeat config list\|get\|set` | Read or write CLI configuration |

> `skillmeat diff` and `skillmeat sync --all` from prior workflows do not exist — use `status`, `sync-check`, and `sync-pull`.

---

## Intent → Command Routing

| User Says | Command |
|-----------|---------|
| "What do I have?" | `skillmeat list` |
| "Tell me about X" | `skillmeat show <name>` |
| "Check for updates" | `skillmeat status` |
| "Update everything" | `skillmeat update` (see canonical docs for flags) |
| "Is the project in sync?" | `skillmeat sync-check` |
| "Pull updates into project" | `skillmeat sync-pull` (after `sync-preview`) |
| "Remove X from collection" | `skillmeat remove <name>` |
| "Set GitHub token" | `skillmeat config set github-token <token>` |

---

## Agent Patterns

### Pattern 1: Inspect before mutating

Always run `skillmeat show <name>` before `remove` or `update`. This surfaces current version, deployment locations, and confirms the artifact exists.

```bash
skillmeat show canvas
# → confirm name, version, deployments
# → then: remove or update
```

### Pattern 2: Safe remove with deployment check

`skillmeat show` will list deployment locations. If the artifact is deployed anywhere, warn the user before removing from collection:

```
'canvas' is deployed to:
  • ~/projects/web-app (.claude/skills/canvas/)

Removing from collection will NOT automatically undeploy.
Remove from collection anyway? (yes/no)
```

If user confirms, run `skillmeat remove canvas`. Then offer to `undeploy` from each listed project path.

```bash
skillmeat remove canvas
# Optionally then:
skillmeat undeploy canvas   # per project, run in each project dir
```

### Pattern 3: Update flow

```bash
# Check current state
skillmeat status

# Preview sync changes
skillmeat sync-preview

# Pull if user confirms
skillmeat sync-pull
```

For individual artifact update:
```bash
skillmeat update <name>
```

Always show what version change will occur before executing.

### Pattern 4: Batch update confirmation

When updating multiple artifacts, list them:

```
Update the following artifacts?
  • canvas: v1.2.0 → v1.3.0
  • pdf: v2.0.1 → v2.1.0

Continue? (yes/no)
```

### Pattern 5: Config operations

```bash
# Common config tasks
skillmeat config set github-token <token>
skillmeat config list
skillmeat config get github-token
```

For full config key reference see `commands.md § "Configuration"`.

---

## Examples

### Example 1: "What skills do I have?"

```bash
skillmeat list --type skill
```

Show table; offer to inspect any by name.

### Example 2: "Remove the canvas skill"

```bash
skillmeat show canvas
# → reveals deployed locations
# → confirm removal with user
skillmeat remove canvas
# → offer to undeploy from listed project paths
```

### Example 3: "Update all artifacts"

```bash
skillmeat status
# → shows what's outdated
skillmeat sync-preview
# → shows diff of changes
# → user confirms
skillmeat sync-pull
```

---

## Confirmation Requirements

| Operation | Confirmation Required |
|-----------|----------------------|
| `remove` | Yes — show deployments first |
| `update` (single) | Show version diff first |
| `update` (batch) | List all changes, confirm as a group |
| `sync-pull` | Run `sync-preview` first; confirm |
| `config set` | No — read-write config is non-destructive |
| `list`, `show`, `status`, `sync-check`, `sync-preview` | No |

---

## Boundaries

- `remove` removes from collection only — for project-level removal use `skillmeat undeploy` (see `deployment-workflow.md`).
- Snapshot and rollback are in `./versioning-workflow.md`.
- Enterprise-edition collection import (`enterprise import --from-collection`) is in `./enterprise-workflow.md`.
