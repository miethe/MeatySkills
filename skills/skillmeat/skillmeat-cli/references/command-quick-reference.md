---
schema_version: "1.0"
doc_type: pointer
updated: 2026-04-14
---

# SkillMeat CLI Command Quick Reference

For complete CLI syntax, see `docs/user/guides/cli/reference.md` (auto-generated) and `docs/user/guides/cli/commands.md` (prose guide). This doc captures agent-specific tips only.

---

## Agent-Specific Tips

### JSON Output and Parsing
Always use `--json` when output must be consumed by agents or scripts. Popular targets: `skillmeat list --json`, `skillmeat search "<query>" --json`, `skillmeat memory item list --project <project> --json`. Parse with `jq` or your platform's JSON parser.

### Exit Codes
Non-zero codes indicate failure. Common values: `1` (general error), `2` (invalid usage), `3` (not found), `4` (conflict/already exists), `5` (permission denied — usually auth issue). Check `$?` in bash after running a command to determine the cause.

### GitHub Token and Rate Limiting
Unauthenticated requests are limited to 60 req/hr. With a fine-grained token (format: `ghp_...`), limit increases to 5,000 req/hr. Set via `skillmeat config set github-token <token>` or `GITHUB_TOKEN` environment variable. Resolves automatically — no manual header passing needed.

### Memory API Fallback
CLI `skillmeat memory item create` may return `422` or `400` when project resolution fails. Use the HTTP API fallback: `curl -s "http://localhost:8080/api/v1/memory-items?project_id=<BASE64_ID>" -X POST -H "Content-Type: application/json" -d '{...}'`. Anchors in API payloads must be strings (`"path:type"`), not objects.

### Confirmation Protocol
Destructive operations (deploy, remove, bulk updates) require explicit confirmation. Read-only operations (list, search, show) do not. See `SKILL.md § "Permission Protocol"` for full policy.

---

## Quick Intent Map

| Intent | Workflow File |
|--------|---------------|
| Find or search artifacts | `workflows/discovery-workflow.md` |
| Deploy or add artifact to project | `workflows/deployment-workflow.md` |
| List, inspect, sync, or remove artifacts | `workflows/management-workflow.md` |
| Create or publish bundle | `workflows/bundle-workflow.md` |
| Memory items, modules, or context packs | `workflows/memory-context-workflow.md` |
| Versioning, rollback, or snapshots | `workflows/versioning-workflow.md` |
| Auth, PAT, or OAuth flows | `workflows/auth-workflow.md` |
| Rate limits, exit codes, or error recovery | `workflows/error-handling.md` |
