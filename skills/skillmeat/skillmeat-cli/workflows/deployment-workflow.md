---
skill: skillmeat-cli
workflow_id: deployment
canonical_docs:
  - docs/user/guides/cli/commands.md
  - docs/user/guides/cli/reference.md
version: 1.1
updated: 2026-04-14
---

# Deployment Workflow

**Canonical docs for command syntax**: `docs/user/guides/cli/commands.md § "Deployment"`, `§ "Adding Artifacts"`, `§ "Core Commands"`.

This workflow covers agent-specific confirmation flows and multi-step patterns only. Do not duplicate flag lists — consult canonical docs for all `--option` details.

---

## Supported Commands (Live CLI Surface)

| Command | Intent |
|---------|--------|
| `skillmeat add skill SPEC` | Add a skill to collection from GitHub or local path |
| `skillmeat add command SPEC` | Add a command to collection |
| `skillmeat add agent SPEC` | Add an agent to collection |
| `skillmeat deploy NAME` | Deploy a collection artifact to the current project |
| `skillmeat undeploy NAME` | Remove a deployed artifact from the current project |

For `mcp add` / `mcp deploy` see `commands.md § "MCP"`.

---

## Permission Protocol (Required)

Always require explicit user confirmation before any filesystem mutation:

| Operation | Require Confirmation |
|-----------|---------------------|
| `add skill/command/agent` | Yes — show source + files to be created |
| `deploy` | Yes — show target path |
| `undeploy` | Yes — show files to be removed |
| Batch deploy (multiple) | Yes — show full list + total file count |
| Redeploy (overwrite) | Yes — explicitly note overwrite |

Read-only operations (`list`, `show`, `search`) do not require confirmation.

---

## Agent Patterns

### Pattern 1: Add → Deploy (standard)

```bash
# 1. Verify artifact not already in collection
skillmeat show <name>   # exit code 3 = not found → proceed to add

# 2. Add to collection (requires user confirmation)
skillmeat add skill anthropics/skills/<name>

# 3. Deploy to project (requires user confirmation)
skillmeat deploy <name>
```

Always show what will be created before executing step 2 or 3.

### Pattern 2: Already in collection, just deploy

```bash
skillmeat show <name>
# shows "Deployed to: [none]" → safe to deploy
skillmeat deploy <name>
```

### Pattern 3: Already deployed

```bash
skillmeat show <name>
# shows "Deployed to: ~/projects/myapp/.claude/skills/<name>/"
```

Inform user; offer:
- **Skip** — do nothing (most common)
- **Update** — run `skillmeat update <name>` then redeploy (see `management-workflow.md`)
- **Undeploy + redeploy** — destructive, require explicit confirmation

### Pattern 4: Batch deployment

When user requests multiple artifacts:

```
Deploy the following to this project?
  1. pdf-processor (skill) — anthropics/skills/pdf-processor
  2. docx-processor (skill) — anthropics/skills/docx-processor

Proceed? (yes / no / select)
```

"select" lets the user pick individual items. Only run `add`/`deploy` after confirmation.

### Pattern 5: Rollback pointer

For undoing a deployment or restoring a prior version, defer to `./versioning-workflow.md`.

---

## Examples

### Example 1: Single artifact

User: "Add the canvas skill"

```bash
# Show plan, ask confirmation:
# "Add canvas (anthropics/skills/canvas) to collection and deploy to .claude/skills/canvas/?"
skillmeat add skill anthropics/skills/canvas
skillmeat deploy canvas
```

### Example 2: Artifact not found by name

```bash
skillmeat show canvas
# exit 3 → not in collection
skillmeat search canvas
# → present results, user picks source
# → confirm, then add + deploy
```

### Example 3: Undeploy

User: "Remove the PDF skill from this project"

```bash
# Show what will be removed:
# ".claude/skills/pdf/ (3 files)"
# Confirm, then:
skillmeat undeploy pdf
```

Note: `undeploy` removes from the project only. To also remove from collection, use `skillmeat remove` (see `management-workflow.md`).

---

## Pre-Deploy Checklist

Before running `deploy`:

- [ ] Artifact is in collection (`skillmeat show <name>` exits 0)
- [ ] User has confirmed target project path
- [ ] Not already deployed, or user has acknowledged overwrite

After `deploy`:

- [ ] Confirm success message
- [ ] Inform user of the created path (`.claude/<type>s/<name>/`)

---

## Error Recovery

| Error | Recovery |
|-------|----------|
| `exit 3` on `show` | Artifact not in collection — offer to add it |
| `exit 4` on `deploy` | Conflict / already deployed — offer skip or update |
| Network timeout during `add` | Retry up to 3 times; prompt to check token with `skillmeat config set github-token` |
| Permission denied | Check `.claude/` dir exists and is writable |

For full error recovery patterns see `./error-handling.md`.
