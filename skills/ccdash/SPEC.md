---
schema_version: 2
doc_type: skill_spec
skill_name: ccdash
skill_version: 2.2.0
status: active
created: 2026-05-29
updated: 2026-05-29
owner: nick
source_docs:
  - backend/mcp/tools/__init__.py
  - backend/cli/main.py
  - packages/ccdash_cli/src/ccdash_cli/main.py
  - backend/application/services/agent_queries/
related_skills: [artifact-tracking, dev-execution, changelog-sync]
affects_commands: []
---

<!-- Convention reference: MeatySkills/skills/release/SPEC.md -->

# ccdash — Skill Specification

> **Reading this file**: This is the versioned capability contract for the `ccdash` skill.
> For invocation-time routing, see `SKILL.md` in this same directory.
> For per-surface command syntax, see the `references/` docs.

---

## 1. Purpose & Scope

**Mission**: Route agent and operator questions about CCDash project intelligence to the correct transport surface — MCP tool, in-repo CLI, or standalone CLI — and provide accurate, non-phantom command references so agents never invoke commands that do not exist.

The `ccdash` skill bridges CCDash's three agent-facing transport surfaces (MCP stdio server, in-repo Typer CLI, standalone HTTP CLI) into a single routing layer. It is not a wrapper around a single script; it is a routing contract that must stay aligned with the shipped runtime. The skill's primary failure mode is phantom-command drift — claiming a CLI group or MCP tool exists when it does not, or tagging a standalone-only command as available in the in-repo CLI.

**In scope**:
- Routing project-status, feature-forensics, workflow-diagnostics, AAR, artifact-intelligence, live-metrics, and system-metrics queries to the correct transport
- Maintaining accurate `transport` tags on every intent in `router-table.json`
- Distinguishing in-repo CLI groups (backed by `backend/cli/main.py`) from standalone-CLI-only groups (backed by `packages/ccdash_cli/src/ccdash_cli/main.py`)
- Surface-level runtime validation posture (API health probes, worker probes)
- Project registration and target management via standalone CLI

**Out of scope**:
- CCDash application logic, backend routing, or database access
- Session transcript storage or parsing (those are app concerns, not skill concerns)
- Managing or modifying the CCDash runtime itself
- Any query surface not yet shipped in the app (`n/a` entries in the Capability Matrix)

---

## 2. Capability Coverage

### 2.1 Capability Matrix

| Capability | MCP Tool | In-Repo CLI | Standalone CLI | REST Endpoint |
|---|---|---|---|---|
| Project status snapshot | `ccdash_project_status` | `ccdash status project` | `ccdash status project` | `GET /api/agent/project-status` |
| Feature forensics (single feature) | `ccdash_feature_forensics` | `ccdash feature report <id>` | `ccdash feature show <id>` | `GET /api/agent/feature/{id}` |
| Feature list (paginated) | `ccdash_feature_forensics` (list mode) | — | `ccdash feature list` | `GET /api/agent/features` |
| Feature sessions | — | — | `ccdash feature sessions <id>` | `GET /api/agent/feature/{id}/sessions` |
| Feature documents | — | — | `ccdash feature documents <id>` | `GET /api/agent/feature/{id}/documents` |
| Workflow failure patterns | `ccdash_workflow_failure_patterns` | `ccdash workflow failures` | `ccdash workflow failures` | `GET /api/agent/workflow-failures` |
| After-action report (AAR) | `ccdash_generate_aar` | `ccdash report aar --feature <id>` | `ccdash report aar --feature <id>` | `GET /api/agent/aar/{id}` |
| Artifact rankings | — | `ccdash artifact rankings` | — | `GET /api/agent/artifact-rankings` |
| Artifact recommendations | `artifact_recommendations` | `ccdash artifact recommendations` | — | `GET /api/agent/artifact-recommendations` |
| Live active agent count | `ccdash_live_active_count` | `ccdash live active-count` | — | `GET /api/agent/live/active-count` |
| System-wide active count | `ccdash_system_active_count` | `ccdash system active-count` | — | `GET /api/agent/system/active-count` |
| Project registration | — | — | `ccdash project add \| list \| use` | `POST/GET /api/projects` |
| Target management | — | — | `ccdash target list \| add \| show \| use \| remove \| login \| logout \| check` | n/a |
| Runtime diagnostics | — | — | `ccdash doctor` | `GET /api/health` |
| Session search and drilldown | — | — | `ccdash session list \| show \| search \| drilldown \| family` | `GET /api/agent/sessions` |
| CLI version | — | — | `ccdash version` | n/a |

**Transport legend**:
- `mcp` — reachable as a FastMCP stdio tool via `.mcp.json`
- `in-repo-cli` — registered in `backend/cli/main.py`; available as `backend/.venv/bin/ccdash`
- `standalone-cli` — registered in `packages/ccdash_cli/src/ccdash_cli/main.py`; installed via `pipx install ccdash-cli`
- `—` in a transport column means the capability is **not available** through that transport

### 2.2 MCP Tools (7 registered)

All tools registered in `backend/mcp/tools/__init__.py` via `register_tools()`:

| Tool Name | Module | Purpose |
|---|---|---|
| `ccdash_project_status` | `backend/mcp/tools/project.py` | Project status snapshot |
| `ccdash_feature_forensics` | `backend/mcp/tools/features.py` | Feature forensics and feature listing |
| `ccdash_workflow_failure_patterns` | `backend/mcp/tools/workflows.py` | Workflow diagnostics |
| `ccdash_generate_aar` | `backend/mcp/tools/reports.py` | After-action report generation |
| `artifact_recommendations` | `backend/mcp/tools/artifacts.py` | Artifact optimization recommendations |
| `ccdash_live_active_count` | `backend/mcp/tools/live.py` | Live active agent count |
| `ccdash_system_active_count` | `backend/mcp/tools/system.py` | System-wide active session count |

Note: `artifact_recommendations` does not carry the `ccdash_` prefix — this is intentional. Do not normalize the name.

### 2.3 In-Repo CLI Groups (7 registered)

All groups registered in `backend/cli/main.py` via `app.add_typer()`:

| Group | Subcommand(s) | Purpose |
|---|---|---|
| `status` | `project` | Project status snapshot |
| `feature` | `report` | Feature forensics (single feature only; `list/show/sessions/documents` are standalone-CLI-only) |
| `workflow` | `failures` | Workflow diagnostics |
| `report` | `aar` | After-action report |
| `artifact` | `rankings`, `recommendations` | Artifact intelligence |
| `live` | `active-count` | Live active agent count |
| `system` | `active-count` | System-wide active count |

### 2.4 Standalone CLI Groups

All groups registered in `packages/ccdash_cli/src/ccdash_cli/main.py`:

| Group | Subcommand(s) | Purpose |
|---|---|---|
| `target` | `list`, `add`, `show`, `use`, `remove`, `set-token`, `login`, `logout`, `check` | Named server target management |
| `doctor` | (invoked as group with no subcommand) | Connectivity and auth diagnostics |
| `status` | `project` | Project status snapshot (same as in-repo) |
| `workflow` | `failures` | Workflow diagnostics (same as in-repo) |
| `feature` | `list`, `show`, `sessions`, `documents` | Feature investigation (richer surface than in-repo) |
| `project` | `add` (alias `init`), `list`, `use` | Project registration against a target |
| `report` | `aar` | After-action report (same as in-repo) |
| `session` | `list`, `show`, `search`, `drilldown`, `family` | Session intelligence and transcript search |
| `version` | (top-level command, not a group) | Print CLI version |

---

## 3. Invariants & Constraints

1. **router-table.json is the routing source of truth**: Every intent entry in `scripts/router-table.json` must carry a `transport` array. Update `router-table.json` and `CHANGELOG.md` whenever the query surface changes (new tool registered, CLI group added, command removed). A missing or wrong `transport` tag is a phantom-command defect.

2. **Keep aligned with shipped runtime**: Skill claims must not outpace or lag the app by more than one shipped version. Verify against `backend/mcp/tools/__init__.py` (MCP tools) and `backend/cli/main.py` (in-repo CLI groups) before editing the Capability Matrix or Confidence Anchor. Verification command: `grep -n "mcp.tool\|add_typer" backend/mcp/tools/*.py backend/cli/main.py`.

3. **In-repo vs standalone CLI distinction is non-negotiable**: The in-repo CLI (`backend/.venv/bin/ccdash`) and the standalone CLI (`pipx install ccdash-cli`) are different programs with different command surfaces. Never tag a standalone-only group (`session`, `target`, `doctor`, `project`) as available in-repo. Never tag an in-repo-only group (`artifact`, `live`, `system`) as available standalone. Trace every command assertion to its registration file before assigning a transport tag.

4. **Seven MCP tools, seven in-repo CLI groups**: As of `app_version: 2026-05-29`, the canonical counts are 7 MCP tools and 7 in-repo CLI groups. When these counts change, bump `skill_version`, update `SKILL.md` Confidence Anchor, update the Capability Matrix, and add a `CHANGELOG.md` entry.

5. **Capability Matrix is the single source of transport truth**: An agent reading this file should be able to determine whether a capability is reachable via MCP, in-repo CLI, standalone CLI, or REST without reading any other file. The `router-table.json` provides intent-based routing; this matrix provides surface-level enumeration. Both must stay consistent.

6. **Reference docs are surface-assertion docs, not narrative rewrites**: When a capability ships or changes, update only the factually wrong lines in `references/` (command signatures, availability claims). Do not restructure reference doc narrative sections under this constraint.

7. **No new dependencies**: The skill is documentation and routing logic only. It must not require external tools, libraries, or API keys to function.

---

## 4. Enhancement Backlog

- **[BL-1] Artifact group in standalone CLI**: The `artifact` command group (`ccdash artifact rankings`, `ccdash artifact recommendations`) exists in-repo only. A future version of the standalone CLI should expose these surfaces via `GET /api/agent/artifact-rankings` and `GET /api/agent/artifact-recommendations`. Until then, the Capability Matrix shows `—` in the Standalone CLI column for these rows.
  _Status_: deferred (pending standalone CLI surface update)

- **[BL-2] Live and system groups in standalone CLI**: `ccdash live active-count` and `ccdash system active-count` are in-repo-only. A future standalone release should expose these via the `/api/agent/live` and `/api/agent/system` REST endpoints.
  _Status_: deferred (pending standalone CLI surface update)

- **[BL-3] Preflight skill-drift check**: A CI-runnable script that diffs `backend/mcp/tools/__init__.py` MCP tool names and `backend/cli/main.py` `add_typer` groups against the Confidence Anchor in `SKILL.md` and the Capability Matrix in `SPEC.md`. Should exit non-zero on any mismatch, preventing phantom-command drift from landing undetected.
  _Status_: deferred (no blocking dependency; low implementation effort)

- **[BL-4] Standalone CLI `diagnostics` group**: The contract `ccdash-cli-project-init` references a `diagnostics` group as planned standalone surface; it was not present at the time of this refresh. If it ships, add it to the Capability Matrix and `router-table.json` with `transport: ["standalone-cli"]`.
  _Status_: pending (tracking via `ccdash-cli-project-init` contract)

---

## 5. Changelog

### v2.2.0 — 2026-05-29
- SPEC.md authored (this file): full capability matrix, MCP tool inventory, in-repo and standalone CLI group tables, 7 invariants, 4 enhancement backlog items
- Aligned with shipped `app_version: 2026-05-29` which includes 7 MCP tools (added `artifact_recommendations`, `ccdash_live_active_count`, `ccdash_system_active_count`) and 7 in-repo CLI groups (added `artifact`, `live`, `system`)
- `project` standalone CLI group documented (ships in commit 5f7fbfc; subcommands: `add`/`init`, `list`, `use`)
- Phantom-command corrections: `feature list/show/sessions/documents` are standalone-CLI-only and must not be tagged as `in-repo-cli`

---

## 6. Integration Points

| Agent / Skill | Invocation Pattern | Notes |
|---|---|---|
| Claude Code agents | `Skill("ccdash")` | Loaded when routing project-intelligence questions |
| `artifact-tracking` | co-loaded | Tracks skill artifact files; validates frontmatter |
| `dev-execution` | n/a | Skill does not own implementation phases |
| MCP client (`.mcp.json`) | stdio | CCDash MCP server exposes all 7 tools |

**Key runtime files**:
- `backend/mcp/tools/__init__.py` — canonical MCP tool registration (`register_tools()`)
- `backend/cli/main.py` — canonical in-repo CLI group registration (`app.add_typer()`)
- `packages/ccdash_cli/src/ccdash_cli/main.py` — canonical standalone CLI group registration
- `backend/application/services/agent_queries/` — transport-neutral query services behind all surfaces

---

## 7. Success Signals

- Agents route project-status, feature-forensics, and workflow-diagnostics queries to MCP tools first, falling back to the in-repo CLI, without attempting standalone-only groups (`session`, `target`, `doctor`, `project`) against the in-repo runtime.
- No agent session transcript contains a `ccdash feature list` invocation attempt against the in-repo CLI (it does not exist there; only standalone has this command).
- The Capability Matrix in this file matches the tool count and CLI group count in `backend/mcp/tools/__init__.py` and `backend/cli/main.py` at every tagged skill version.
- `router-table.json` entries whose `transport` includes `in-repo-cli` can each be traced to a registered `app.add_typer()` group in `backend/cli/main.py`.
- Skill version bumps are accompanied by a `CHANGELOG.md` entry and updated `updated` / `skill_version` fields in this file and in `SKILL.md`.
