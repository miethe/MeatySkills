---
skill: skillmeat-cli
workflow_id: bundle-workflow
workflow_name: Bundle Management
canonical_docs:
  - docs/user/guides/cli/commands.md § "Bundle Management"
version: 1.0
updated: 2026-04-14
---

# Bundle Management Workflow

Guide for creating, signing, sharing, and importing artifact bundles with SkillMeat.

For complete CLI syntax, see `docs/user/guides/cli/commands.md § "Bundle Management"`.

---

## Overview

**Bundle Operations**:
- **Create**: Package artifacts from your collection into shareable `.skillmeat-pack` files
- **Inspect**: Examine bundle contents and verify integrity
- **Import**: Install bundles with automatic conflict resolution
- **Sign**: Add cryptographic signatures (via `bom sign` command)
- **Verify**: Check bundle integrity and signatures (via `bom verify` command)

**Use Cases**:
- Share development setups with team members
- Distribute company standard artifacts
- Create reproducible environments
- Backup and restore collections
- Collaborate on artifact sets

---

## Workflow 1: Share Your Development Setup

### Step 1: Create Bundle

```bash
# Interactive mode (prompts for artifact selection)
skillmeat bundle create my-setup

# Include specific artifacts
skillmeat bundle create my-setup -r pdf -r canvas -r document-editor

# Include all skills
skillmeat bundle create my-setup --type skill

# Include all artifacts
skillmeat bundle create my-setup --all

# With metadata
skillmeat bundle create my-setup \
  -d "My development environment" \
  -a "jane@example.com" \
  --tags "dev,python,web"
```

**Output**:
```
✓ Packed 3 artifacts
✓ Created: my-setup.skillmeat-pack (2.4 MB)
```

### Step 2: Sign Bundle (Optional but Recommended)

Sign bundles for distribution. See `workflows/supply-chain-workflow.md` for full signing procedures.

```bash
# Sign with your key
skillmeat bom sign my-setup.skillmeat-pack --output my-setup.signed.skillmeat-pack
```

### Step 3: Share Bundle

**Email**:
- Attach `.skillmeat-pack` file
- Provide SHA-256 hash for verification

**File Sharing**:
```bash
# Upload to shared drive
cp my-setup.skillmeat-pack /mnt/team-drive/bundles/

# Or use Git LFS
git lfs track "*.skillmeat-pack"
git add my-setup.skillmeat-pack
git commit -m "Add dev setup bundle"
```

---

## Workflow 2: Import Colleague's Bundle

### Step 1: Inspect Bundle

```bash
# View contents
skillmeat bundle inspect colleague-setup.skillmeat-pack

# Verify integrity (if signed)
skillmeat bom verify colleague-setup.skillmeat-pack
```

**Output**:
```
Bundle: colleague-setup
Version: 1.0.0
Author: john@example.com
Created: 2025-12-24T10:30:00Z
Description: Backend development tools

Artifacts (5):
  - pdf (skill) - v1.2.0
  - api-client (skill) - v2.0.1
  - db-migrate (command) - v1.5.0
  - code-review (agent) - v1.0.0
  - testing-suite (skill) - v3.1.0

Total size: 3.2 MB
```

### Step 2: Preview Import

```bash
# Dry run to see what would happen
skillmeat bundle import colleague-setup.skillmeat-pack --dry-run
```

**Output**:
```
Import Preview: colleague-setup.skillmeat-pack

Would add (3):
  + api-client (skill) - new artifact
  + db-migrate (command) - new artifact
  + testing-suite (skill) - new artifact

Would update (1):
  ~ pdf (skill) - v1.0.0 → v1.2.0

Would skip (1):
  = code-review (agent) - identical to existing

Conflicts (0): none
```

### Step 3: Import Bundle

**Interactive (Recommended)**:
```bash
skillmeat bundle import colleague-setup.skillmeat-pack
```

**Prompts**:
```
Artifact 'pdf' already exists:
  Existing: v1.0.0 (source: anthropics/skills/pdf)
  Imported: v1.2.0 (source: anthropics/skills/pdf)

Actions:
  [m] Merge (replace with imported version)
  [f] Fork (keep both, rename imported)
  [s] Skip (keep existing, don't import)
  [d] Diff (compare versions)
  [q] Quit import

Choice [m/f/s/d/q]: m

✓ Replaced pdf with v1.2.0
```

**Non-Interactive**:
```bash
# Always merge (overwrite)
skillmeat bundle import colleague-setup.skillmeat-pack --strategy=merge

# Fork conflicts (create duplicates)
skillmeat bundle import colleague-setup.skillmeat-pack --strategy=fork

# Skip conflicts (keep existing)
skillmeat bundle import colleague-setup.skillmeat-pack --strategy=skip
```

---

## Conflict Resolution Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `interactive` | Prompt for each conflict | First import, review needed |
| `merge` | Overwrite existing | Trusted updates, team standard |
| `fork` | Keep both, rename imported | Experimental, comparison |
| `skip` | Keep existing, don't import | Selective import, conservative |

### Example: Team Standard Distribution

**Key Administrator**:
```bash
# Create team standard
skillmeat bundle create acme-standard \
  --type skill \
  --type command \
  -d "Acme Corp standard development environment" \
  -a "engineering@acme.com" \
  -v "2024.12.1" \
  --tags "standard,required,onboarding"

# Sign the bundle
skillmeat bom sign acme-standard.skillmeat-pack \
  --output acme-standard.signed.skillmeat-pack
```

**Team Members**:
```bash
# Import with merge strategy (team standard)
skillmeat bundle import acme-standard.signed.skillmeat-pack --strategy=merge

# Deploy all artifacts to current project
skillmeat deploy --all
```

---

## Advanced Patterns

### Pattern: Versioned Team Bundles

```bash
# Create team standard (version tracked)
skillmeat bundle create acme-standard \
  --all \
  -v "2025.01.1" \
  -a "engineering@acme.com"

# Team members import
skillmeat bundle import acme-standard-2025.01.1.skillmeat-pack --strategy=merge
```

### Pattern: Backup and Restore

```bash
# Backup current state
skillmeat bundle create backup-$(date +%Y%m%d) --all

# Restore on new machine
skillmeat bundle import backup-20251224.skillmeat-pack --strategy=merge
```

---

## Bundle Format Reference

### Bundle File Structure

`.skillmeat-pack` files are ZIP archives with standardized structure:

```
bundle.skillmeat-pack (ZIP)
├── manifest.toml          # Bundle metadata
├── artifacts/
│   ├── pdf/
│   │   ├── SKILL.md
│   │   ├── metadata.toml
│   │   └── scripts/
│   ├── canvas/
│   │   ├── SKILL.md
│   │   └── templates/
│   └── ...
└── checksums.sha256       # File integrity hashes
```

### manifest.toml Example

```toml
[bundle]
name = "my-setup"
version = "1.0.0"
created_at = "2025-12-24T12:00:00Z"
author = "jane@example.com"
description = "My development setup"
license = "MIT"
tags = ["dev", "python", "web"]

[[artifacts]]
name = "pdf"
type = "skill"
source = "anthropics/skills/pdf"
version = "v1.2.0"
resolved_sha = "abc123def456..."
```

---

## Troubleshooting

### Bundle Creation Fails

**Error**: "No artifacts found in collection"
```bash
# Check collection
skillmeat list

# Add artifacts first
skillmeat add anthropics/skills/pdf
```

### Bundle Import Fails

**Error**: "Hash verification failed"
```bash
# Re-download bundle and check for corruption
sha256sum bundle.skillmeat-pack

# Compare with expected hash
```

**Error**: "Bundle is corrupt or invalid"
```bash
# Check bundle integrity
skillmeat bundle inspect bundle.skillmeat-pack --verify

# Try re-downloading
```

---

## Agent-Facing Examples

### Example 1: Create and Share Team Setup

**Agent Task**: "Package our web dev tools into a bundle for the team"

```bash
# Create bundle with web development artifacts
skillmeat bundle create team-web-dev \
  -r frontend-design \
  -r webapp-testing \
  -r api-client \
  -d "Web development standard tools" \
  -a "team@acme.com" \
  --tags "web,frontend,testing"

# Sign for distribution
skillmeat bom sign team-web-dev.skillmeat-pack \
  --output team-web-dev.signed.skillmeat-pack

# Report: "Bundle created at team-web-dev.signed.skillmeat-pack (X MB)"
```

### Example 2: Import and Merge Updates

**Agent Task**: "Import the latest team standard bundle"

```bash
# Dry run first
skillmeat bundle import team-standard-latest.skillmeat-pack --dry-run

# If preview looks good, merge
skillmeat bundle import team-standard-latest.skillmeat-pack --strategy=merge

# Deploy new artifacts
skillmeat deploy --all
```

### Example 3: Selective Fork

**Agent Task**: "Test a new version of a skill without replacing the current one"

```bash
# Import with fork strategy to keep both versions
skillmeat bundle import experimental.skillmeat-pack --strategy=fork

# List to see both versions
skillmeat list | grep skill-name
# Output:
#   skill-name (skill) - v1.0.0
#   skill-name-imported (skill) - v2.0.0-beta
```

---

## Related Workflows

- `workflows/supply-chain-workflow.md` — Bundle signing and verification details
- `workflows/deployment-workflow.md` — Deploying artifacts after import

## See Also

- `docs/user/guides/cli/commands.md § "Bundle Management"` — Complete command reference
- `docs/user/guides/cli/reference.md` — Auto-generated CLI reference
