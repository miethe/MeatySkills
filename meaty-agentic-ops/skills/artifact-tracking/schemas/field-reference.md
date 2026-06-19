# CCDash Field Reference (Schema v2)

This reference defines how to populate frontmatter fields across CCDash-aligned document types.

## Common Envelope Fields

| Field | Type | Values | Required | When to Fill | Example |
|---|---|---|---|---|---|
| `schema_version` | integer | `2` | All CCDash-aligned docs | Always for new docs | `2` |
| `doc_type` | string | e.g. `prd`, `implementation_plan`, `human_brief` | All CCDash-aligned docs | Always for new docs | `implementation_plan` |
| `title` | string | free text | Most doc types | Always | `Implementation Plan: Foo` |
| `status` | string | `draft`, `planning`, `in-progress`, `review`, `completed`, etc. | Most doc types | Lifecycle state changes | `draft` |
| `feature_slug` | string | kebab-case | Recommended all docs | Set from feature name once | `ccdash-frontmatter-alignment` |
| `feature_version` | string | e.g. `v1`, `v2` | Optional | Set when feature uses versioned docs | `v1` |
| `prd_ref` | string or `null` | file path | Required for implementation plans; optional elsewhere | Link to parent PRD | `docs/project_plans/PRDs/enhancements/foo-v1.md` |
| `plan_ref` | string or `null` | file path | Required for phase plans; optional elsewhere | Link to parent implementation plan | `docs/project_plans/implementation_plans/enhancements/foo-v1.md` |
| `human_brief_ref` | string or `null` | file path | Optional; valid on `prd` and `implementation_plan` doc_types | Link to associated human brief when one exists | `docs/project_plans/human-briefs/agent-artifact-discovery.md` |
| `intent_ref` | string or `null` | file path | Optional; forward-compat seam — leave null until INTENT.md system is designed | Link to associated INTENT.md; valid on `human_brief` (other doc_types may adopt later) | `null` |
| `epic_ref` | string or `null` | file path | Optional; forward-compat seam — leave null until Epic-level INTENT.md is designed | Link to associated epic artifact; valid on `human_brief` (other doc_types may adopt later) | `null` |
| `related_documents` | string[] | file paths | Optional | Link sibling/context docs | `["docs/.../phase-1.md"]` |
| `references` | object | `{user_docs, context, specs, related_prds}` | Optional | Categorized reference paths for execution workflow injection | `{context: [".claude/context/key-context/data-flow-patterns.md"]}` |
| `references.user_docs` | string[] | file paths | Optional | User-facing docs relevant to feature | `["docs/user/guides/edition-feature-matrix.md"]` |
| `references.context` | string[] | file paths | Optional | Agent context files | `[".claude/context/key-context/router-patterns.md"]` |
| `references.specs` | string[] | file paths | Optional | Specification files | `[".claude/specs/version-bump-spec.md"]` |
| `references.related_prds` | string[] | file paths | Optional | Related PRD/progress paths | `[".claude/progress/sync-workflow-v1/"]` |
| `owner` | string or `null` | name/agent | Optional | Assign primary owner | `python-backend-engineer` |
| `owners` | string[] | names/agents | Progress only | Use for multi-owner progress docs | `["ui-engineer-enhanced"]` |
| `contributors` | string[] | names/agents | Optional | Track secondary contributors | `["documentation-writer"]` |
| `priority` | string | `low`, `medium`, `high`, `critical` | Recommended planning docs | Set during planning | `medium` |
| `risk_level` | string | `low`, `medium`, `high`, `critical` | Recommended planning docs | Set during planning | `high` |
| `created` | date | `YYYY-MM-DD` | Most doc types | Creation date | `2026-02-19` |
| `updated` | date | `YYYY-MM-DD` | Most doc types | Update on any write | `2026-02-19` |
| `milestone` | string or `null` | free text | Optional | Release train or milestone | `M2` |
| `tags` | string[] | short labels | Optional | Add searchable labels | `["planning","ccdash"]` |
| `category` | string or `null` | taxonomy label | Optional | Planning/research/report grouping | `product-planning` |
| `files_affected` | string[] | file paths | Optional | Fill once scope is concrete | `[".claude/skills/.../SKILL.md"]` |
| `commit_refs` | string[] | SHAs | Optional | Add after commits land | `["abc1234"]` |
| `pr_refs` | string[] | PR refs | Optional | Add after PR creation | `["#412"]` |
| `request_log_ids` | string[] | request IDs | Optional | Link back to request-log items | `["REQ-20260219-ABC-01"]` |
| `id` | string | stable identifier | Optional | Use when external systems require immutable ID | `prd-foo-v1` |

## PRD (`doc_type: prd`)

| Field | Type | Required | When to Fill | Example |
|---|---|---|---|---|
| `problem_statement` | string or `null` | Optional | When statement is finalized | `Users cannot link artifacts across plans.` |
| `personas` | string[] | Optional | During discovery | `["PM","Developer"]` |
| `goals` | string[] | Optional | During goal definition | `["Unify frontmatter"]` |
| `non_goals` | string[] | Optional | During scoping | `["UI redesign"]` |
| `requirements` | string[] | Optional | During requirements pass | `["Support migration"]` |
| `success_metrics` | string[] | Optional | Define measurable outcomes | `["100% docs have doc_type"]` |
| `dependencies` | string[] | Optional | Capture known dependencies | `["artifact-tracking scripts"]` |
| `risks` | string[] | Optional | Capture major risks | `["Schema regressions"]` |

## Implementation Plan (`doc_type: implementation_plan`)

| Field | Type | Required | When to Fill | Example |
|---|---|---|---|---|
| `scope` | string or `null` | Optional | At planning time | `Align schemas, templates, scripts.` |
| `architecture_summary` | string or `null` | Optional | After architecture pass | `Envelope schema composed via $ref.` |
| `phases` | string[] | Optional | If phase list is tracked in frontmatter | `["Phase 1","Phase 2"]` |
| `effort_estimate` | string or `null` | Optional | During planning | `23 pts` |
| `test_strategy` | string or `null` | Optional | Before implementation | `Validate + lint + migration dry run.` |

## Phase Plan (`doc_type: phase_plan`)

| Field | Type | Required | When to Fill | Example |
|---|---|---|---|---|
| `phase` | integer | Yes | Always | `3` |
| `phase_title` | string | Yes | Always | `Script Enhancements` |
| `entry_criteria` | string[] | Optional | Before phase starts | `["Phase 2 complete"]` |
| `exit_criteria` | string[] | Optional | Before phase starts | `["Validation passes"]` |

## SPIKE (`doc_type: spike`)

| Field | Type | Required | When to Fill | Example |
|---|---|---|---|---|
| `research_questions` | string[] | Optional | At spike kickoff | `["Can we auto-detect doc type?"]` |
| `complexity` | string | Optional | During estimation | `medium` |
| `estimated_research_time` | string or `null` | Optional | During estimation | `2d` |

## Quick Feature (`doc_type: quick_feature`)

| Field | Type | Required | When to Fill | Example |
|---|---|---|---|---|
| `estimated_scope` | string | Optional | During quick planning | `small` |
| `request_log_id` | string or `null` | Optional | If work came from request-log | `REQ-20260219-ABC-01` |

## Report (`doc_type: report`)

| Field | Type | Required | When to Fill | Example |
|---|---|---|---|---|
| `report_period` | string or `null` | Optional | At report creation | `2026-02` |
| `outcome` | string or `null` | Optional | At report completion | `completed` |
| `metrics` | string[] | Optional | When metrics exist | `["10 docs migrated"]` |
| `findings` | string[] | Optional | At report completion | `["Missing doc_type was common"]` |
| `action_items` | string[] | Optional | At report completion | `["Add pre-commit hook"]` |

## Skill Spec (`doc_type: skill_spec`)

Frontmatter for SPEC.md files that formally specify a custom skill's purpose, capabilities, invariants, and roadmap.
Authoritative spec: `.claude/specs/artifact-structures/skill-spec-convention.md`

### Required Fields

| Field | Type | Values / Constraints | Example |
|---|---|---|---|
| `schema_version` | integer | `2` | `2` |
| `doc_type` | string | `skill_spec` | `skill_spec` |
| `skill_name` | string | kebab-case, 2–128 chars | `skillmeat-cli` |
| `skill_version` | string | semver or `v`-prefixed | `v1.2.0` |
| `status` | string | `draft`, `stable`, `deprecated` | `stable` |
| `created` | date | `YYYY-MM-DD` | `2026-04-14` |
| `updated` | date | `YYYY-MM-DD` | `2026-04-14` |
| `owner` | string | agent name or person | `python-backend-engineer` |

### Optional Fields

| Field | Type | Purpose | Example |
|---|---|---|---|
| `source_docs` | string[] | Canonical reference docs the skill routes to | `["docs/user/guides/cli/commands.md"]` |
| `affects_agents` | string[] | Agent personas that load or invoke this skill | `["python-backend-engineer", "codebase-explorer"]` |
| `affects_commands` | string[] | Slash commands that require this skill | `["/dev:execute-phase"]` |
| `plan_ref` | string or `null` | Link to implementation plan that created/updated this spec | `.claude/plans/skill-spec-convention-and-skillmeat-cli-refresh.md` |

### Lifecycle Guidance

| Status | Meaning | Transition |
|---|---|---|
| `draft` | Spec is being authored; not yet enforced | Promote to `stable` when all required sections are complete and the skill is in active use |
| `stable` | Spec is authoritative; agents rely on it | Demote to `deprecated` when the skill is replaced or removed |
| `deprecated` | Skill is sunset; spec retained for reference | Archive after 90 days; remove from skills-index.md active roster |

**Versioning**: Increment `skill_version` on any change to capability coverage, invariants, or routing. Minor edits (typos, formatting) do not require a version bump.

## Human Brief (`doc_type: human_brief`)

Living document for human orchestrators. One file per feature, stored at
`docs/project_plans/human-briefs/[feature-slug].md`. Agents must not load these files
unless the task prompt explicitly names the brief. Authoritative spec:
`.claude/specs/artifact-structures/human-brief-spec.md`.

### Required Fields

| Field | Type | Values / Constraints | Example |
|---|---|---|---|
| `schema_name` | string | `ccdash_document` | `ccdash_document` |
| `schema_version` | integer | `2` | `2` |
| `doc_type` | string | `human_brief` | `human_brief` |
| `root_kind` | string | `project_plans` | `project_plans` |
| `title` | string | free text | `Agent Artifact Discovery — Human Brief` |
| `status` | string | `draft`, `in-progress`, `completed` — reuses existing enum; `blocked`/`superseded`/`approved` not used for briefs | `draft` |
| `category` | string | `human-briefs` | `human-briefs` |
| `feature_slug` | string | kebab-case; matches linked PRD/plan exactly | `agent-artifact-discovery` |
| `audience` | string[] | must include `humans` — machine-readable skip signal for agents | `[humans]` |
| `created` | date | `YYYY-MM-DD` | `2026-04-23` |
| `updated` | date | `YYYY-MM-DD` | `2026-04-23` |

### Optional Fields

| Field | Type | Purpose | Example |
|---|---|---|---|
| `doc_subtype` | string | `epic_brief`, `feature_brief`, or `meta_brief` | `feature_brief` |
| `id` | string | Stable ID, e.g. `BRIEF-feature-slug` | `BRIEF-agent-artifact-discovery` |
| `feature_family` | string | Versionless slug (omit `-v1` suffix) | `agent-artifact-discovery` |
| `feature_version` | string | e.g. `v1` | `v1` |
| `prd_ref` | string or `null` | Path to linked PRD; required when a PRD exists | `docs/project_plans/PRDs/agent-artifact-discovery-prd.md` |
| `plan_ref` | string or `null` | Path to linked implementation plan; required when a plan exists | `docs/project_plans/implementation_plans/agent-artifact-discovery-plan.md` |
| `intent_ref` | string or `null` | Forward-compat for INTENT.md system; leave null | `null` |
| `epic_ref` | string or `null` | Forward-compat for Epic-level INTENT.md; leave null | `null` |
| `related_documents` | string[] | Related briefs, SPIKEs, design specs | `[]` |
| `owner` | string | Primary owner | `nick` |
| `contributors` | string[] | Secondary contributors | `[]` |
| `priority` | string | `low`, `medium`, `high`, `critical` | `medium` |
| `confidence` | number | 0..1 — orchestrator's confidence in the plan | `0.75` |
| `target_release` | string | e.g. `2026-Q3` | `2026-Q3` |
| `tags` | string[] | Searchable labels; always include `human-brief` | `[human-brief]` |

### Naming and Lifecycle

- **Path**: `docs/project_plans/human-briefs/[feature-slug].md` — flat directory, no subdirs
- **No `-v1` suffix** — briefs are living documents, not versioned deliverables
- **One brief per feature** — do not create phase-level briefs
- **Status flow**: `draft` → `in-progress` → `completed`

## Feature Contract (`doc_type: feature_contract`)

Tier 1 planning artifact (3–8 pt features). Replaces the PRD + Implementation Plan pair.
Schema: `.claude/skills/artifact-tracking/schemas/feature-contract.schema.yaml`
Canonical location: `docs/project_plans/feature_contracts/[category]/[feature-slug].md`

### Required Fields

| Field | Type | Values / Constraints | Example |
|---|---|---|---|
| `schema_version` | integer | `2` | `2` |
| `doc_type` | string | `feature_contract` | `feature_contract` |
| `title` | string | 3–256 chars | `Add dark mode toggle` |
| `description` | string | 10–512 chars | `Add a persistent dark/light mode toggle to the nav bar.` |
| `status` | string | `draft`, `approved`, `in-progress`, `completed`, `deferred`, `cancelled` | `draft` |
| `created` | date | `YYYY-MM-DD` | `2026-05-01` |
| `updated` | date | `YYYY-MM-DD` | `2026-05-01` |
| `feature_slug` | string | kebab-case, 2–128 chars | `dark-mode-toggle` |
| `category` | string | `features`, `enhancements`, `refactors`, `harden-polish`, `infrastructure` | `features` |
| `estimated_points` | integer | 1–20 | `5` |
| `tier` | integer | `1` (Tier 2/3 use PRD/Plan, not Feature Contract) | `1` |
| `owner` | string | agent name or person, 2–128 chars | `python-backend-engineer` |

### Optional Fields

| Field | Type | Values / Constraints | Example |
|---|---|---|---|
| `priority` | string | `low`, `medium`, `high` | `medium` |
| `risk_level` | string | `low`, `medium`, `high` | `low` |
| `changelog_required` | boolean | `true`, `false` | `true` |
| `related_documents` | string[] | file paths, 3–256 chars each | `[".claude/plans/foo.md"]` |
| `spike_ref` | string or `null` | path to SPIKE doc | `null` |
| `prd_ref` | string or `null` | null for Tier 1; set only if promoted to Tier 2 | `null` |
| `plan_ref` | string or `null` | null for Tier 1 | `null` |
| `commit_refs` | string[] | git SHAs, 7–64 chars | `["abc1234"]` |
| `pr_refs` | string[] | PR refs, 3–64 chars | `["#512"]` |
| `files_affected` | string[] or string or int | file paths | `["skillmeat/web/components/nav.tsx"]` |

### Status Values

| Status | Meaning |
|---|---|
| `draft` | Contract is being authored; not yet approved for sprint |
| `approved` | Contract reviewed and ready for autonomous sprint |
| `in-progress` | Sprint is underway |
| `completed` | Sprint finished; reviewer approved; Opus committed |
| `deferred` | Work deferred; contract retained for reference |
| `cancelled` | Work cancelled; contract retained for reference |

### Promotion Rule

If during contract review the feature looks ≥8 pts, promote to Tier 2 by authoring a PRD that references the contract via `related_documents`. Do not retrofit — restart with the heavyweight flow. Set `prd_ref` on the contract once the PRD is created.

## Backward-Compatibility Fields

| Legacy Field | Current Pairing | Guidance |
|---|---|---|
| `type: progress` | `doc_type: progress` | Keep both for existing progress workflows |
| `prd` | `feature_slug` | Keep `prd` for old scripts; mirror in `feature_slug` when possible |
| `type: context` | `doc_type: context` | Keep both for existing worknotes tooling |
| `type: bug-fixes` | `doc_type: bug_fix` | Keep old value for existing logs; add new `doc_type` for CCDash |
| `type: observations` | `doc_type: observation` | Keep old value for existing logs; add new `doc_type` for CCDash |

## Frontmatter Lifecycle

Below is a reference table showing which fields should be populated at each SDLC phase, helping teams understand when to set frontmatter values.

| Field | Draft | Approved | In-Progress | Completed |
|-------|-------|----------|-------------|-----------|
| title | ✅ Required | — | — | — |
| description | ✅ Required | — | — | — |
| schema_version | ✅ Required | — | — | — |
| doc_type | ✅ Required | — | — | — |
| status | `draft` | `approved` | `in-progress` | `completed` |
| created | ✅ Set once | — | — | — |
| updated | ✅ Set | ✅ Update | ✅ Update | ✅ Update |
| feature_slug | ✅ Required | — | — | — |
| feature_version | ✅ Required | — | — | — |
| prd_ref | ⬜ Optional | ✅ Link if exists | — | — |
| plan_ref | ⬜ n/a | ✅ Link when plan created | — | — |
| scope | ✅ Required | — | — | — |
| effort_estimate | ✅ Estimate | — | — | ⬜ Actual (optional) |
| priority | ✅ Required | — | — | — |
| risk_level | ✅ Required | — | — | — |
| contributors | ⬜ Initial | — | ✅ Update as agents work | ✅ Finalize |
| milestone | ⬜ Optional | ✅ Set if scheduled | — | — |
| commit_refs | — | — | ✅ Append per commit | ✅ Finalize |
| pr_refs | — | — | ✅ Append per PR | ✅ Finalize |
| files_affected | — | — | — | ✅ Populate |

**Legend**: ✅ = action required at this phase, ⬜ = optional, — = no change expected

**Guidance**:
- Use `manage-plan-status.py --field` for individual field updates during status transitions
- Use `update-field.py --append` for list fields like `commit_refs` and `pr_refs` as development progresses
- Always update `updated` date whenever any other field changes
