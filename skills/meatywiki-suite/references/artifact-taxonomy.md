---
name: meatywiki-suite-artifact-taxonomy
description: Artifact types, workspaces, frontmatter envelope, and lifecycle states
type: reference
skill_name: meatywiki-suite
cli_version_range: "compilation-engine-v1 – v1.2"
schema_version: 1
created: 2026-05-04
updated: 2026-05-04
---

# Artifact Taxonomy Reference

Runtime authority: `src/meatywiki/schema/taxonomy.py`, `frontmatter.py`, `edges.py`, `lifecycle.py`.

---

## Workspaces

| Workspace | Value | Default for |
|-----------|-------|-------------|
| Inbox | `inbox` | All raw artifact types |
| Library | `library` | Knowledge + runtime artifacts (remapped 2026-04-20, schema 1.2.0) |
| Research | `research` | Artifacts flagged `research_origin: true` by caller |
| Blog | `blog` | Writing artifacts |
| Projects | `projects` | Project artifacts |

Note: `_meta/` is engine-owned (SQLite, config, compile state) and is not a user workspace.

---

## Artifact Types

### Raw Artifacts (default workspace: `inbox`)

| Type | Value | Subtypes |
|------|-------|----------|
| Raw Note | `raw_note` | `quick_capture`, `voice_note` |
| Raw URL | `raw_url` | `article`, `documentation`, `reference` |
| Raw Upload | `raw_upload` | `pdf`, `image`, `file` |
| Raw Transcript | `raw_transcript` | `meeting`, `video`, `podcast` |
| Raw Import | `raw_import` | `chatgpt_export`, `perplexity_export`, `gemini_export` |

### Knowledge Artifacts (default workspace: `library`)

| Type | Value | Subtypes |
|------|-------|----------|
| Source Summary | `source_summary` | — |
| Entity | `entity` | — |
| Concept | `concept` | — |
| Topic Note | `topic_note` | — |
| Synthesis | `synthesis` | `research_synthesis`, `comparison`, `thesis_note`, `briefing`, `evidence_summary` |
| Evidence Matrix | `evidence_matrix` | — |
| Contradiction Matrix | `contradiction_matrix` | — |
| Glossary Term | `glossary_term` | — |

### Writing Artifacts (default workspace: `blog`)

| Type | Value | Subtypes |
|------|-------|----------|
| Blog Idea | `blog_idea` | — |
| Blog Outline | `blog_outline` | — |
| Blog Draft | `blog_draft` | — |
| Series | `series` | — |
| Review Comment Set | `review_comment_set` | — |

### Project Artifacts (default workspace: `projects`)

| Type | Value | Subtypes |
|------|-------|----------|
| Context Pack | `context_pack` | — |
| Brief | `brief` | — |
| PRD | `prd` | — |
| ADR | `adr` | — |
| Implementation Plan | `implementation_plan` | — |
| Session Log | `session_log` | — |
| Decision | `decision` | — |
| Risk | `risk` | — |

### Runtime Artifacts (default workspace: `library`)

| Type | Value | Subtypes |
|------|-------|----------|
| Workflow Run | `workflow_run` | — |
| Memory Item | `memory_item` | — |

---

## Frontmatter Envelope

All fields from `ArtifactEnvelope` (Pydantic v2). IDs use format `art_<26-char-ULID>`.

### Required Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `art_<ULID>` prefix required |
| `title` | string | Non-empty |
| `artifact_type` | string | Must be a valid `ArtifactType` value |
| `workspace` | string | One of the five workspace values |
| `created` | datetime | UTC ISO-8601 |
| `updated` | datetime | UTC ISO-8601; must be >= `created` |

### Defaulted Fields

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `status` | string | `active` | `active`, `archived`, `superseded`, `merged_redirect` |
| `lifecycle_stage` | string | `raw` | See lifecycle section |
| `verification_status` | string | `unverified` | `unverified`, `human_review_pending`, `human_reviewed`, `machine_verified` |
| `schema_version` | string | `1.2.0` | Current default |
| `freshness_class` | string | `current` | `current`, `aging`, `stale` |
| `contradiction_state` | string | `none` | `none`, `flagged`, `resolved` |
| `agent_visibility` | string | `shared` | `private`, `shared`, `published` — advisory only in V1 |

### Optional Fields

| Field | Type | Notes |
|-------|------|-------|
| `description` | string\|null | Short prose description |
| `subtype` | string\|null | Validated against `SUBTYPE_REGISTRY` |
| `source_refs` | list[string] | Source artifact IDs (fallback edge source) |
| `derived_from` | list[string] | Canonical parent compilation lineage |
| `relates_to` | list[string] | Lateral relationships |
| `supports` | list[string] | Evidence/claim support targets |
| `domain` | list[string] | Domain tags (`ml`, `infra`, etc.) |
| `project` | list[string] | Project slugs |
| `tags` | list[string] | Freeform search/filter tags |
| `series` | string\|null | Blog series slug |
| `publish_state` | string\|null | `internal`, `draft`, `review`, `published` |
| `evidence_strength` | string\|null | `low`, `medium`, `high` |
| `compile_model` | string\|null | Model used at compile stage |
| `compile_run_id` | string\|null | Opaque compile workflow run ID |
| `owners` | list[string] | Human or agent owner identifiers |

### Schema v1.1.0 Fields (Workflow OS lens)

| Field | Type | Notes |
|-------|------|-------|
| `lens_fidelity` | string\|null | `high`, `medium`, `low` — set by lint stage |
| `lens_freshness` | string\|null | `current`, `stale`, `outdated` — set by lint stage |
| `lens_verification_state` | string\|null | `verified`, `disputed`, `unverified` — set by lint stage |
| `quality_gates` | list[string] | Lint-emitted indicators (e.g. `freshness:ok`) |
| `workflow_os_meta` | dict\|null | Extension drawer for Workflow OS fields |

### Schema v1.2.0 Fields (Research routing)

| Field | Type | Notes |
|-------|------|-------|
| `research_origin` | bool\|null | Set by caller; routes artifact to research workspace |
| `research_workflow_id` | string\|null | Workflow run provenance; set by engine |
| `extraction_origin` | bool\|null | True if produced by automated extraction |

### Schema v1.3.0 Fields (Entity linkage, engine v1.1)

| Field | Type | Notes |
|-------|------|-------|
| `superseded_by` | list[string] | IDs of superseding artifacts |
| `contains` | list[string] | Child entity IDs structurally contained |

Meaningful for `entity`, `concept`, `glossary_term`. Warn-only validation on write.

### Consolidation Fields (knowledge-consolidation v1)

| Field | Type | Notes |
|-------|------|-------|
| `merged_from` | list[string] | Source IDs absorbed into this canonical artifact |
| `redirect_to` | string\|null | Canonical target for `merged_redirect` stubs |
| `merge_confidence` | float\|null | 0.0–1.0 |
| `merge_run_id` | string\|null | Consolidation run that produced the merge |
| `merge_reviewed_at` | datetime\|null | Review timestamp |
| `merge_reviewed_by` | string\|null | Reviewer ID (e.g. `auto`) |

### Namespace Passthrough

Fields prefixed `skillmeat-*` or `meatywiki-ccdash-*` pass through opaquely via `extra="allow"`.

### Minimal Valid Frontmatter

```yaml
---
id: "art_01HZ3ABCDE4FGHJKMNPQRSTVWX"
title: "Example Concept"
artifact_type: concept
workspace: library
created: 2026-01-01T00:00:00+00:00
updated: 2026-01-01T00:00:00+00:00
schema_version: "1.2.0"
---
```

---

## Lifecycle

Progression is strictly forward, one stage at a time.

```
raw → classified → compiled → reviewed → published
```

| Stage | Value | Triggered by |
|-------|-------|--------------|
| Raw | `raw` | Ingest |
| Classified | `classified` | Classify stage |
| Compiled | `compiled` | Compile stage |
| Reviewed | `reviewed` | Human/lint review |
| Published | `published` | Publish action |

`ArtifactStatus` (operational): `active`, `archived`, `superseded`.

`VerificationStatus`: `unverified`, `human_review_pending`, `human_reviewed`, `machine_verified`.

`FreshnessClass` (lint-derived): `current`, `aging`, `stale`.

`ContradictionState`: `none`, `flagged`, `resolved`.

---

## Edge Types (Knowledge Graph)

All edges are directed: `from_id → to_id`. Confidence is 0.0–1.0 (LLM-assigned).

| Edge Type | Value | Description |
|-----------|-------|-------------|
| Derived From | `derived_from` | Compilation lineage parent |
| Supports | `supports` | Evidence or corroboration |
| Relates To | `relates_to` | Lateral, non-hierarchical |
| References | `references` | Citation or mention |
| Supersedes | `supersedes` | Newer version replaces older |
| Contradicts | `contradicts` | Conflicting claim |
| Contains | `contains` | Structural hierarchy (entity contains sub-entities) |
| Generated By | `generated_by` | Produced by a workflow run |
| Possible Duplicate Of | `possible_duplicate_of` | Consolidation candidate |
| Redirects To | `redirects_to` | Redirect stub resolution |
| Merged Into | `merged_into` | Absorbed by canonical artifact |

Edge sources (v1.1): `cooccurrence`, `wikilink_parser`, `frontmatter`, `llm_extract`.

### Edge Projection Precedence (reconciler)

1. Canonical fields (`derived_from`, `relates_to`, `supports`, `contains`, `superseded_by`) — checked first.
2. `source_refs` fallback — only fires when canonical `derived_from` is absent/null; projected as synthetic `derived_from` edges.
3. Unresolved target ULIDs are dropped (not orphaned).

---

## Lens Dimensions (Portal v1.6+)

Three dimensions exposed on artifacts via Workflow OS Lens Badges.

| Dimension | Frontmatter field | Values | Set by |
|-----------|------------------|--------|--------|
| Fidelity | `lens_fidelity` | `high`, `medium`, `low` | Lint stage / tooling |
| Freshness | `lens_freshness` | `current`, `stale`, `outdated` | Lint stage |
| Verification | `lens_verification_state` | `verified`, `disputed`, `unverified` | Lint stage / human |

Write path for `lens_fidelity` and `lens_verification_state` is deferred (DF-007). In Portal v1 these fields are populated by the engine lint stage only.

---

## Alias Types

Stored in the `artifact_aliases` table (not a JSON column).

| Alias Type | Value | Use |
|------------|-------|-----|
| Title | `title` | Alternate display name |
| Abbreviation | `abbreviation` | Short form (e.g. acronym) |
| Alternate | `alternate` | Any other alias form |
