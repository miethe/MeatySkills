---
name: meatywiki-hook-policy
description: Policy for SAM/CCDash hooks in V1 — no-op stubs only; F1/F2 deferral boundaries; what agents must NOT do.
type: reference
skill_name: meatywiki
cli_version_range: "compilation-engine-v1 (pre-release)"
schema_version: 1
created: 2026-04-14
updated: 2026-04-14
---

# MeatyWiki Hook Policy

## 1. Purpose

This file governs agent behavior with respect to SAM (SkillMeat Artifact Manager) and CCDash
integration in the V1 compilation engine. V1 ships **no-op stubs only** — there is no runtime SAM
or CCDash integration to exercise, invoke, or configure. The hook interface exists in `hooks/`
solely to establish the integration boundary and log lifecycle intent via `structlog`.

Agents reading this file must not attempt to invoke SAM or CCDash APIs, write integration
namespace fields to vault frontmatter, or reference the `register` command as a runnable
operation. All F1 and F2 content in this file is documentation of what is deferred, not
instructions for how to proceed.

---

## 2. Policy at a Glance

| Rule | V1 behavior |
|---|---|
| Invoke `meatywiki register` command | Not available. `register` is `[deferred: F1]`. Do not reference it as runnable. |
| Write `skillmeat-type`, `skillmeat-version`, `skillmeat-id` to frontmatter | `[deferred: F1]` — never write these fields in V1. Doing so is a vault-drift violation. |
| Write `meatywiki-ccdash-feature-slug`, `meatywiki-ccdash-session-ref` to frontmatter | `[deferred: F2]` — never write these fields in V1. Doing so is a vault-drift violation. |
| Expect a SAM UUID on any artifact | `[deferred: F1]` — no UUID is assigned in V1. |
| Expect CCDash telemetry from any lifecycle event | `[deferred: F2]` — no HTTP calls or JSONL session writes are made in V1. |
| Ingest SAM artifacts, GitHub repos, or Claude Code configs as sources | `[deferred: F4]` — V1 supports knowledge-domain connectors only (Q1 resolved). Do not treat SkillMeat artifacts, Claude skills, agents, MCPs, hooks, or project configs as ingest sources. |
| Configure `hooks.sam.enabled: true` in `_meta/config.yaml` | Has no effect in V1. SAM hook is a stub regardless of this flag. |
| Configure `hooks.ccdash.enabled: true` in `_meta/config.yaml` | Has no effect in V1. CCDash hook is a stub regardless of this flag. |

---

## 3. V1 No-Op Stub Behavior

### 3.1 `hooks/sam.py`

**File location:** `src/meatywiki/hooks/sam.py`

**What the stub does:**
- Receives lifecycle events dispatched by the workflow engine.
- Emits a single `structlog` DEBUG entry per event, recording `event_name`, `artifact_id`,
  `lifecycle_stage`, and `run_id` — so that future F1 implementation can confirm the hook wiring
  is correct by inspecting logs.
- Returns immediately without modifying any state.

**What the stub does NOT do:**
- Makes no HTTP requests (no calls to SAM REST API).
- Writes no frontmatter fields to any vault file.
- Creates no database rows in any external or local table (`sam_registrations` table does not
  exist in V1).
- Does not populate `skillmeat-type`, `skillmeat-version`, or `skillmeat-id` on any artifact.

**Hook interface (defined in `hooks/base.py`, per FR-18):**

The stub implements the `LifecycleHook` interface declared in `hooks/base.py`. The lifecycle
events the SAM stub receives are:

| Event | Trigger |
|---|---|
| `on_artifact_create` | New artifact written to vault via `vault/writer.py` |
| `on_artifact_update` | Existing artifact frontmatter or body updated |
| `on_promote` | `meatywiki promote` advances an artifact's `lifecycle_stage` |
| `on_compile_complete` | `compile` workflow pipeline finishes a run |
| `on_ingest_complete` | `ingest` workflow pipeline finishes a run |

Interface names only — implementation body is stub (log + return).

**Disabling hooks:** Per A14, disabling hooks via config must not affect any pipeline output.
The stub is designed to be invisible to workflows: no output depends on hook execution, and agents
can safely treat `hooks/` as a black box in V1.

---

### 3.2 `hooks/ccdash.py`

**File location:** `src/meatywiki/hooks/ccdash.py`

**What the stub does:**
- Receives the same lifecycle events as `hooks/sam.py` (dispatched from `hooks/base.py`).
- Emits a single `structlog` DEBUG entry per event with `event_name`, `artifact_id`,
  `workflow_name`, and `run_id`.
- Returns immediately without modifying any state.

**What the stub does NOT do:**
- Makes no HTTP requests (no calls to `POST /api/features/execution-events` or any CCDash endpoint).
- Writes no JSONL session log files to any watch directory.
- Does not populate `meatywiki-ccdash-feature-slug` or `meatywiki-ccdash-session-ref` on any artifact.
- Does not write any fields to the CCDash `ccdash_document` v3 schema namespace.

**Hook interface:** Same `LifecycleHook` interface from `hooks/base.py` as `hooks/sam.py`.
Events received: `on_artifact_create`, `on_artifact_update`, `on_promote`,
`on_compile_complete`, `on_ingest_complete`.

**Disabling hooks:** Same rule as SAM stub — disabling has no observable effect on pipeline
output. Agents can ignore hook existence in V1.

---

## 4. SAM Integration: What Is Deferred

**[deferred: F1]**

> All content in this section describes future work. Nothing below is actionable in V1.

### F1 Trigger Conditions

F1 (SAM Integration Hook) does not begin until all of the following are true (per PRD §14):

- V1 stable for ≥30 days post-release.
- SAM ADR-011 (`subtype` field on context entities) reaches **Accepted** status.
- SAM enum extension PR for `knowledge_artifact` type is merged into SAM's artifact type registry.

### What F1 Will Implement (interface-level only)

- `hooks/sam.py`: real implementation replacing the V1 stub.
- Register compiled artifacts via `POST /artifacts` with `skillmeat-type: knowledge_artifact`.
- Version-sync on artifact update via `POST /versions/artifacts/{id}/sync-all`.
- `sam_registrations` table added to `_meta/meatywiki.db` — maps SAM-assigned UUID to MeatyWiki
  `artifact_id`.
- Write `skillmeat-type`, `skillmeat-version`, `skillmeat-id` to artifact frontmatter on
  create/promote (currently reserved fields — NOT written in V1).
- `meatywiki register` CLI command (currently deferred per Q7 resolution — not available in V1).

### Edge Type Mapping (F1 planning note)

MeatyWiki defines 7 edge types; SAM supports 3 (`requires`, `enables`, `related`). F1 will need
to document fidelity loss for the 5 edge types that collapse to `related`:

| MeatyWiki edge | SAM mapping | Fidelity |
|---|---|---|
| `derived_from` | `requires` | Preserved |
| `supports` | `enables` | Preserved |
| `relates_to` | `related` | Preserved |
| `supersedes` | `related` + metadata annotation | Partial loss |
| `contradicts` | `related` + metadata annotation | Partial loss |
| `contains` | `related` + metadata annotation | Partial loss |
| `generated_by` | `related` + metadata annotation | Partial loss |

This is why V1 does not attempt partial SAM writes — the mapping is lossy and requires SAM-side
edge type expansion to be resolved correctly.

### Where F1 Work Is Tracked

- Progress: `.claude/progress/meatywiki-sam-integration/` (directory to be created on F1 start).
- SPIKE findings: `docs/project_plans/llm_wiki/compilation-engine/SPIKEs/sam-integration-findings.md`
  and `sam-integration-field-mapping.md`.

---

## 5. CCDash Integration: What Is Deferred

**[deferred: F2]**

> All content in this section describes future work. Nothing below is actionable in V1.

### F2 Trigger Conditions

F2 (CCDash Telemetry Hook) does not begin until all of the following are true (per PRD §14):

- V1 stable.
- CCDash JSONL session parser accepts MeatyWiki workflow run format (may require a new platform
  parser in CCDash — this is a CCDash-side dependency).

### Scope of F2

F2 will emit MeatyWiki workflow telemetry so CCDash can correlate knowledge compilation
effectiveness with dev session effectiveness. The integration direction is:
MeatyWiki → CCDash (outbound only — CCDash has no inbound telemetry endpoint in its current form).

### Namespace Strategy

CCDash uses 62+ unprefixed frontmatter fields (confirmed by SPIKE session 2). To avoid
collision, any frontmatter fields MeatyWiki writes for CCDash correlation use the
`meatywiki-ccdash-*` prefix. This is the namespace isolation decision from spec §4.6.

The two reserved fields:
- `meatywiki-ccdash-feature-slug` — CCDash feature correlation identifier.
- `meatywiki-ccdash-session-ref` — CCDash session link for attribution.

These fields are RESERVED and must not be written by any V1 workflow, agent, or manual edit.

### What F2 Will Implement (interface-level only)

- `hooks/ccdash.py`: real implementation replacing the V1 stub.
- Filesystem-based session logging: JSONL files written to a CCDash watch directory, one MeatyWiki
  workflow run per session.
- Feature execution event emission: `POST /api/features/execution-events` for feature attribution.
- Write `meatywiki-ccdash-feature-slug` and `meatywiki-ccdash-session-ref` to relevant artifact
  frontmatter (currently reserved — NOT written in V1).

### Where F2 Work Is Tracked

- SPIKE findings: `docs/project_plans/llm_wiki/compilation-engine/SPIKEs/ccdash-integration-findings.md`
  and `ccdash-integration-field-mapping.md`.
- CCDash Phase 2 plans (external to this repo — CCDash project).

---

## 6. Namespace Reservation

The following frontmatter fields are RESERVED for future phases. They MUST NOT be written by any
V1 workflow, agent script, or manual vault edit. Writing them in V1 is a vault-drift violation
that will require cleanup before F1/F2 can write them with correct values.

| Field | Reserved for | Notes |
|---|---|---|
| `skillmeat-type` | F1 | Written by `hooks/sam.py` on create/promote when SAM is enabled |
| `skillmeat-version` | F1 | SAM envelope schema version (distinct from artifact `version`) |
| `skillmeat-id` | F1 | SAM-assigned UUID; populated after `POST /artifacts` returns |
| `meatywiki-ccdash-feature-slug` | F2 | CCDash feature correlation; uses `meatywiki-ccdash-*` prefix to avoid CCDash namespace collision |
| `meatywiki-ccdash-session-ref` | F2 | CCDash session attribution link |

If any of these fields are found in existing vault artifacts, see `troubleshooting.md` §"Vault
drift: namespace fields present in V1 artifacts" for remediation steps.

---

## 7. What Agents Should Do in V1

- **Treat `hooks/` as invisible.** Do not attempt to invoke, import, or reference hook modules
  from agent scripts, workflows, or CLI command sequences. Hooks fire automatically via the
  workflow engine's `notify` stage.

- **Never write SAM or CCDash frontmatter fields.** This applies under all conditions: no matter
  the source type, lifecycle stage, or workflow path. The reserved fields in §6 must be absent
  from all V1 vault artifacts.

- **Do not ingest developer-artifact sources.** If asked to ingest a Claude Code skill, agent
  definition, MCP config, hook file, project `.claude/` directory, or GitHub repository as a
  knowledge source — stop. This is `[deferred: F4]` (Q1 resolved). V1 supports the 9
  knowledge-domain connectors only (`note`, `url`, `upload_pdf`, `upload_image`, `upload_file`,
  `transcript`, `import_chatgpt`, `import_perplexity`, `import_gemini`).

- **Do not expect SAM UUIDs on any artifact.** Compiled artifacts in V1 carry `id` (ULID,
  engine-assigned) and `skillmeat-id` is absent. Any workflow logic that branches on
  `skillmeat-id` presence will never enter that branch in V1.

- **Treat `hooks.sam.enabled` and `hooks.ccdash.enabled` config flags as no-ops in V1.** These
  flags are reserved for F1/F2 activation. Setting either to `true` in `_meta/config.yaml`
  does not activate real integration — the stubs run regardless.

- **Troubleshooting vault drift.** If reserved namespace fields are found present in vault
  artifacts, or if `meatywiki doctor` reports unexpected frontmatter fields, refer to
  `troubleshooting.md` §"Vault drift: namespace fields present in V1 artifacts".

- **Logging is the only hook output in V1.** If debugging a compile run and suspecting hook
  interference, set log level to DEBUG (`--log-level debug` or `MEATYWIKI_LOG_LEVEL=debug`) and
  inspect `structlog` output for `hook=sam` or `hook=ccdash` entries. Their presence confirms
  the hook fired; their absence indicates the `notify` stage did not complete.

---

## 8. Cross-References

| Resource | What it covers |
|---|---|
| `references/command-reference.md` | Which commands trigger lifecycle events (and therefore hook dispatch); `promote` command default rules; no `register` command in V1 |
| `references/artifact-taxonomy.md` | Full frontmatter envelope fields table; integration namespace fields marked reserved; `agent_visibility` advisory-only note |
| `SPEC.md` §5, row A11 | Coverage matrix entry: SAM/CCDash stubs, `[deferred: F1/F2]` markers |
| `SPEC.md` §5, row A15 | Coverage matrix entry: `agent_visibility` advisory-only; image OCR opaque-blob; both explicitly labeled |
| `SPEC.md` §2, Out of Scope table | F1/F2/F4 rows in the deferred feature table |
| Engine spec §4.6 | Frontmatter contract, namespace isolation rationale, integration namespace fields (commented out in spec) |
| Engine spec §4.8 | Integration contracts for SAM and CCDash; standalone operation section |
| PRD §14 (Future Enhancement Phases) | F1/F2 trigger conditions, full scope descriptions, F1 edge-type mapping |
| PRD FR-18 | Hooks interface requirement: `hooks/base.py`; SAM and CCDash stubs; A14 acceptance criterion |
| SPIKE findings | `SPIKEs/sam-integration-findings.md` (SAM type inventory, edge mapping, REST API); `SPIKEs/ccdash-integration-findings.md` (CCDash field inventory, namespace collision analysis) |
