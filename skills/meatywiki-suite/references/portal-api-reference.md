---
name: meatywiki-suite-portal-api-reference
description: Complete Portal REST API endpoint reference — all routes, methods, parameters, response shapes
type: reference
skill_name: meatywiki-suite
cli_version_range: "portal-v2"
schema_version: 1
created: 2026-05-04
updated: 2026-05-04
---

# Portal REST API Reference

## Base URL & Auth

| Item | Value |
|------|-------|
| Default base URL | `http://localhost:8910` |
| Auth header | `Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN` |
| Auth exempt | `GET /health`, `GET /docs` only |
| Disable auth (dev) | `PORTAL_DISABLE_AUTH=1` |

### Response Envelope (list endpoints)

```json
{
  "data": [...],
  "cursor": "opaque-string-or-null",
  "etag": "W/\"abc123\""
}
```

Cursor is `null` on the last page. Pass as `?cursor=<value>` on the next request.

### Error Envelope

```json
{"error": {"code": "not_found", "message": "...", "details": {}}}
```

### Pagination Defaults

- Default page size: varies by endpoint (commonly 20–50)
- Max page size: 100–500 depending on endpoint
- Strategy: keyset cursor (`updated_at DESC, id DESC`) for artifact lists; offset cursor (base64 JSON `{"o": N}`) for search results

---

## Health & Admin

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | None | Service health snapshot |
| `GET` | `/docs` | None | OpenAPI documentation UI |
| `POST` | `/api/admin/reconcile` | Required | Trigger vault→Postgres reconciliation |
| `POST` | `/api/admin/inbox/scan` | Required | Scan inbox directory for new files |
| `GET` | `/api/config` | Required | Read portal runtime configuration |
| `PATCH` | `/api/config` | Required | Update inbox_dir, auto_compile, inbox_require_approval |
| `PATCH` | `/api/config/token` | Required | Rotate bearer token (in-process, not persisted) |

### `GET /health` — response fields

```json
{
  "status": "healthy",
  "version": "2.0.0",
  "engine_version": "1.2.0",
  "overlay_row_counts": {"artifacts": 412, "workflow_runs": 7, "workflow_events": 38},
  "last_reconcile_at": "2026-05-04T10:00:00+00:00",
  "last_reconcile_duration_ms": 243,
  "worker_queue_depth": 0,
  "uptime_seconds": 3600,
  "reconcile": {"schedule": null, "last_at": "...", "last_duration_ms": 243},
  "embed": {"schedule": null, "last_run_at": null, "last_duration_ms": null}
}
```

`status` is `"degraded"` when any overlay count is `null` or queue depth is unavailable.

### `POST /api/admin/reconcile` — response

```json
{
  "started_at": "2026-05-04T10:00:00+00:00",
  "finished_at": "2026-05-04T10:00:00.243+00:00",
  "duration_ms": 243,
  "artifacts_upserted": 5,
  "artifacts_deleted": 0,
  "drift_detected": false,
  "errors": []
}
```

Returns 503 when reconciler is unavailable.

### `GET /api/config` — response

```json
{
  "inbox_dir": "/path/to/inbox",
  "auto_compile": true,
  "inbox_require_approval": false,
  "portal_version": "2.0.0"
}
```

### `PATCH /api/config` — request body (all optional)

```json
{"inbox_dir": "/new/path", "auto_compile": false, "inbox_require_approval": true}
```

Set `inbox_dir` to `""` to clear and stop the watcher. Returns updated `ConfigResponse`.

### `PATCH /api/config/token` — request / response

```json
// request
{"new_token": "new-secret-value"}

// response
{"rotated": true, "message": "Token updated in-process. Restart to persist."}
```

### Curl example

```bash
curl -s http://localhost:8910/health | jq .status
# "healthy"

curl -s -X POST http://localhost:8910/api/admin/reconcile \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" | jq '{upserted:.artifacts_upserted, drift:.drift_detected}'
# {"upserted": 5, "drift": false}
```

---

## Artifacts

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/artifacts` | Cursor-paginated artifact list |
| `GET` | `/api/artifacts/{id}` | Artifact detail with edges and body |
| `PATCH` | `/api/artifacts/{id}` | Update artifact metadata |
| `POST` | `/api/artifacts/{id}/promote` | Advance lifecycle stage |
| `POST` | `/api/artifacts/{id}/link` | Create directed edge to another artifact |
| `POST` | `/api/artifacts/{id}/review` | Add to review queue |
| `GET` | `/api/artifacts/{id}/edges` | Incoming and outgoing graph edges |
| `GET` | `/api/artifacts/{id}/processing-history` | Compile/workflow event history |
| `GET` | `/api/artifacts/{id}/routing-recommendation` | Rule-based routing suggestion |
| `GET` | `/api/artifacts/{id}/quality-gates` | Quality gate results from last lint run |
| `PATCH` | `/api/artifacts/{id}/lens` | Update lens scores (fidelity, freshness, verification) |

### `GET /api/artifacts` — query parameters

| Param | Type | Notes |
|-------|------|-------|
| `workspace` | string | Exact workspace column match |
| `facet` | `library\|research\|blog\|projects` | Surface-level filter; prefer over `workspace` for UI queries |
| `type` | string | Artifact type (e.g. `concept`, `synthesis`) |
| `status` | string | Lifecycle status; `review` maps to `draft OR stale` |
| `q` | string | Full-text search (FTS5) |
| `tag[]` | repeatable | AND semantics; max 10 tags |
| `lens_fidelity` | `high\|medium\|low` | Comma-separated or multi-value; OR within param |
| `lens_freshness` | `current\|stale\|outdated` | Same |
| `lens_verification` | `verified\|disputed\|unverified` | Same |
| `cursor` | string | Opaque keyset cursor |
| `limit` | int | Page size (default 20) |
| `sort` | string | Sort field |
| `order` | `asc\|desc` | Sort direction |
| `source_type` | string | Source connector type |

Special: `status=review&facet=research` activates the research-faceted review queue (sorts by oldest synthesis run first).

### `GET /api/artifacts/{id}` — response shape summary

```json
{
  "data": {
    "id": "01HXYZ...",
    "title": "Artifact Title",
    "artifact_type": "concept",
    "workspace": "library",
    "status": "compiled",
    "lifecycle_stage": "published",
    "tags": ["tag1"],
    "compiled_content": "...",
    "draft_content": "...",
    "raw_content": "...",
    "lens": {"fidelity_level": "high", "freshness_class": "current", "verification_status": "verified"},
    "edges": {"outgoing": [], "incoming": []},
    "updated_at": "2026-05-04T10:00:00+00:00"
  },
  "cursor": null,
  "etag": "W/\"abc123\""
}
```

Returns 404 with `ErrorEnvelope` when not found.

### `PATCH /api/artifacts/{id}` — request body (all optional)

```json
{"title": "New Title", "tags": ["a", "b"], "workspace": "research", "status": "compiled"}
```

### `POST /api/artifacts/{id}/promote` — response

```json
{"artifact_id": "01HXYZ...", "lifecycle_stage": "published"}
```

### `POST /api/artifacts/{id}/link` — request / response

```json
// request
{"target_id": "01HABC...", "edge_type": "relates_to"}

// response — 201
{"status": "linked"}
```

### `PATCH /api/artifacts/{id}/lens` — request body (all optional)

```json
{
  "fidelity_level": "high",
  "freshness_class": "current",
  "verification_status": "verified",
  "fidelity": 0.9,
  "freshness": 0.8
}
```

Returns `ServiceModeEnvelope[ArtifactMetadataResponse]`.

### `GET /api/artifacts/{id}/quality-gates` — response

```json
{"rules": [{"name": "has_sources", "passed": true, "condition": "source_refs not empty"}]}
```

Returns `null` (HTTP 200) when no gate data exists for the artifact.

### Curl example

```bash
curl -s http://localhost:8910/api/artifacts?facet=research&limit=5 \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" | jq '.data[].title'

curl -s http://localhost:8910/api/artifacts/01HXYZ.../edges \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" | jq '.outgoing | length'
```

---

## Intake

| Method | Path | Status | Purpose |
|--------|------|--------|---------|
| `POST` | `/api/intake/note` | 202 | Enqueue plain-text note |
| `POST` | `/api/intake/url` | 202 | Enqueue URL for fetch+ingest |
| `POST` | `/api/intake/upload` | 202 | Enqueue file upload (multipart) |
| `GET` | `/api/intake/status/{run_id}` | 200 | Job status by run_id |
| `GET` | `/api/intake/pending` | 200 | List items awaiting approval |
| `POST` | `/api/intake/{run_id}/approve` | 200 | Approve pending item |
| `POST` | `/api/intake/{run_id}/reject` | 200 | Reject pending item |

### `POST /api/intake/note` — request

```json
{"text": "Note content here.", "source": "optional-source", "workspace": "research", "tags": ["tag1"]}
```

### `POST /api/intake/url` — request

```json
{"url": "https://example.com/article", "title": "Optional Title", "tags": ["web"]}
```

### `POST /api/intake/upload` — multipart form

Fields: `file` (required), `title` (optional string), `tags` (optional JSON array or comma-separated string).

Accepted extensions: `.pdf`, `.txt`, `.md`, `.webm`, `.ogg`, `.mp4`, `.wav`, `.m4a`.
Size cap: 50 MB general (env `MAX_UPLOAD_SIZE_MB`); audio hard-capped at 25 MB.
Returns 413 when exceeded; 415 for unsupported types.

### Intake 202 response (all intake endpoints)

```json
{"run_id": "01HXYZ...", "status": "queued", "created_at": "2026-05-04T10:00:00+00:00"}
```

`status` may be `"pending_approval"` when `inbox_require_approval` is enabled.

### `GET /api/intake/status/{run_id}` — response

```json
{"status": "completed", "error_message": null, "created_at": "2026-05-04T10:00:00+00:00"}
```

Status values: `queued`, `processing`, `completed`, `failed`, `pending_approval`, `rejected`.

### Curl example

```bash
RUN_ID=$(curl -s -X POST http://localhost:8910/api/intake/note \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "My note", "tags": ["test"]}' | jq -r .run_id)

curl -s "http://localhost:8910/api/intake/status/$RUN_ID" \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" | jq .status
```

---

## Search

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/search` | Full-text, semantic, or hybrid search |
| `GET` | `/api/search/suggest` | Autocomplete prefix suggestions |

### `GET /api/search` — query parameters

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `q` | string | required | Query string; 400 if empty |
| `type` | `fts\|semantic\|hybrid` | `fts` | Search mode |
| `semantic` | bool | `false` | Legacy alias for `type=semantic` |
| `limit` | int | 20 | 1–200 |
| `cursor` | string | null | Opaque offset cursor |

**FTS mode**: BM25-ranked SQLite FTS5 results. Response items include `id`, `title`, `artifact_type`, `workspace`, `file_path`, `snippet`, `rank`.

**Semantic mode**: Embeds `q` via LLM, ranks by cosine similarity. Response items include `artifact_id`, `similarity_score`, `title`, `artifact_type`. Degrades to empty 200 when no embeddings exist.

**Hybrid mode**: Runs both, normalises scores to [0,1], combines with `combined = 0.6*vector + 0.4*fts` (vector weight configurable via `PORTAL_HYBRID_WEIGHT_VECTOR`). Response items include `artifact_id`, `title`, `artifact_type`, `fts_score`, `vector_score`, `combined_score`.

All modes return `ServiceModeEnvelope`. Pagination uses offset cursor (not keyset-stable across new ingests).

### `GET /api/search/suggest` — response (plain list, no envelope)

```json
[
  {"id": "01HXYZ...", "title": "Concept Title", "artifact_type": "concept", "workspace": "library", "file_path": "wiki/concepts/..."}
]
```

Params: `q` (required, prefix), `limit` (1–50, default 10).

### Curl example

```bash
curl -s "http://localhost:8910/api/search?q=kubernetes&type=hybrid&limit=3" \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  | jq '.data[] | {id:.artifact_id, score:.combined_score}'
```

---

## Workflows

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/workflows/templates` | List registered workflow templates |
| `POST` | `/api/workflows/synthesize` | Enqueue research synthesis run |
| `GET` | `/api/workflows/runs` | Cursor-paginated run list |
| `GET` | `/api/workflows/{run_id}` | Single run metadata |
| `GET` | `/api/workflows/{run_id}/timeline` | Stage-by-stage event timeline |
| `POST` | `/api/workflows/{run_id}/pause` | Pause running workflow (operator gate) |
| `POST` | `/api/workflows/{run_id}/resume` | Resume paused workflow (operator gate) |
| `POST` | `/api/workflows/{run_id}/cancel` | Cancel run (operator gate) |
| `GET` | `/api/workflows/{run_id}/stream` | SSE real-time event stream |

Operator control endpoints (`pause`, `resume`, `cancel`) require `PORTAL_ENABLE_OPERATOR_CONTROL=1`; return 404 when disabled.

### `POST /api/workflows/synthesize` — request / response

```json
// request
{"scope": "research", "template_id": "research_synthesis_v1"}

// response — 202
{"run_id": "01HXYZ..."}
```

### `GET /api/workflows/runs` — query parameters

`template_id`, `status`, `workspace`, `artifact_id`, `cursor`, `limit`.

### Run detail response shape

```json
{
  "run_id": "01HXYZ...",
  "template_id": "research_synthesis_v1",
  "status": "completed",
  "workspace": "research",
  "artifact_id": "01HABC...",
  "artifact_title": "Synthesis Title",
  "created_at": "...",
  "completed_at": "..."
}
```

### `GET /api/workflows/{run_id}/timeline` — response

```json
{"data": [{"event_type": "stage_started", "stage_name": "extract", "timestamp": "...", "duration_ms": 412}]}
```

### SSE stream — `GET /api/workflows/{run_id}/stream`

Event format per frame:

```
id: 42
data: {"id": "42", "type": "stage_started", "run_id": "01HXYZ...", "stage": "compile", "timestamp": "..."}

```

Phases: replay existing events, then live tail. Buffers up to 100 ms; flushes immediately on terminal events.

### Curl example

```bash
curl -s http://localhost:8910/api/workflows/runs?limit=5 \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" | jq '.data[] | {id:.run_id, status:.status}'
```

---

## Workflow Templates

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/workflow-templates` | List templates (`?scope=all\|custom\|system`) |
| `POST` | `/api/workflow-templates` | Create custom template |
| `PATCH` | `/api/workflow-templates/{id}` | Update yaml_content or description (system templates: 403) |
| `DELETE` | `/api/workflow-templates/{id}` | Remove template — 204 (system templates: 403) |
| `GET` | `/api/workflow-templates/{id}/history` | Paginated version history |

### `POST /api/workflow-templates` — request

```json
{
  "slug": "my_template_v1",
  "label": "My Template",
  "description": "Optional description",
  "yaml_content": "stages:\n  - extract\n  - compile\n"
}
```

YAML is validated as parseable before write. Returns 409 on duplicate slug.

### Template history response

```json
{"data": [{"version_sha": "abc123", "created_at": "...", "summary": "initial"}], "cursor": null}
```

---

## Research Workspace

All endpoints require auth. Optional filters: `artifact_type`, `workspace`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/artifacts/research/freshness-status` | Freshness status for research artifacts |
| `GET` | `/api/research/workspace-health` | Workspace health metrics summary |
| `GET` | `/api/research/priority-topics` | Priority-ranked topics with recent activity |
| `GET` | `/api/research/featured-topics` | Activity-ranked featured/pinned topics |
| `GET` | `/api/research/evidence-pulse/new` | New evidence with trend data |
| `GET` | `/api/research/evidence-pulse/contradictions` | Contradiction pairs and analysis |
| `GET` | `/api/research/synthesis-narrative` | Corpus narrative summary with key findings |
| `GET` | `/api/research/cross-entity-synthesis` | Cross-entity synthesis groups and relationships |
| `GET` | `/api/research/recent-syntheses` | Recent synthesis artifacts with metadata |

### `GET /api/artifacts/research/freshness-status` — params / response

Params: `artifact_type`, `workspace`, `limit` (1–100, default 50), `cursor`.

```json
{
  "data": [{"artifact_id": "01HXYZ...", "title": "...", "freshness_class": "stale", "updated_at": "..."}],
  "cursor": null,
  "etag": "W/\"abc\""
}
```

### Curl example

```bash
curl -s "http://localhost:8910/api/research/workspace-health" \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" | jq .
```

---

## Blog

| Method | Path | Status | Purpose |
|--------|------|--------|---------|
| `POST` | `/api/blog/posts` | 201 | Create draft post |
| `GET` | `/api/blog/posts` | 200 | List posts (`?status=draft\|published\|archived`) |
| `GET` | `/api/blog/posts/{id}` | 200 | Post detail |
| `PATCH` | `/api/blog/posts/{id}` | 202 | Update draft title/content |
| `POST` | `/api/blog/posts/{id}/publish` | 200 | Transition draft → published |
| `POST` | `/api/blog/posts/{id}/archive` | 200 | Transition any state → archived |

### `POST /api/blog/posts` — request

```json
{"title": "Post Title", "content": "Markdown body...", "tags": ["optional"]}
```

All vault writes go through EngineAdapter (PORTAL-001). Returns `BlogPostDTO`.

### `GET /api/blog/posts` — query parameters

`status` (optional), `limit`, `cursor`. Returns `ServiceModeEnvelope[BlogPostDTO]`.

### Curl example

```bash
curl -s -X POST http://localhost:8910/api/blog/posts \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Draft Post", "content": "## Hello\n\nContent here."}' | jq .id
```

---

## Topics

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/topics` | List topics with optional filters and priority scores |

Params: `workspace`, `tag[]`, `limit`, `cursor`. Returns `ServiceModeEnvelope`.

---

## Context Packs (Portal v2)

| Method | Path | Status | Purpose |
|--------|------|--------|---------|
| `POST` | `/api/projects/` | 201 | Create context pack |
| `GET` | `/api/projects/` | 200 | List packs (`?include_archived=false&limit=&cursor=`) |
| `GET` | `/api/projects/{pack_id}` | 200 | Pack detail |
| `PATCH` | `/api/projects/{pack_id}` | 200 | Update name, description, or artifact_ids |
| `DELETE` | `/api/projects/{pack_id}` | 204 | Delete pack |
| `GET` | `/api/projects/{pack_id}/versions` | 200 | Version history |

### `POST /api/projects/` — request / response

```json
// request
{"name": "Kubernetes Research Pack", "description": "Optional", "artifact_ids": ["01HXYZ...", "01HABC..."]}

// response — 201
{"pack_id": "01HDEF..."}
```

Returns 409 on duplicate name; 422 when any artifact_id does not exist.

### `PATCH /api/projects/{pack_id}` — request (at least one field required)

```json
{"name": "Updated Name", "description": null, "artifact_ids": ["01HXYZ..."]}
```

Returns updated `ContextPackDTO`. Setting `description` to `null` clears it.

### `GET /api/projects/{pack_id}/versions` — response

```json
{
  "data": [{"version_id": "01HGHI...", "artifact_ids": ["01HXYZ..."], "created_at": "..."}],
  "cursor": null,
  "etag": "W/\"abc\""
}
```

### Curl example

```bash
PACK_ID=$(curl -s -X POST http://localhost:8910/api/projects/ \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Pack", "artifact_ids": ["01HXYZ..."]}' | jq -r .pack_id)

curl -s "http://localhost:8910/api/projects/$PACK_ID" \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" | jq '{name:.name, count:(.artifact_ids|length)}'
```

---

## Error Codes Reference

| HTTP | Code | Trigger |
|------|------|---------|
| 400 | `bad_request` | Empty `q`, malformed cursor, invalid param |
| 400 | `invalid_cursor` | Corrupted cursor value |
| 404 | `not_found` | Resource not found in Postgres overlay |
| 404 | `inbox_not_configured` | `POST /api/admin/inbox/scan` — no inbox dir |
| 409 | `duplicate_name` | Context pack or template slug already exists |
| 413 | `payload_too_large` | Upload exceeds size cap |
| 415 | `unsupported_media_type` | Upload extension not allowed |
| 422 | `invalid_artifact_ids` | Referenced artifact IDs do not exist |
| 422 | `validation_error` | Pydantic field validation failure |
| 503 | `reconciler_unavailable` | Reconciler not wired or vault inaccessible |
| 503 | `reconcile_failed` | Engine error during reconcile run |

## Environment Variables (Portal Runtime)

| Variable | Default | Effect |
|----------|---------|--------|
| `MEATYWIKI_PORTAL_TOKEN` | required | Bearer token for all `/api/*` routes |
| `PORTAL_DISABLE_AUTH` | `0` | Set `1` to skip auth (dev only) |
| `PORTAL_ALLOW_NETWORK` | `0` | Set `1` to bind to non-loopback addresses |
| `PORTAL_AUTO_COMPILE` | `true` | Auto-compile after intake |
| `PORTAL_INBOX_DIR` | unset | Drop-in file intake directory |
| `PORTAL_INBOX_REQUIRE_APPROVAL` | `false` | Gate inbox files behind approval |
| `PORTAL_ENABLE_OPERATOR_CONTROL` | `0` | Enable pause/resume/cancel workflow endpoints |
| `PORTAL_HYBRID_WEIGHT_VECTOR` | `0.6` | Hybrid search vector weight (0–1) |
| `MAX_UPLOAD_SIZE_MB` | `50` | General upload size cap |
| `MEATYWIKI_VAULT_ROOT` | required | Absolute path to Obsidian vault |
