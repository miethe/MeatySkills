---
skill: skillmeat-cli
workflow_id: auth-workflow
workflow_name: Authentication and Credentials
canonical_docs:
  - docs/user/guides/cli/commands.md § "Authentication"
version: 1.0
updated: 2026-04-14
---

# Authentication and Credentials Workflow

Guide for authenticating with SkillMeat via OAuth 2.0 device-code flow, managing PATs (Personal Access Tokens), and revoking credentials.

For complete CLI syntax, see `docs/user/guides/cli/commands.md § "Authentication"`.

---

## Overview

**Authentication Methods**:
- **Device-Code OAuth**: Browser-based sign-in via Clerk (recommended)
- **Personal Access Token (PAT)**: Long-lived token for programmatic access
- **Local Mode**: Zero-auth development (default, requires no authentication)

**Use Cases**:
- Sign in to access personalized artifacts and settings
- Generate tokens for CI/CD and automation
- Authenticate across multiple machines
- Revoke compromised credentials
- Manage multi-account access

---

## Workflow 1: Device-Code OAuth Sign-In

Browser-based OAuth 2.0 flow (recommended for interactive use):

### Step 1: Initiate Login

```bash
# Start device-code OAuth flow
skillmeat auth login
```

**Output**:
```
Opening browser to authenticate...

If browser doesn't open automatically, visit:
  https://auth.skillmeat.dev/auth/device?code=ABC123

Waiting for authentication... (expires in 15 minutes)
```

### Step 2: Authenticate in Browser

Browser opens automatically. Follow the prompts:

1. Visit the URL (if not auto-opened)
2. Sign in with your account
3. Approve the SkillMeat CLI access request
4. Browser shows "Authentication successful"

### Step 3: Verify Login

```bash
# Token is automatically stored in system keychain
# Verify successful login
skillmeat auth verify
# or
skillmeat config get github-token
```

**Output**:
```
✓ Authenticated
  User: alice@acme.com
  Scope: artifacts, deployments, collection
  Expires: 2025-04-14 (90 days)
  Stored in: System Keychain (secure)
```

### Step 4: Use Token Automatically

All CLI commands now use the stored token:

```bash
# No additional authentication needed
skillmeat list
skillmeat search pdf-tools
skillmeat deploy skill:pdf
```

---

## Workflow 2: Personal Access Token (PAT)

For programmatic access and CI/CD:

### Step 1: Generate Token

```bash
# Create a PAT
skillmeat auth token generate
```

**Output**:
```
✓ Token created
  Token: sm_pat_abc123def456...
  Created: 2025-01-14T15:00:00Z
  Expires: 2025-04-14 (90 days)
  Scopes: read:artifacts, write:artifacts, read:deployments, write:deployments

⚠️  Save this token in a secure location!
    It will not be shown again.
```

### Step 2: Store Token Securely

```bash
# Option 1: System keychain (automatic when using auth login)
# Token is stored by skillmeat auth login

# Option 2: Environment variable (for CI/CD)
export SKILLMEAT_TOKEN="sm_pat_abc123def456..."

# Option 3: .skillmeat config
skillmeat auth token set sm_pat_abc123def456...

# Option 4: CI/CD secrets (GitHub, GitLab, etc.)
# Store in repository secrets or CI system
```

### Step 3: Use Token in Scripts

```bash
# Automatic (from environment or keychain)
skillmeat list

# Explicit via environment variable
SKILLMEAT_TOKEN=sm_pat_abc123def456... skillmeat deploy skill:pdf

# In API calls
curl -H "Authorization: Bearer sm_pat_abc123def456..." \
  https://api.skillmeat.dev/api/v1/artifacts
```

### Step 4: List Tokens

```bash
# View all active tokens
skillmeat auth token list
```

**Output**:
```
Token ID              Created                 Expires                 Last Used
─────────────────────────────────────────────────────────────────────────────
sm_pat_abc123def456   2025-01-14 15:00:00     2025-04-14 15:00:00     2025-01-14 16:30:00
sm_pat_def456abc789   2024-12-01 10:00:00     2025-03-01 10:00:00     2024-12-15 14:30:00
```

### Step 5: Revoke Token

```bash
# Revoke specific token
skillmeat auth token revoke sm_pat_abc123def456

# Or revoke all tokens
skillmeat auth token revoke --all
```

**Output**:
```
✓ Token revoked
  Token: sm_pat_abc123def456
  Revoked at: 2025-01-14T17:00:00Z
```

---

## Workflow 3: Sign Out

Revoke stored credentials:

### Step 1: Log Out

```bash
# Clear stored authentication
skillmeat auth logout
```

**Output**:
```
✓ Logged out
  Removed token from keychain
  Cleared local cache
```

### Step 2: Verify Sign Out

```bash
# Verify no token is stored
skillmeat auth verify
```

**Output**:
```
✗ Not authenticated
  No valid token found
  Run 'skillmeat auth login' to authenticate
```

---

## Local Mode (Development)

Zero-auth mode for local development:

### Default Behavior

```bash
# No authentication required in local mode
skillmeat list           # Works without token
skillmeat search pdf     # Works without token
skillmeat add path/to/skill  # Works without token
```

### Enable Collection Sync (Optional)

Even in local mode, you can authenticate to sync with public collections:

```bash
# Optional: Sign in to access published collections
skillmeat auth login

# Sync with upstream
skillmeat sync --upstream anthropics
```

---

## CI/CD Integration

### GitHub Actions

```yaml
jobs:
  deploy:
    steps:
      - name: Deploy Artifacts
        env:
          SKILLMEAT_TOKEN: ${{ secrets.SKILLMEAT_TOKEN }}
        run: skillmeat deploy --all
```

### Shell Script

```bash
# Load token and deploy
export SKILLMEAT_TOKEN=$(cat ~/.skillmeat/token)
skillmeat deploy --all
```

---

## Token Management

```bash
# View token expiration
skillmeat auth token list

# Tokens expire in 90 days
# Re-authenticate to refresh
skillmeat auth login
```

---

## Troubleshooting

```bash
# Browser doesn't open
skillmeat auth login --no-browser

# Token expired - re-authenticate
skillmeat auth login

# Verify token
echo $SKILLMEAT_TOKEN
skillmeat auth verify

# Use environment variable if issues
export SKILLMEAT_TOKEN="sm_pat_abc123def456..."
```

---

## Agent-Facing Examples

### Example 1: Set Up CI/CD Authentication

**Agent Task**: "Create a PAT for our CI/CD pipeline and configure it"

```bash
# Generate new token
skillmeat auth token generate

# Output token for storage in CI secrets
# (token shown once, must be saved)

# Instructions for engineer:
# 1. Add token to GitHub repository secrets as SKILLMEAT_TOKEN
# 2. Or: Add to CI/CD platform's secret management
# 3. The workflow will automatically use it

# Result: "Created PAT sm_pat_abc123def456. Store in CI/CD secrets as SKILLMEAT_TOKEN"
```

### Example 2: Authenticate Local Machine

**Agent Task**: "Sign in to access personalized artifacts"

```bash
# Initiate OAuth login
skillmeat auth login

# Browser opens automatically
# Follow sign-in flow
# Token saved to system keychain

# Verify
skillmeat auth verify

# Result: "Authenticated as alice@acme.com. Token expires 2025-04-14"
```

### Example 3: Revoke Compromised Token

**Agent Task**: "Revoke a leaked PAT immediately"

```bash
# List active tokens
skillmeat auth token list

# Identify compromised token
# Revoke it
skillmeat auth token revoke sm_pat_compromised123

# Generate replacement
skillmeat auth token generate

# Result: "Revoked compromised token. New token: sm_pat_new123..."
```

---

## Enterprise Edition

**Note**: Enterprise-specific authentication (multi-tenant service-client PAT, SAML, etc.) is documented in `workflows/enterprise-workflow.md`.

---

## Related Workflows

- `workflows/enterprise-workflow.md` — Enterprise authentication and multi-tenant settings
- `workflows/deployment-workflow.md` — Using authentication in deployment workflows

## See Also

- `docs/user/guides/cli/commands.md § "Authentication"` — Complete auth command reference
- `docs/user/guides/cli/reference.md` — Auto-generated CLI reference
