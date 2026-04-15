---
name: skillmeat-cli
description: |
  Manage SkillMeat and Claude Code environments through natural language.
  Use this skill for artifact discovery, deployment, management, bundle/scaffold
  operations, memory and context workflows, supply-chain security, versioning,
  authentication, attestation, and enterprise migration.
  Progressive disclosure: load only the workflow doc needed for the current intent.
version: 1.1
updated: 2026-04-14
spec: ./SPEC.md
---

# SkillMeat CLI Skill

High-level router for SkillMeat agent operations. This file contains only
routing logic and policy. For full capability matrix, invariants, and
enhancement backlog see `./SPEC.md`. For command syntax see canonical user
docs at `docs/user/guides/cli/commands.md` and `docs/user/guides/cli/reference.md`.

---

## Route Table

| User Intent | Workflow Doc | Canonical CLI Doc |
|---|---|---|
| Find, search, or recommend artifacts | `./workflows/discovery-workflow.md` | `commands.md § "Core Commands"`, `§ "Search"` |
| Deploy, add, or install an artifact to a project | `./workflows/deployment-workflow.md` | `commands.md § "Deployment"`, `§ "Adding Artifacts"` |
| List, inspect, sync, update, or remove artifacts | `./workflows/management-workflow.md` | `commands.md § "Core Commands"`, `§ "Updates & Status"` |
| Create, publish, import, or export a bundle | `./workflows/bundle-workflow.md` | `commands.md § "Bundle Management"` |
| Render scaffold files or manage templates | `./workflows/scaffold-workflow.md` | `commands.md § "Scaffold"`, `§ "Template"` |
| Memory items, context modules, or context packs | `./workflows/memory-context-workflow.md` | `CLAUDE.md § "Memory System"` |
| BOM signing, verification, key management, attestation, pre-commit hooks | `./workflows/supply-chain-workflow.md` | `commands.md § "Bundle Signing"`, `§ "SkillBOM"` |
| Artifact version history, rollback, or snapshots | `./workflows/versioning-workflow.md` | `commands.md § "Versioning"` |
| OAuth login, PAT storage, or credential lifecycle | `./workflows/auth-workflow.md` | `commands.md § "Authentication"` |
| Enterprise migration or multi-tenant setup | `./workflows/enterprise-workflow.md` | `commands.md § "Migration"` |
| Error recovery, rate limits, or network failures | `./workflows/error-handling.md` | `reference.md § "Exit Codes"` |

---

## Policy

### Progressive Disclosure

1. Start from user intent; open only the one workflow doc that matches.
2. Do not load all workflow files by default.
3. Pair the workflow doc with canonical CLI docs for command syntax — never duplicate syntax here.
4. For memory operations: if `skillmeat memory item create` returns 422/400, use the API fallback in `./workflows/memory-context-workflow.md § "API Fallback Procedure"`.

### Permission Protocol

Require explicit confirmation before:
- Deploying or removing artifacts
- Bulk updates, memory extraction apply, or memory merges
- Any destructive BOM or enterprise migration operation

Read-only operations (search, list, show, preview, diagnostics) do not require extra confirmation.

### Route-First Invariant

Prefer canonical user docs over workflow duplication. Workflows exist to cover
agent-specific multi-step patterns and confirmation flows that the user docs do
not address. If the canonical doc covers the intent completely, link to it and
stop — do not re-document command syntax here.
