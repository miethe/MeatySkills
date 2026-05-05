---
name: meatywiki-suite-deployment-guide
description: Setup and deployment guide for agentic MeatyWiki usage — CLI, Portal server, MCP server
type: reference
skill_name: meatywiki-suite
cli_version_range: "compilation-engine-v1 – v1.2, portal-v2"
schema_version: 1
created: 2026-05-04
updated: 2026-05-04
---

# Deployment Guide

Three deployment modes — use one or combine.

---

## Mode 1: CLI-Only (Simplest)

Best for: single-user, batch workflows, agent using shell tools directly.

```bash
# From PyPI
uv pip install meatywiki

# Or from repo checkout
uv sync
```

Init vault:

```bash
meatywiki init --vault /path/to/vault
export MEATYWIKI_VAULT_ROOT=/path/to/vault
```

Agent invokes CLI commands via shell:

```bash
meatywiki ingest --file /path/to/doc.pdf
meatywiki compile
meatywiki query "What do I know about pgvector?"
meatywiki index --status
```

No daemon required. SQLite lives at `$MEATYWIKI_VAULT_ROOT/_meta/meatywiki.db`.

---

## Mode 2: Portal API Server

Best for: REST API access, async intake workflows, Workflow OS surfaces, semantic search.

### Prerequisites

- PostgreSQL (async URL via `asyncpg`)
- Redis or Postgres LISTEN/NOTIFY for the arq worker queue

### Install

```bash
uv sync --extra portal          # Portal core
uv sync --extra portal-full     # Portal + agent mode (MCP server included)
```

### Start

```bash
# Run migrations (auto-run on startup if not run manually)
meatywiki portal db upgrade

# Start API server (binds localhost:8910 by default)
meatywiki serve --port 8910
```

All routes except `/health` and `/docs` require `Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN`.

For local dev without auth:

```bash
PORTAL_DISABLE_AUTH=1 meatywiki serve
```

Agent calls API with bearer token:

```bash
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  http://127.0.0.1:8910/api/v1/artifacts?workspace=library&limit=20
```

---

## Mode 3: MCP Server (Agent SDK Integration)

Best for: Claude Agent SDK compile/query stages needing vault read access.

### Install

```bash
uv sync --extra agent
# or
uv sync --extra portal-full  # includes agent extra
```

### Start

```bash
MEATYWIKI_VAULT_PATH=/path/to/vault python -m meatywiki.llm.agent.mcp_server
```

Add to agent MCP config — see `./mcp-reference.md` for full config block.

Access is read-only. Pair with CLI or Portal API for write operations.

---

## Combined Deployment (Recommended)

Full agentic capability:

| Component | Role |
|-----------|------|
| Portal API server | CRUD, intake workflows, semantic search, Workflow OS |
| MCP server | Agent SDK read access (compile/query stages) |
| CLI | Batch ops: `compile`, `lint`, `synthesize`, `migrate-edges`, `index --reset` |

Start sequence:

```bash
# 1. Start Portal (includes reconciler + arq worker on pg backend)
PORTAL_DATABASE_URL=postgresql+asyncpg://... \
MEATYWIKI_VAULT_ROOT=/path/to/vault \
MEATYWIKI_PORTAL_TOKEN=<token> \
meatywiki serve

# 2. Start MCP server (separate process)
MEATYWIKI_VAULT_PATH=/path/to/vault \
python -m meatywiki.llm.agent.mcp_server

# 3. CLI available in any shell with vault root set
export MEATYWIKI_VAULT_ROOT=/path/to/vault
```

---

## Environment Variable Reference

| Variable | Required by | Default | Purpose |
|----------|-------------|---------|---------|
| `MEATYWIKI_VAULT_ROOT` | CLI, Portal | cwd | Vault root path |
| `MEATYWIKI_VAULT_PATH` | MCP server | — | Vault path for MCP server (resolves `_meta/meatywiki.db`) |
| `MEATYWIKI_PORTAL_TOKEN` | Portal | — | Bearer auth token for all non-health routes |
| `PORTAL_DATABASE_URL` | Portal | — | PostgreSQL async URL (`postgresql+asyncpg://...`) |
| `PORTAL_BIND_HOST` | Portal | `127.0.0.1` | Server bind host |
| `PORTAL_BIND_PORT` | Portal | `8910` | Server bind port |
| `PORTAL_ALLOW_NETWORK` | Portal | `0` | Allow non-loopback bind (set `1` to enable) |
| `PORTAL_DISABLE_AUTH` | Portal | `0` | Skip bearer auth check (dev only) |
| `PORTAL_AUTO_COMPILE` | Portal | `1` | Auto-compile artifacts on ingest |
| `PORTAL_QUEUE_BACKEND` | Portal | `pg` | Worker queue backend (`pg` or `redis`) |
| `PORTAL_INBOX_DIR` | Portal | — | Directory to watch for inbox intake |
| `PORTAL_INBOX_REQUIRE_APPROVAL` | Portal | `0` | Require human approval before intake processes |
| `PORTAL_EMBED_SCHEDULE` | Portal | `02:00` | Daily embedding refresh schedule (HH:MM UTC) |
| `PORTAL_ENABLE_OPERATOR_CONTROL` | Portal | `0` | Enable workflow pause/resume/cancel endpoints |
| `PORTAL_FRESHNESS_THRESHOLD_DAYS` | Portal | `30` | Days before an artifact is classified as aging |
| `ANTHROPIC_API_KEY` | LLM sync path | — | API key for sync LLM calls (classify, extract, lint) |
| `CLAUDE_CODE_OAUTH_TOKEN` | Agent SDK | — | One-year OAuth token for agent mode (recommended for daemons) |
| `ANTHROPIC_BASE_URL` | LLM / Agent | — | Override base URL (e.g. LiteLLM proxy) |

### Auth for Agent Mode

Three options in priority order:

1. `CLAUDE_CODE_OAUTH_TOKEN` — recommended for daemons; generate with `claude setup-token` (1-year validity).
2. macOS Keychain — auto-used if you have run `claude /login`; expires in ~6–8 hours.
3. `ANTHROPIC_API_KEY` — sync LLM fallback only; not used by Agent SDK.

For long-running arq workers (>8 hours), always use `CLAUDE_CODE_OAUTH_TOKEN`.

---

## Quick-Start Checklist

### CLI-only

- [ ] `uv pip install meatywiki` or `uv sync`
- [ ] `meatywiki init --vault /path/to/vault`
- [ ] `export MEATYWIKI_VAULT_ROOT=/path/to/vault`
- [ ] `export ANTHROPIC_API_KEY=...` (or configure `_meta/config.yaml` with your provider)
- [ ] `meatywiki ingest --file first-doc.md && meatywiki compile`

### Portal server

- [ ] PostgreSQL running and `PORTAL_DATABASE_URL` set
- [ ] `uv sync --extra portal`
- [ ] `MEATYWIKI_PORTAL_TOKEN` set to a random secret
- [ ] `meatywiki serve` (auto-migrates on startup)
- [ ] Confirm `/health` returns `{"status": "ok"}`

### Agent SDK (MCP)

- [ ] `uv sync --extra agent`
- [ ] `claude setup-token` and set `CLAUDE_CODE_OAUTH_TOKEN`
- [ ] `_meta/config.yaml` has `agent:` block with `tools: [vault_search, vault_read]` for compile/query
- [ ] `MEATYWIKI_VAULT_PATH` set
- [ ] Smoke test: `uv run python scripts/smoke/agent/smoke_agent_query.py --vault /path/to/vault --question "test"`
