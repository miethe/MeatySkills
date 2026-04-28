---
skill: skillmeat-cli
workflow_id: enterprise-workflow
workflow_name: Enterprise Edition Operations
canonical_docs:
  - docs/user/guides/cli/commands.md § "Core Commands"
  - docs/user/guides/edition-feature-matrix.md
related_context:
  - .claude/context/key-context/enterprise-seeding-patterns.md
version: 1.1
updated: 2026-04-27
---

# Enterprise Edition Workflow

Guide for enterprise-specific SkillMeat operations: migrating local collections to enterprise, service-client authentication, multi-tenant management, and PostgreSQL backend features.

For complete CLI syntax, see `docs/user/guides/cli/commands.md § "Core Commands"`.  
For feature parity matrix, see `docs/user/guides/edition-feature-matrix.md`.  
For detailed enterprise deployment patterns, see `.claude/context/key-context/enterprise-seeding-patterns.md`.

---

## Overview

**Enterprise Features**:
- **Collection Migration**: Import local SQLite collection to enterprise PostgreSQL backend
- **Service-Client Authentication**: Long-lived credentials for service accounts
- **Multi-Tenant Isolation**: Team and organization scoping via Row-Level Security (RLS)
- **Advanced Features**: Backup/restore, audit trails, compliance reporting

**Use Cases**:
- Migrate from local community edition to enterprise edition
- Set up multi-team artifact management
- Enable centralized collections with PostgreSQL
- Authenticate CI/CD systems with service clients
- Audit artifact access and deployments

---

## Workflow 1: Migrate Local Collection to Enterprise

### Step 1: Verify Enterprise Connection

```bash
# Verify PostgreSQL backend is accessible
skillmeat enterprise status
```

**Output**:
```
Enterprise Edition Status
─────────────────────────
Server: postgres://db.acme.com:5432/skillmeat-prod
Status: ✓ Connected
Edition: enterprise
Database: PostgreSQL 15.2
Tenants: 5 (Acme Inc. is connected)
```

### Step 2: Backup Local Collection (Safety)

```bash
# Create full backup before migration
skillmeat bundle create backup-pre-migration-$(date +%Y%m%d) \
  --all \
  -d "Pre-migration backup" \
  -a "$(git config user.email)"

# Sign for integrity
skillmeat bom sign backup-pre-migration-*.skillmeat-pack
```

### Step 3: Run Migration

For authoritative flag syntax, see `docs/user/guides/cli/commands.md § "Core Commands"`.

```bash
# Basic migration — imports all artifacts
skillmeat enterprise import --from-collection

# Filter by artifact type (e.g., skills only)
skillmeat enterprise import --from-collection --filter-type skill

# Filter by tag
skillmeat enterprise import --from-collection --filter-tag "production"

# Preview without writing (dry run)
skillmeat enterprise import --from-collection --dry-run

# Set storage tier for imported artifacts
skillmeat enterprise import --from-collection --tier hot

# Control conflict resolution: skip (default), overwrite, or create_version
skillmeat enterprise import --from-collection --conflict overwrite
skillmeat enterprise import --from-collection --conflict create_version
```

**Conflict strategy guidance**:
- `skip` (default) — safe for initial imports; existing enterprise artifacts are not overwritten.
- `overwrite` — use when re-importing after local edits; replaces existing enterprise records.
- `create_version` — preserves history; recommended when the enterprise collection already has diverged.

**Interactive Prompts**:
```
Preparing migration...

Source: ~/.skillmeat/collection/ (SQLite)
Target: postgres://db.acme.com:5432/skillmeat-prod (PostgreSQL)

This will:
  - Create collection in enterprise database
  - Migrate 47 artifacts
  - Set organization: Acme Inc.
  - Enable multi-tenant isolation

Proceed? [y/N]: y

Migrating artifacts...
  [████████████░░░░░░░░░░░] 35/47

✓ Migration complete
  Artifacts migrated: 47
  Duration: 2m 34s
  Collection ID: org_acme_12345
```

### Step 4: Verify Migration

```bash
# Verify artifacts are accessible
skillmeat list --json | jq '.artifacts | length'

# Check collection details
skillmeat config get collection-id
skillmeat config get edition
```

**Output**:
```
edition: enterprise
collection-id: org_acme_12345
server: postgres://db.acme.com:5432/skillmeat-prod
```

### Step 5: Re-Deploy if Needed

```bash
# Re-deploy artifacts to projects
skillmeat deploy --all
```

---

## Workflow 2: Service-Client Authentication

For CI/CD and system accounts:

### Step 1: Create Service Client (Admin Only)

Enterprise administrators create service clients:

```bash
# Create a service client for CI/CD
skillmeat enterprise service-client create \
  --name "CI/CD Pipeline" \
  --description "Automated artifact deployment" \
  --scopes "read:artifacts,write:deployments"
```

**Output**:
```
✓ Service client created
  Name: CI/CD Pipeline
  Client ID: svc_acme_ci_12345
  Client Secret: svc_sec_abc123def456...
  
⚠️  Save this secret securely! It will not be shown again.
```

### Step 2: Store Service Client Credentials

```bash
# Option 1: Environment variables (for CI/CD)
export SKILLMEAT_CLIENT_ID="svc_acme_ci_12345"
export SKILLMEAT_CLIENT_SECRET="svc_sec_abc123def456..."

# Option 2: CI/CD secrets (GitHub, GitLab, etc.)
# Store CLIENT_ID and CLIENT_SECRET in repository secrets

# Option 3: Secure vault
# Store in HashiCorp Vault, AWS Secrets Manager, etc.
```

### Step 3: Authenticate as Service Client

```bash
# CLI automatically detects credentials from environment
skillmeat list

# Or explicitly specify
skillmeat --client-id svc_acme_ci_12345 \
  --client-secret svc_sec_abc123def456... \
  deploy --all
```

### Step 4: Revoke Service Client

```bash
# Revoke if compromised or no longer needed
skillmeat enterprise service-client revoke svc_acme_ci_12345
```

---

## Workflow 3: Multi-Tenant Organization

### Step 1: List Organization Teams

```bash
# View teams in organization
skillmeat enterprise teams list
```

**Output**:
```
Team                    Description                   Members
────────────────────────────────────────────────────────────
Backend                 Backend engineering team          8
Frontend                Frontend development team         6
DevOps                  Infrastructure and operations     4
```

### Step 2: View Team Artifacts

```bash
# View artifacts scoped to your team
skillmeat list --team backend
```

### Step 3: Share Artifacts Across Teams

```bash
# Grant team access to artifact
skillmeat share skill:api-client --team frontend --access read
skillmeat share skill:api-client --team devops --access read

# Or organization-wide
skillmeat share skill:api-client --organization --access read
```

### Step 4: Audit Access

```bash
# View access history
skillmeat enterprise audit --artifact skill:api-client --limit 50
```

**Output**:
```
Artifact: skill:api-client
Access Log (50 results)

Timestamp                User              Team        Action     Result
─────────────────────────────────────────────────────────────────────────
2025-01-14 16:30:00      alice@acme.com    Backend     deploy     ✓ Success
2025-01-14 16:00:00      bob@acme.com      Frontend    read       ✓ Success
2025-01-14 15:45:00      carol@acme.com    Backend     update     ✓ Success
2025-01-13 10:30:00      alice@acme.com    Backend     deploy     ✓ Success
```

---

## Advanced Patterns

### Pattern: Multi-Environment Setup

```bash
# Production
export SKILLMEAT_SERVER=postgres://prod.acme.com:5432/skillmeat-prod
skillmeat deploy --environment production

# Staging
export SKILLMEAT_SERVER=postgres://staging.acme.com:5432/skillmeat-staging
skillmeat deploy --environment staging
```

### Pattern: Service-Client Rotation

```bash
# Periodically create new clients
skillmeat enterprise service-client create \
  --name "CI/CD" \
  --scopes "read:artifacts,write:deployments"

# Update CI/CD secrets
# Revoke old client
skillmeat enterprise service-client revoke <old-client-id>
```

### Pattern: Compliance Auditing

```bash
# Export audit trail
skillmeat enterprise audit --start 2025-01-01 --end 2025-01-31 \
  --format csv > audit-january.csv
```

---

## Troubleshooting

```bash
# Connection error
skillmeat enterprise status

# Permission denied
# Contact administrator for organization:admin role

# Service client not working
echo $SKILLMEAT_CLIENT_ID
skillmeat enterprise service-client show $SKILLMEAT_CLIENT_ID
```

---

## Agent-Facing Examples

### Example 1: Migrate to Enterprise

**Agent Task**: "Migrate our local SkillMeat collection to enterprise PostgreSQL"

```bash
# Backup first
skillmeat bundle create backup-pre-migration-20250114 \
  --all \
  -d "Pre-migration backup"

# Run migration
skillmeat enterprise import --from-collection

# Verify
skillmeat config get edition
skillmeat list | head -5

# Result: "Migration complete. 47 artifacts moved to PostgreSQL. Enterprise edition active."
```

### Example 2: Set Up CI/CD Service Client

**Agent Task**: "Create a service client credential for our GitHub Actions pipeline"

```bash
# Create service client (as admin)
skillmeat enterprise service-client create \
  --name "GitHub Actions" \
  --scopes "read:artifacts,write:deployments"

# Output credentials (one-time display)
# Store in repository secrets:
#   SKILLMEAT_CLIENT_ID=svc_...
#   SKILLMEAT_CLIENT_SECRET=svc_sec_...

# Test in CI/CD
# GitHub Actions workflow will use from secrets automatically

# Result: "Service client created. Configure GitHub repository secrets with CLIENT_ID and CLIENT_SECRET"
```

### Example 3: Audit Team Access

**Agent Task**: "Review who accessed the API client artifact this month"

```bash
# Check audit log
skillmeat enterprise audit --artifact skill:api-client \
  --start 2025-01-01 --end 2025-01-31

# Export to CSV for analysis
skillmeat enterprise audit --artifact skill:api-client \
  --start 2025-01-01 \
  --format csv > api-client-audit-jan.csv

# Result: "Audit log shows 23 access events in January. Details saved to CSV."
```

---

## Related Workflows

- `workflows/auth-workflow.md` — Local OAuth and PAT authentication
- `workflows/deployment-workflow.md` — Deploying in enterprise context
- `workflows/bundle-workflow.md` — Creating and sharing bundles (enterprise-compatible)

## See Also

- `docs/user/guides/edition-feature-matrix.md` — Community vs Enterprise feature comparison
- `.claude/context/key-context/enterprise-seeding-patterns.md` — Enterprise deployment deep dive
- `docs/user/guides/cli/commands.md § "Core Commands"` — Complete command reference
- `docs/user/guides/cli/reference.md` — Auto-generated CLI reference
