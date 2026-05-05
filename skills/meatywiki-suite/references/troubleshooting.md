---
name: meatywiki-suite-troubleshooting
description: Common failures, error patterns, and remediation steps for engine CLI, Portal API, and MCP
type: reference
skill_name: meatywiki-suite
cli_version_range: "compilation-engine-v1 – v1.2, portal-v2"
schema_version: 1
created: 2026-05-04
updated: 2026-05-04
---

# Troubleshooting Reference

Quick lookup for symptoms, root causes, and fixes. Check `meatywiki doctor` first for automated diagnosis.

---

## CLI Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Vault not found` | `MEATYWIKI_VAULT_ROOT` not set; no `--vault` flag | Set `export MEATYWIKI_VAULT_ROOT=/path/to/vault` or pass `--vault` on every command |
| `Index corrupted` / `stale FTS5 results` | Manual vault edits bypassed `vault/writer.py` | `meatywiki index --reset` |
| `Compile hangs` | LLM provider timeout or bad API key | Check `OPENAI_API_KEY` (or provider key); verify model names in `_meta/config.yaml` |
| `No artifacts compiled` | All artifacts already in `compile_state.json` | Use `meatywiki compile --full` to force recompile; or delete specific entry from `compile_state.json` |
| `Permission denied on _meta/` | Wrong file ownership (e.g., created by root) | `sudo chown -R $USER _meta/` inside the vault root |
| `Unknown source type` | Ambiguous JSON file; connector dispatch failed | Use `--type chatgpt` / `--type perplexity` / `--type gemini` explicitly |
| `Prompt template error` | Override in `_prompts/` uses `{var}` instead of `$var` | Change override to `$variable` syntax (`string.Template.safe_substitute`) |
| `Agent mode fails / falls back` | Provider not declared `capabilities.agent_mode: native` | Check `_meta/config.yaml`; only native-capable providers use `AgentRuntime` |
| `Structured-output stage silently skips` | `max_turns < 2` in agent mode config | Set `max_turns: 2` or higher for compile/query stages |

---

## Portal API Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Missing or wrong bearer token | Check `MEATYWIKI_PORTAL_TOKEN`; pass as `Authorization: Bearer <token>` |
| `503 Service Unavailable` | Startup reconcile still running | Wait for reconcile to complete (watch portal logs); retry after health check passes |
| `500` on reconcile endpoint | Vault drift exceeds 10% safety threshold | Run `meatywiki portal reconcile --check` first; investigate drift manually before applying |
| `Connection refused` | Server not running, or bound to loopback only | Confirm portal is running; if accessing remotely, set `PORTAL_ALLOW_NETWORK=1` and restart |
| Empty artifact list from `/api/artifacts` | Reconcile has not run since startup | `POST /api/admin/reconcile` to trigger immediate reconcile |
| Intake job stuck in `pending` / `processing` | Worker (arq) not running | Check queue backend config; restart the arq worker process alongside the portal |
| `404` on artifact endpoint | Artifact not yet reconciled, or wrong ID | Confirm artifact exists with `meatywiki search`; then `POST /api/admin/reconcile` |
| Intake job stuck in `pending_approval` | `PORTAL_INBOX_REQUIRE_APPROVAL=1` set | Approve or reject via `POST /api/intake/jobs/{id}/approve` (or `/reject`) |
| `422 Unprocessable Entity` | Bad request body (missing required fields) | Check API schema at `/docs`; confirm `Content-Type: application/json` header |
| SSE stream closes immediately | Run already complete when client connects | Fetch `GET /api/workflows/runs/{run_id}` for final state instead |

---

## MCP Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `MEATYWIKI_VAULT_PATH not set` | Env var missing when MCP server started | Set `MEATYWIKI_VAULT_PATH=/path/to/vault` in shell or MCP host config before starting |
| `Database locked` | Another write process holding SQLite lock | MCP opens SQLite with `?mode=ro`; if conflict persists, check for hung CLI process |
| Query timeout (default 2s) | Vault too large or query too broad | Add `workspace` filter to narrow scope; increase timeout via MCP host config if supported |
| MCP tool returns empty results | Vault index out of date | Run `meatywiki index --reset` from CLI, then restart MCP server |
| MCP server crashes on start | Missing Python deps or wrong venv | `uv sync --extra portal` to install all deps; confirm MCP is started with the project venv |

---

## Index and Data Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Duplicate artifacts in search results | Reingest without deduplication | `meatywiki doctor --fix` (detects and merges duplicates) |
| Missing graph edges / relationships | Synthesis stage not run after ingest | `meatywiki synthesize` or `meatywiki compile --full` |
| FTS5 full-text search returns stale results | Index behind vault state after manual edit | `meatywiki index --reset` |
| Postgres overlay out of sync with vault | Manual vault edit or crashed reconcile | `meatywiki portal reconcile` (run `--check` first to assess drift) |
| Artifacts missing from `wiki/` after ingest | `--compile` flag not passed; ingest alone does not compile | Re-run with `meatywiki compile --pending` or `meatywiki ingest ... --compile` |
| Embeddings stale or missing | Portal embed not run after new artifacts | `meatywiki portal embed` (or `--force` to refresh all) |
| `compile_state.json` desync | Interrupted compile or manual file edit | Delete stale entry in `compile_state.json` and re-run `meatywiki compile` |

---

## Diagnostic Commands

```bash
# Overall vault health
meatywiki doctor

# Auto-fix all repairable issues
meatywiki doctor --fix

# Check for Postgres/vault drift without applying changes
meatywiki portal reconcile --check

# Dump stats as JSON for scripted inspection
meatywiki stats --json

# Rebuild FTS5 index from scratch
meatywiki index --reset

# Force-refresh all embeddings
meatywiki portal embed --force
```

---

## Escalation Path

1. Run `meatywiki doctor --fix` — covers most common issues automatically.
2. Check portal logs (structlog JSON output) for stack traces on 5xx errors.
3. For Postgres drift, always run `--check` before applying reconcile to avoid data loss.
4. For persistent LLM failures, verify provider keys and model names in `_meta/config.yaml` before filing an issue.
