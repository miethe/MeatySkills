---
name: meatywiki-suite
description: >-
  Full-lifecycle MeatyWiki usage — compilation engine CLI, Portal REST API, and
  MCP server. Use when: running any MeatyWiki CLI command, calling Portal API
  endpoints, performing vault CRUD, ingesting content, compiling artifacts,
  querying knowledge, managing workflows, or deploying MeatyWiki for agentic use.
schema_version: 1
skill_version: 1.0.0
app_version_pin: "2.0.0"
cli_version_range: "compilation-engine-v1 – v1.2"
spec_ref: SPEC.md
related_skills:
  - meatywiki
---

# MeatyWiki Suite Skill

## §1 System Overview

MeatyWiki = file-first knowledge-compilation system over an Obsidian-compatible markdown vault.
Three access surfaces: CLI (engine commands), Portal API (FastAPI REST, Postgres overlay), MCP
server (read-only vault tools for agent SDK). Vault is canonical; SQLite+FTS5 and Postgres are
derived indexes — both are rebuildable from vault files at any time.

---

## §2 Surface Selector

| Goal | Surface | Entry |
|------|---------|-------|
| Ingest content (URL/PDF/file/note) | CLI | `meatywiki ingest <path-or-url>` |
| Compile raw→wiki artifacts | CLI | `meatywiki compile --pending` |
| Full compile loop | CLI | `meatywiki compile --full` |
| Query knowledge base | CLI | `meatywiki query "question"` |
| Search artifacts | CLI or API | `meatywiki search "term"` or `GET /api/search` |
| Suggest/autocomplete | API | `GET /api/search/suggest?q=...` |
| Create a note (quick intake) | API | `POST /api/intake/note` |
| Ingest URL via API | API | `POST /api/intake/url` |
| List/filter artifacts | API | `GET /api/artifacts` |
| Get artifact detail | API | `GET /api/artifacts/{id}` |
| Update artifact metadata | API | `PATCH /api/artifacts/{id}` |
| Bulk metadata update | API | `POST /api/artifacts/bulk-metadata` |
| Run lint checks | CLI | `meatywiki lint` |
| Synthesize relationships | CLI | `meatywiki synthesize` |
| Manage workflow templates | API | CRUD at `/api/workflow-templates` |
| Start a workflow | API | `POST /api/workflows/synthesize` |
| Monitor workflow progress | API | `GET /api/workflows/{run_id}/stream` (SSE) |
| Vault search (agent SDK) | MCP | `vault.search` tool |
| Read artifact (agent SDK) | MCP | `vault.read` tool |
| Blog post CRUD | API | `/api/blog/posts` endpoints |
| Manage lens scores | API | `PATCH /api/artifacts/{id}/lens` |
| Context pack CRUD | API | `/api/projects/context-packs` |
| Health check | API | `GET /health` |
| Reconcile vault↔DB | CLI | `meatywiki portal reconcile` |
| Generate embeddings | CLI | `meatywiki portal embed` |
| Start Portal server | CLI | `meatywiki serve` |
| Initialize vault | CLI | `meatywiki init` |
| Repair index | CLI | `meatywiki doctor` |
| Vault statistics | CLI | `meatywiki stats` |
| Watch for changes | CLI | `meatywiki watch` |

---

## §3 Authentication & Config

| Env Var | Required | Purpose |
|---------|----------|---------|
| `MEATYWIKI_VAULT_ROOT` | CLI | Vault path; overridden by `--vault` flag |
| `MEATYWIKI_PORTAL_TOKEN` | API | Bearer token for all `/api/*` routes |
| `PORTAL_DATABASE_URL` | Portal | Async Postgres URL (e.g. `postgresql+asyncpg://...`) |
| `PORTAL_DISABLE_AUTH` | Dev only | Set `1` to skip auth enforcement |
| `PORTAL_BIND_HOST` | Portal | Bind host (default `127.0.0.1`) |
| `PORTAL_BIND_PORT` | Portal | Bind port (default `8910`) |
| `PORTAL_ALLOW_NETWORK` | Portal | Set `1` to allow non-loopback bind |
| `MEATYWIKI_VAULT_PATH` | MCP | Vault path for MCP server |

API auth header: `Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN`
Routes exempt from auth: `GET /health`, `GET /docs`, `GET /openapi.json`

---

## §4 Top 7 Recipes

**1. Ingest URL + compile**
```bash
meatywiki ingest https://example.com
meatywiki compile --pending
```

**2. Quick note via API**
```bash
curl -X POST "$PORTAL/api/intake/note" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"My Note","body":"content here"}'
```

**3. Search + query**
```bash
meatywiki search "kubernetes networking" --limit 5
meatywiki query "explain kubernetes CNI" --scope wiki/concepts
```

**4. Full recompile**
```bash
meatywiki compile --full --verbose
```

**5. List artifacts via API**
```bash
curl "$PORTAL/api/artifacts?workspace=wiki&type=concept&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**6. Agent SDK vault search (MCP)**
```python
vault.search(query="machine learning", workspace="wiki", limit=5)
vault.read(artifact_id="<id>")
```

**7. Reconcile after manual vault edits**
```bash
meatywiki portal reconcile --check   # dry run — exits non-zero on drift
meatywiki portal reconcile           # apply reconciliation
```

---

## §5 Guardrails

(a) All vault writes through engine — CLI or EngineAdapter. Never edit vault files directly with
    file I/O from Portal code or agent scripts.

(b) `_meta/` is engine-owned. Never manually edit `meatywiki.db`, `compile_state.json`, or
    `config.yaml` — treat them as opaque engine artifacts.

(c) Portal routes through EngineAdapter — never import `meatywiki.vault` or
    `meatywiki.workflows` from Portal modules. Ruff rule `PORTAL-001` blocks this in CI.

(d) Write-through-engine: all Portal mutations flow through EngineAdapter → vault writer → index
    update in a single transaction. Out-of-band writes cause index drift.

(e) Two-truth reconciliation: Postgres overlay is derived from vault. Reconciler runs on Portal
    startup and on FS-watch events. Run `meatywiki portal reconcile --check` to verify sync.

(f) Query uses FTS5 only in V1 CLI. Semantic/vector search is available via Portal v2 embeddings
    API only when `PORTAL_DATABASE_URL` is configured and embeddings have been generated
    (`meatywiki portal embed`).

(g) API envelope: all responses wrapped `{"data": ..., "meta": {...}}` with cursor pagination.
    Cursor field: `meta.next_cursor`. Page size max 100.

---

## §6 Deferred / Not-Yet-Available

| Tag | Feature | Status |
|-----|---------|--------|
| F1 | SAM hook | No-op stub; `register` command not wired |
| F2 | CCDash hook | No-op stub |
| F4 | Developer-artifact connectors (GitHub, SkillMeat) | Not implemented |
| — | Image OCR | Opaque uploads only; no text extraction |
| — | `agent_visibility` enforcement | Advisory field; not enforced at runtime |
| — | Multi-user auth / RBAC | Single-user system; no tenant isolation |
| — | Audio transcription | `AudioConnector` creates `[transcript pending]` placeholder |

---

## §7 References

Load the relevant reference file only when you need detail beyond this overview.

| File | Load when | ~Lines |
|------|-----------|--------|
| `references/cli-reference.md` | CLI flags, options, or command detail needed | <800 |
| `references/portal-api-reference.md` | API endpoint schemas, request/response shapes | <800 |
| `references/mcp-reference.md` | MCP tool signatures, capabilities, limitations | <300 |
| `references/vault-layout.md` | Vault directory structure, path conventions | <500 |
| `references/artifact-taxonomy.md` | Artifact types, workspaces, facets, lifecycle states | <600 |
| `references/workflow-patterns.md` | Multi-step recipes, SSE polling, async job patterns | <800 |
| `references/deployment-guide.md` | Setting up Portal + MCP for agentic use | <500 |
| `references/troubleshooting.md` | Error codes, index repair, drift diagnosis | <500 |

---

## §8 Contract

See `SPEC.md` for coverage matrix, version compatibility, open questions, and update protocol.
