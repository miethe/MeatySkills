---
skill: skillmeat-cli
workflow_id: supply-chain-workflow
workflow_name: Supply Chain Security (BOM & Attestation)
canonical_docs:
  - docs/user/guides/cli/commands.md § "SkillBOM"
  - docs/user/guides/cli/commands.md § "Attestation"
version: 1.0
updated: 2026-04-14
---

# Supply Chain Security Workflow

Guide for signing, verifying, and managing Bill of Materials (BOM) and attestation records with SkillMeat.

For complete CLI syntax, see `docs/user/guides/cli/commands.md § "SkillBOM"` and `§ "Attestation"`.

---

## Overview

**Supply Chain Operations**:
- **BOM Sign**: Add Ed25519 signatures to artifact bundles for integrity verification
- **BOM Verify**: Check bundle signatures and detect tampering
- **BOM Restore**: Revert to a previous bundle state via git commits
- **Key Management**: Generate, list, export, import, and revoke Ed25519 keys
- **Pre-Commit Hooks**: Automatically sign changes before committing
- **Attestation**: Create and view attestation records for artifact deployments

**Use Cases**:
- Verify bundle integrity and origin before import
- Ensure supply chain integrity in CI/CD pipelines
- Audit artifact signatures and verification history
- Track deployment attestations for compliance
- Manage distributed signing keys securely

---

## Workflow 1: Sign and Distribute Bundles

```bash
# Generate key
skillmeat bom keygen --key-dir ~/.skillmeat/keys

# Sign bundle
skillmeat bom sign bundle.skillmeat-pack \
  --output bundle.signed.skillmeat-pack

# Export public key for team
skillmeat bom keygen --export-public --key-id abc123def456

# Share bundle and public key with team
# bundle.signed.skillmeat-pack and key-abc123def456.pub
```

---

## Workflow 2: Verify and Import Signed Bundles

```bash
# Import signer's public key (once per signer)
skillmeat bom keygen --import colleague-public.key

# Verify signature
skillmeat bom verify bundle.signed.skillmeat-pack

# Import if verified
skillmeat bundle import bundle.signed.skillmeat-pack --strategy=merge
```

---

## Workflow 3: Restore to Previous State

```bash
# Dry run restore
skillmeat bom restore <commit-sha> --dry-run

# Restore to specific commit
skillmeat bom restore <commit-sha>
```

---

## Workflow 4: Pre-Commit Hook

Automatically sign changes:

```bash
# Install
skillmeat bom hook install --project .

# Commits now auto-sign
git commit -m "Update artifact"

# Uninstall when done
skillmeat bom hook uninstall --project .
```

---

## Workflow 5: Create and View Attestations

```bash
# Create attestation for deployment
skillmeat attest create \
  --artifact-id skill:pdf \
  --artifact-version v1.2.0 \
  --environment production \
  --deployed-by alice@acme.com

# List attestations
skillmeat attest list
skillmeat attest list --artifact skill:pdf
skillmeat attest list --environment production

# View details
skillmeat attest show attest-20250114-001
```

---

## Key Management

```bash
# Generate key
skillmeat bom keygen --key-dir ~/.skillmeat/keys

# List keys
skillmeat bom keygen --list

# Export public key
skillmeat bom keygen --export-public --key-id abc123def456

# Import colleague's key
skillmeat bom keygen --import colleague-public.key

# Revoke compromised key
skillmeat bom keygen --revoke --key-id abc123def456
```

---

## Advanced Patterns

### Pattern: Team Signing Standard

```bash
# Team lead
skillmeat bom keygen --export-public --key-id team-key-id

# Team member imports once
skillmeat bom keygen --import team-engineering.pub

# Use normally
skillmeat bom verify bundle.signed.skillmeat-pack
```

### Pattern: Compliance Audit Trail

```bash
# On deployment
skillmeat attest create \
  --artifact-id skill:api-service \
  --artifact-version v2.0 \
  --environment production \
  --deployed-by "$(git config user.email)"
```

---

## Troubleshooting

### Signature Verification Failed

```bash
# Import signer's public key
skillmeat bom keygen --import signer-public.key

# Try again
skillmeat bom verify bundle.signed.skillmeat-pack
```

### Key Not Found

```bash
# List keys
skillmeat bom keygen --list

# Generate if needed
skillmeat bom keygen --key-dir ~/.skillmeat/keys
```

---

## Agent-Facing Examples

### Example 1: Sign and Share Bundle

**Agent Task**: "Sign our development bundle and prepare it for team distribution"

```bash
# Check if key exists
skillmeat bom keygen --list

# If needed, generate key
skillmeat bom keygen --key-dir ~/.skillmeat/keys

# Sign bundle
skillmeat bom sign dev-setup.skillmeat-pack \
  --output dev-setup.signed.skillmeat-pack

# Export public key for team
skillmeat bom keygen --export-public --key-id abc123def456

# Result: "Bundle signed and ready for distribution with public key at ~/.skillmeat/keys/key-abc123def456.pub"
```

### Example 2: Verify and Import Trusted Bundle

**Agent Task**: "Import the team's signed standard bundle after verification"

```bash
# Import team's public key (once)
skillmeat bom keygen --import team-engineering.pub

# Verify the bundle
skillmeat bom verify acme-standard.signed.skillmeat-pack

# If verified, import
skillmeat bundle import acme-standard.signed.skillmeat-pack --strategy=merge

# Result: "Bundle signature verified and imported successfully"
```

### Example 3: Create Deployment Attestation

**Agent Task**: "Record this production deployment for compliance"

```bash
# After successful deployment
skillmeat attest create \
  --artifact-id skill:api-service \
  --artifact-version v2.1.0 \
  --environment production \
  --deployed-by "$(git config user.email)"

# Verify attestation was recorded
skillmeat attest show attest-20250114-001

# Result: "Deployment attestation created for audit trail"
```

---

## Related Workflows

- `workflows/bundle-workflow.md` — Creating and managing bundles (which can be signed)
- `workflows/deployment-workflow.md` — Deploying artifacts (which creates attestations)

## See Also

- `docs/user/guides/cli/commands.md § "SkillBOM"` — Complete BOM command reference
- `docs/user/guides/cli/commands.md § "Attestation"` — Complete attestation command reference
- `docs/user/guides/cli/reference.md` — Auto-generated CLI reference
