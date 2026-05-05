---
name: meatywiki-suite-mcp-reference
description: MCP server tools for Claude Agent SDK — vault.search and vault.read
type: reference
skill_name: meatywiki-suite
cli_version_range: "compilation-engine-v1 – v1.2"
schema_version: 1
created: 2026-05-04
updated: 2026-05-04
---

# MCP Server Reference

Module: `meatywiki.llm.agent.mcp_server`
Server name (registered): `meatywiki-vault`
Version: `1.0.0`

## Running the Server

```bash
# Subprocess / stdio mode
python -m meatywiki.llm.agent.mcp_server

# In-process (AgentRuntime factory)
from meatywiki.llm.agent.mcp_server import build_vault_mcp_server
server_cfg = build_vault_mcp_server(vault_path / "_meta" / "meatywiki.db")
```

Required env: `MEATYWIKI_VAULT_PATH` — resolved to `$MEATYWIKI_VAULT_PATH/_meta/meatywiki.db`.

## Safety Guarantees

- SQLite opened with `?mode=ro` URI — any write attempt raises `sqlite3.OperationalError`.
- Never imports `meatywiki.vault.*`; no filesystem writes.
- 2-second timeout per tool call (`asyncio.wait_for`).
- 100 KB hard payload cap per tool result; excess is truncated with `[...TRUNCATED]` sentinel.

---

## tool: vault.search

FTS5 full-text search over the vault index.

### Parameters

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `query` | string | yes | — | FTS5 query string, 1–500 chars |
| `workspace` | string | no | null | e.g. `inbox`, `library`, `research`, `blog`, `projects` |
| `artifact_type` | string | no | null | e.g. `concept`, `entity`, `synthesis` |
| `limit` | int | no | 20 | 1–20 |

### Returns: VaultSearchOutput

```json
{
  "results": [
    {
      "id": "01HZ...",
      "title": "Artifact Title",
      "artifact_type": "concept",
      "workspace": "library",
      "snippet": "...body <b>match</b> excerpt...",
      "rank": -0.87
    }
  ],
  "total_hint": 3,
  "truncated": false,
  "query": "semantic search"
}
```

`rank` is BM25 (lower is better). `total_hint` equals `min(results_found, limit+1)` — if `total_hint > limit`, more results exist.

### Example Call

```json
{
  "tool": "vault.search",
  "arguments": {
    "query": "pgvector embedding semantic search",
    "workspace": "library",
    "artifact_type": "concept",
    "limit": 5
  }
}
```

### Error Envelope (on failure)

```json
{
  "error": "vault.search timed out after 2.0s",
  "error_type": "TimeoutError",
  "retryable": true
}
```

`retryable: true` — SQLite/timeout errors. `retryable: false` — validation errors.

---

## tool: vault.read

Fetch a single artifact by ULID.

### Parameters

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `artifact_id` | string | yes | 26-char ULID, pattern `[0-9A-HJKMNP-TV-Z]{26}` |

Note: the `id` stored in frontmatter has the form `art_<ULID>` (30 chars). The MCP tool takes only the 26-char ULID suffix (the part after `art_`).

### Returns: VaultReadOutput

```json
{
  "id": "01HZ...",
  "title": "Artifact Title",
  "artifact_type": "synthesis",
  "workspace": "library",
  "file_path": "wiki/syntheses/artifact-title.md",
  "envelope": {
    "summary": "...",
    "status": "active",
    "lifecycle_stage": "compiled",
    "freshness_class": "current",
    "verification_status": "unverified",
    "created_at": "2026-01-01T00:00:00+00:00",
    "updated_at": "2026-05-01T12:00:00+00:00",
    "domain": ["ml", "infra"],
    "tags": ["search", "vector"]
  },
  "body_preview": "# First 8 KB of body...",
  "body_truncated": false,
  "body_bytes_total": 3412
}
```

`body_preview` is always capped at 8 KB. When `body_truncated: true`, the full body is larger; use `body_bytes_total` for diagnostics. The `envelope` dict contains indexed metadata columns — it is not the full frontmatter, only what the index stores.

### Example Call

```json
{
  "tool": "vault.read",
  "arguments": {
    "artifact_id": "01HZ3ABCDE4FGHJKMNPQRSTVWX"
  }
}
```

### Error Envelope (artifact not found)

```json
{
  "error": "Artifact not found: '01HZ...'",
  "error_type": "KeyError",
  "retryable": false
}
```

---

## Agent Config Snippet

Add the MCP server to a stage's `tools` list in `_meta/config.yaml`:

```yaml
models:
  compile:
    provider: anthropic
    model: claude-opus-4-6
    agent:
      system_prompt: "Compile and synthesize vault content. Cite sources as [source: art_ULID]."
      tools: [vault_search, vault_read]
      max_turns: 6
  query:
    provider: anthropic
    model: claude-opus-4-6
    agent:
      system_prompt: "Answer questions by searching and reading vault artifacts."
      tools: [vault_search, vault_read]
      max_turns: 6
```

Tool-free stages (classify, extract, lint) use `tools: []`.

## MCP Config for claude_desktop_config.json

```json
{
  "mcpServers": {
    "meatywiki": {
      "command": "python",
      "args": ["-m", "meatywiki.llm.agent.mcp_server"],
      "env": {
        "MEATYWIKI_VAULT_PATH": "/path/to/vault"
      }
    }
  }
}
```

## Install Requirement

```bash
uv sync --extra agent
# Installs: claude-agent-sdk>=0.1,<0.2, anyio>=4.0, mcp>=1.0
```

The MCP server is only available when the `agent` extra is installed.

## Observability

Each agent turn using these tools emits an `llm.agent.turn` event with `tools_invoked` (list of tool names, never content). On MCP/SDK failure, the runtime degrades to a single sync `chat()` call and emits `llm.agent.run_failed` + `llm.call` with `degraded=True`.
