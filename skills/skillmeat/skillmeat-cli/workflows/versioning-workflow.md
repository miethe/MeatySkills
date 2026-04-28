---
skill: skillmeat-cli
workflow_id: versioning-workflow
workflow_name: Artifact Versioning and History
canonical_docs:
  - docs/user/guides/cli/commands.md § "Versioning"
version: 1.1
updated: 2026-04-27
---

# Artifact Versioning and History Workflow

Guide for tracking artifact versions, viewing history, and restoring previous states with SkillMeat.

For complete CLI syntax, see `docs/user/guides/cli/commands.md § "Versioning"`.

---

## Overview

**Versioning Operations**:
- **View History**: Track all artifact changes and deployments
- **Restore State**: Revert artifacts to previous versions
- **Event Tracking**: See who made changes, when, and why
- **Version Management**: Compare versions and understand change impact

**Use Cases**:
- Audit artifact changes for compliance
- Recover from accidental deletions or updates
- Understand deployment history
- Track when specific changes were made
- Restore to known-good versions

---

## Workflow 1: View Artifact History

### Step 1: Check History for Specific Artifact

```bash
# View recent changes to a specific artifact
skillmeat history skill:pdf

# Limit results
skillmeat history skill:pdf --limit 10

# View all changes
skillmeat history skill:pdf --limit 100
```

**Output**:
```
Artifact: skill:pdf

Event                    Date                 User                Version  Details
────────────────────────────────────────────────────────────────────────────────
update (added)           2025-01-14 16:30:00  alice@acme.com       v1.2.0   Updated from v1.1.0
deploy (to-project)      2025-01-14 16:25:00  alice@acme.com       v1.2.0   Deployed to /Users/me/project
update (metadata)        2025-01-10 10:15:00  bob@acme.com         v1.1.0   Updated description
create (imported)        2024-12-20 09:00:00  setup@acme.com       v1.1.0   Imported from anthropics/skills/pdf
```

### Step 2: Filter by Event Type

```bash
# View only deployments
skillmeat history skill:pdf --event-type deploy

# View only updates
skillmeat history skill:pdf --event-type update

# View only creations
skillmeat history skill:pdf --event-type create
```

**Output**:
```
Event Type: deploy
Artifact: skill:pdf

Date                 Version  Project/Scope
─────────────────────────────────────────
2025-01-14 16:25:00  v1.2.0   /Users/me/project
2025-01-12 14:00:00  v1.1.0   ~/.claude/skills/
2024-12-25 10:30:00  v1.0.0   /Users/me/prod-project
```

### Step 3: View All Artifact History

```bash
# View history for all artifacts
skillmeat history --all --limit 50
```

**Output**:
```
All Artifacts - Recent Events

Timestamp                Artifact              Event        User                Version
──────────────────────────────────────────────────────────────────────────────────────
2025-01-14 16:30:00      skill:pdf             update       alice@acme.com       v1.2.0
2025-01-14 16:25:00      skill:pdf             deploy       alice@acme.com       v1.2.0
2025-01-14 16:00:00      command:api-test      create       bob@acme.com         v2.0.0
2025-01-14 15:45:00      skill:canvas          deploy       alice@acme.com       v2.0.1
2025-01-13 14:00:00      skill:python-tools    delete       alice@acme.com       v1.5.0
```

---

## Workflow 2: Compare Versions

### Step 1: View Specific Version Details

```bash
# Show artifact at specific version
skillmeat show skill:pdf --version v1.1.0
```

**Output**:
```
Artifact: skill:pdf
Version: v1.1.0
Created: 2024-12-20T09:00:00Z
Updated: 2025-01-10T10:15:00Z

Source: anthropics/skills/pdf
License: MIT
Description: PDF processing and manipulation tools

Features:
  - Extract text from PDFs
  - Fill form fields
  - Merge and split documents

Dependencies:
  - pypdf >= 3.0.0
  - reportlab >= 3.6.0

Deployed to: 2 projects, 3 scopes
Last deployment: 2025-01-14 16:25:00
```

### Step 2: Diff Between Versions

```bash
# Compare two versions
skillmeat show skill:pdf --version v1.1.0 --diff v1.2.0
```

**Output**:
```
Diff: skill:pdf v1.1.0 → v1.2.0

Changes:
  + Added: "Watermark PDFs" feature
  + Added: "Extract images" capability
  ~ Modified: Dependencies (pypdf 3.0.0 → 3.4.1)
  ~ Modified: Description (added new features)
  - Removed: Legacy "batch process" feature (replaced)

Compatibility: ✓ Backward compatible
Breaking changes: none
```

---

## Workflow 3: Restore to Previous Version

### Step 1: Find Target Version

```bash
# View history to identify target
skillmeat history skill:pdf --limit 20

# Find the version you want to restore
```

### Step 2: Preview Restoration

```bash
# Dry run (no changes)
skillmeat bom restore <commit-sha> --dry-run
```

Or for a single artifact:

```bash
# Show what would change
skillmeat show skill:pdf --version v1.0.0
# Then manually compare with current
skillmeat show skill:pdf
```

### Step 3: Execute Restoration

```bash
# Restore artifact to specific version
skillmeat update skill:pdf --version v1.0.0
```

**Output**:
```
✓ Artifact updated
  Artifact: skill:pdf
  Version: v1.0.0 (was v1.2.0)
  Updated at: 2025-01-14T17:00:00Z
  By: alice@acme.com
```

Or restore full state via Git:

```bash
# Restore entire project state to previous commit
skillmeat bom restore abc123def456
```

---

## Workflow 4: Create and List Version Snapshots

As of SkillMeat v0.35.0, `snapshot` is a first-class command group with explicit subcommands. For authoritative syntax, see `docs/user/guides/cli/commands.md § "Versioning"`.

### Step 1: Create Snapshot

```bash
# Create a snapshot (saves current state)
skillmeat bundle create snapshot-$(date +%Y%m%d) \
  --all \
  -d "Production-verified snapshot" \
  -a "$(git config user.email)" \
  --tags "snapshot,verified"
```

**Output**:
```
✓ Snapshot created
  Name: snapshot-20250114
  Artifacts: 24
  Size: 18.5 MB
  File: snapshot-20250114.skillmeat-pack
```

### Step 2: List Snapshots

As of v0.35.0, use `snapshot list` directly rather than filtering bundle output:

```bash
# List all snapshot groups (v0.35.0+)
skillmeat snapshot list

# Legacy fallback (pre-v0.35.0)
skillmeat list --type bundle | grep snapshot

# View specific snapshot details
skillmeat show snapshot-20250114
```

### Step 3: Restore from Snapshot

```bash
# Import snapshot (restores entire state)
skillmeat bundle import snapshot-20250114.skillmeat-pack --strategy=merge

# Verify restoration
skillmeat list
```

---

## Event Types Reference

| Event | Description | Trigger |
|-------|-------------|---------|
| `create` | Artifact first added | `skillmeat add` |
| `update` | Artifact metadata or version changed | `skillmeat update`, version bump |
| `delete` | Artifact removed | `skillmeat remove` |
| `deploy` | Artifact deployed to project | `skillmeat deploy` |
| `undeploy` | Artifact undeployed from project | `skillmeat undeploy` |
| `sync` | Artifact synced with upstream | `skillmeat sync` |

---

## Advanced Patterns

### Pattern: Rollback on Error

```bash
# Find the version before failure
skillmeat history skill:pdf --event-type deploy --limit 5

# Revert
skillmeat update skill:pdf --version v1.1.0
skillmeat deploy skill:pdf
```

### Pattern: Monthly Snapshots

```bash
# Create automated snapshot
skillmeat bundle create snapshot-$(date +%Y-%m) \
  --all \
  -d "Monthly backup"
```

---

## Troubleshooting

### History Not Available

```bash
# Check artifact exists
skillmeat show skill:pdf

# View all history
skillmeat history --all
```

### Cannot Restore

```bash
# List available versions
skillmeat history skill:pdf

# Verify format (e.g., v1.2.0)
skillmeat show skill:pdf --version v1.2.0
```

---

## Agent-Facing Examples

### Example 1: Investigate Recent Change

**Agent Task**: "Find when this artifact last changed and what was updated"

```bash
# Check history
skillmeat history skill:api-client --limit 10

# Find the most recent update
skillmeat history skill:api-client --event-type update

# View details of recent version
skillmeat show skill:api-client --version v2.1.0

# Result: "skill:api-client was last updated to v2.1.0 on 2025-01-14 by alice@acme.com. Changes include..."
```

### Example 2: Rollback Failed Deployment

**Agent Task**: "Revert to the previous working version of this skill"

```bash
# Check history to find last working version
skillmeat history skill:pdf --event-type deploy --limit 5

# Identify the version before the failure
# Revert to it
skillmeat update skill:pdf --version v1.1.0

# Re-deploy
skillmeat deploy skill:pdf

# Result: "Reverted skill:pdf to v1.1.0 and redeployed"
```

### Example 3: Create Monthly Snapshot

**Agent Task**: "Create a snapshot of current collection state for backup"

```bash
# Create snapshot
skillmeat bundle create snapshot-$(date +%Y%m) \
  --all \
  -d "Monthly backup - $(date)" \
  -a "$(git config user.email)"

# Verify creation
skillmeat list --type bundle | grep snapshot

# Result: "Monthly snapshot created: snapshot-202501 with 24 artifacts"
```

---

## Related Workflows

- `workflows/bundle-workflow.md` — Creating bundles (used for snapshots)
- `workflows/supply-chain-workflow.md` — Signing snapshots for integrity
- `workflows/deployment-workflow.md` — Deploying and undeploying artifacts

## See Also

- `docs/user/guides/cli/commands.md § "Versioning"` — Complete versioning command reference
- `docs/user/guides/cli/reference.md` — Auto-generated CLI reference
