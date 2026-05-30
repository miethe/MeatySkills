---
name: ccdash
description: Answer CCDash project-intelligence questions using the shipped MCP tools when available and the in-repo `ccdash` CLI otherwise. Use when the operator or another agent asks about project status, feature forensics, workflow failure patterns, after-action reports, artifact intelligence, live agent counts, system metrics, runtime validation posture, CLI timeout or caching behavior, project registration, or how to troubleshoot the shipped CCDash API/worker/MCP surfaces. Keep routing aligned with the current shipped runtime contract and repo docs.
version: 2.2
app_version: "2026-05-29"
updated: 2026-05-29
---

# ccdash Skill

Route CCDash questions to the shipped agent-facing surfaces that exist in this repo today:

- MCP stdio server via [`.mcp.json`](/Users/miethe/dev/homelab/development/CCDash/.mcp.json)
- In-repo `ccdash` CLI (`status`, `feature`, `workflow`, `report`)
- Standalone CLI (`ccdash-cli` package, HTTP transport to remote server)
- Runtime-validation docs for API health and worker probes

The business logic is transport-neutral. CLI and MCP are adapters over `backend/application/services/agent_queries/`.

## When To Use

Trigger on intents such as:

- "What's the state of this project?" / "project status" / "project summary"
- "Why did FEAT-X take so long?" / "retrospective on FEAT-X" / "AAR for FEAT-X"
- "Which workflows are failing?" / "failure burden" / "workflow diagnostics"
- "Show me the feature forensics for FEAT-X" / "list features matching X"
- "Is the hosted runtime healthy?" / "how do I validate API vs worker?" / "which probe should I hit?"
- "Is the MCP server shipped here?" / "should I use MCP or CLI for this?"
- "Why is my CLI timing out?" / "results look stale"

## When NOT To Use

- General coding tasks unrelated to CCDash observability or runtime posture.
- Session-level drilldowns or transcript search through the in-repo CLI. That surface is standalone-CLI only (`ccdash session search`).
- Inventing runtime behaviors that contradict the split API/worker contract.

## Confidence Anchor

Repo-verified current surfaces (as of `app_version: 2026-05-29`):

**In-repo CLI groups** (`backend/.venv/bin/ccdash`; registered in `backend/cli/main.py`):
- `ccdash status project`
- `ccdash feature report <feature_id>`
- `ccdash workflow failures`
- `ccdash report aar --feature <feature_id>`
- `ccdash artifact rankings` / `ccdash artifact recommendations`
- `ccdash live active-count`
- `ccdash system active-count`

Global flags (all in-repo commands): `--timeout N`, `--no-cache`, `--json`, `--md`

**Standalone-CLI-only groups** (not available in the in-repo CLI): `session`, `target`, `doctor`, `project`

**MCP tools** (7 registered in `backend/mcp/tools/__init__.py`):
`ccdash_project_status`, `ccdash_feature_forensics`, `ccdash_workflow_failure_patterns`, `ccdash_generate_aar`, `artifact_recommendations`, `ccdash_live_active_count`, `ccdash_system_active_count`

Note: `artifact_recommendations` has no `ccdash_` prefix — do not normalize this name.

**Runtime entrypoints**: hosted API via `backend.runtime.bootstrap_api:app`; worker via `python -m backend.worker`

## Routing Posture

Use the following transport order:

1. **Prefer MCP for in-workspace agent reasoning** when the repo `.mcp.json` is present and the question maps cleanly to one of the four shipped tools. This avoids shelling out and matches the current Claude Code posture.
2. **Use the in-repo CLI as the fallback adapter** when MCP is unavailable, when you need explicit output modes, or when validating parity against the command surface.
3. **Use the standalone CLI** when the user is operating against a remote CCDash server rather than local data. See [Standalone CLI vs In-Repo CLI](#standalone-cli-vs-in-repo-cli) below.
4. **Use runtime docs and HTTP probes for deployment/runtime troubleshooting.** Do not invent CLI transport-management commands that are not shipped.

Current shipped posture: MCP is discoverable, but not the only path. CLI remains valid. Runtime validation is a separate concern handled through the API/worker contract.

## Standalone CLI vs In-Repo CLI

| Dimension | In-Repo CLI | Standalone CLI |
|---|---|---|
| Install | `backend/.venv/bin/ccdash` | `pipx install ccdash-cli` → `ccdash` |
| Transport | Local data / lightweight bootstrap | HTTP to remote CCDash server (`/api/v1/`) |
| Auth | None | Bearer token via OS keyring or `CCDASH_TOKEN` |
| Config | None | `~/.config/ccdash/config.toml` (named targets) |
| Command groups | `status`, `feature`, `workflow`, `report`, `artifact`, `live`, `system` | `status`, `feature`, `workflow`, `report`, `project`, `session`, `target`, `doctor`, `version` |
| Use when | Querying local project data | Operating against hosted/remote server |

**Do not** suggest `target`, `doctor`, `target login`, `session`, or `project` commands to a user running only the in-repo CLI. These exist only in the standalone CLI.

## Query Caching

All four query services (project-status, feature-forensics, workflow-diagnostics, aar-report) use an in-process TTL cache:

| Config | Default | Effect |
|---|---|---|
| `CCDASH_QUERY_CACHE_TTL_SECONDS` | 60 | Cache lifetime; set to 0 to disable |
| `CCDASH_QUERY_CACHE_REFRESH_INTERVAL_SECONDS` | 300 | Background warming interval; 0 disables |
| `--no-cache` CLI flag | off | Force cache miss for one invocation |
| `bypass_cache=true` query param | off | Force cache miss via HTTP |

**Guidance**: Use `--no-cache` when debugging stale data. Do not disable the cache in production — background warming reduces cold-path latency. OpenTelemetry counters are emitted per cache event.

## CLI Timeout

The standalone CLI exposes a global timeout on every command:

| Config | Default | Notes |
|---|---|---|
| `--timeout N` flag | 30s | Precedence: flag > env > default |
| `CCDASH_TIMEOUT` env var | 30s | Applied when flag is absent |

Commands that can be slow on large projects: `status project`, `report aar`, `workflow failures`. Consider `--timeout 60` or higher when these time out. See `/Users/miethe/dev/homelab/development/CCDash/docs/guides/cli-timeout-debugging.md` for diagnosis patterns.

## Routing Table

| Intent | Preferred MCP Tool | In-Repo CLI Fallback | Notes |
|---|---|---|---|
| Project status | `ccdash_project_status` | `ccdash status project` | Use MCP first for agent reasoning; CLI `--json`/`--md` modes useful |
| Feature forensics | `ccdash_feature_forensics` | `ccdash feature report FEATURE_ID` | Top-level `name`, `status`, `telemetry_available`, `sessions_note` fields available |
| Feature listing | `ccdash_feature_forensics` (list mode) | *(standalone only)* `ccdash feature list` | Paginated; max 200 results; `truncated`/`total` in response |
| Feature sessions | none | *(standalone only)* `ccdash feature sessions FEATURE_ID` | Canonical fresh-sessions surface; prefer over `feature show`'s `linked_sessions` |
| Workflow failures | `ccdash_workflow_failure_patterns` | `ccdash workflow failures` | Same query service behind both surfaces |
| AAR / retrospective | `ccdash_generate_aar` | `ccdash report aar --feature FEATURE_ID` | Render markdown/human output as requested |
| Artifact rankings | none | `ccdash artifact rankings` | In-repo only; no standalone-CLI equivalent yet |
| Artifact recommendations | `artifact_recommendations` | `ccdash artifact recommendations` | In-repo and MCP; no standalone-CLI equivalent yet |
| Live active count | `ccdash_live_active_count` | `ccdash live active-count` | In-repo and MCP; no standalone-CLI equivalent yet |
| System active count | `ccdash_system_active_count` | `ccdash system active-count` | In-repo and MCP; no standalone-CLI equivalent yet |
| Project registration | none | *(standalone only)* `ccdash project add \| list \| use` | Registers projects against a named target via `/api/projects` |
| Runtime validation | none | none | Route to `/api/health`, worker probes, and runbook docs |
| MCP setup/troubleshooting | shipped stdio server | CLI parity checks only | Follow `docs/guides/mcp-setup-guide.md` and `docs/guides/mcp-troubleshooting.md` |

## Runtime Contract

Hosted validation assumes a split runtime:

- API runtime serves HTTP and canonical reads.
- Worker runtime owns sync, refresh, and scheduled jobs.
- `local` is a convenience runtime and is not the hosted validation posture.
- `test` is for lightweight CLI/MCP bootstrap and automated coverage.

Canonical hosted entrypoints:

```bash
backend/.venv/bin/python -m uvicorn backend.runtime.bootstrap_api:app --host 0.0.0.0 --port 8000
backend/.venv/bin/python -m backend.worker
```

Local helpers like `npm run dev:backend` and `npm run start:worker` are wrappers around the same contract; the bootstrap modules are the canonical reference.

**Containerized deployment**: Docker/Podman compose profiles (`local`, `enterprise`, `postgres`) are supported. Rootless Podman is supported. Single-command deployment via `docker compose` or `podman-compose`. Reference: `/Users/miethe/dev/homelab/development/CCDash/docs/guides/containerized-deployment-quickstart.md`.

## Probe Semantics

- `GET /api/health` — primary API/runtime contract check.
- Worker probe: `CCDASH_WORKER_PROBE_HOST:CCDASH_WORKER_PROBE_PORT` (default `127.0.0.1:9465`).
  - `/livez` — basic process liveness
  - `/readyz` — readiness after worker binding contract is satisfied
  - `/detailz` — backlog/freshness detail and worker posture

A healthy API does not prove worker ownership is functioning; a ready worker does not replace the API health contract.

## Lightweight Bootstrap Invariant

CLI and MCP use lightweight `test`-profile bootstrap paths. They do not stand up the full hosted runtime and do not own background jobs.

- CLI bootstrap: `backend/cli/runtime.py`
- MCP bootstrap: `backend/mcp/bootstrap.py`
- MCP transport: stdio via [`.mcp.json`](/Users/miethe/dev/homelab/development/CCDash/.mcp.json)

Do not claim that CLI or MCP validates the hosted deployment by themselves.

## Output Guidance

- For agent reasoning: prefer structured MCP responses or CLI `--json`.
- For user-facing narrative deliverables: use CLI `--md` where available, especially `report aar`.
- For runtime validation: summarize relevant health/probe fields rather than dumping the entire payload unless the user asks for raw output.

## Multi-Step Flows (Recipes)

- `recipes/feature-retrospective.md` — feature forensics + AAR with MCP-first/CLI-fallback posture.
- `recipes/task-attribution.md` — infer work ownership from feature forensics and evidence rather than stale task/session commands.
- `recipes/unreachable-server.md` — troubleshoot the API/worker/MCP runtime contract and probe semantics.

Prefer a recipe whenever the user's question spans transport choice plus interpretation.

## Do Not Say

- "MCP is deferred until a later phase."
- "Use `ccdash doctor` / `ccdash target show` / `ccdash target login`." (standalone CLI only — not available in the in-repo CLI)
- "Hosted validation should run against `backend.main:app` or `npm run dev`."
- "CLI or MCP starts the full runtime or proves worker ownership on its own."
- "The CLI has no timeout configuration." (it does: `--timeout` flag and `CCDASH_TIMEOUT` env var)
- "Query results are always fresh." (they are cached; use `--no-cache` to bypass)

## Key References

- `/Users/miethe/dev/homelab/development/CCDash/docs/guides/enterprise-session-intelligence-runbook.md`
- `/Users/miethe/dev/homelab/development/CCDash/docs/setup-user-guide.md`
- `/Users/miethe/dev/homelab/development/CCDash/docs/guides/mcp-setup-guide.md`
- `/Users/miethe/dev/homelab/development/CCDash/docs/guides/mcp-troubleshooting.md`
- `/Users/miethe/dev/homelab/development/CCDash/docs/guides/cli-timeout-debugging.md`
- `/Users/miethe/dev/homelab/development/CCDash/docs/guides/query-cache-tuning-guide.md`
- `/Users/miethe/dev/homelab/development/CCDash/docs/guides/standalone-cli-guide.md`
- `/Users/miethe/dev/homelab/development/CCDash/docs/guides/containerized-deployment-quickstart.md`
- `/Users/miethe/dev/homelab/development/CCDash/backend/cli/main.py`
- `/Users/miethe/dev/homelab/development/CCDash/backend/mcp/server.py`
- `/Users/miethe/dev/homelab/development/CCDash/packages/ccdash_cli/`
