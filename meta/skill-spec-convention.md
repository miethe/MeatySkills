---
schema_version: 2
doc_type: spec
title: "Skill SPEC.md Convention"
status: draft
created: 2026-04-14
updated: 2026-04-14
owner: nick
related_documents:
  - .claude/specs/artifact-structures/skill-spec-template.md
  - .claude/specs/doc-policy-spec.md
  - .claude/skills/artifact-tracking/schemas/field-reference.md
  - .claude/context/key-context/spec-backed-skills-convention.md
---

# Skill SPEC.md Convention

**Version**: 1.0  
**Scope**: All custom skills under `.claude/skills/`  
**Enforcement**: Required for new skills; optional backfill for existing skills (see Phase 4 of meta-plan)

---

## Purpose

This convention defines the mandatory structure, frontmatter schema, lifecycle, and maintenance rules for `SPEC.md` files that accompany custom Claude Code skills.

A `SPEC.md` serves a distinct purpose from `SKILL.md`:

| File | Audience | Purpose |
|------|----------|---------|
| `SKILL.md` | Agents at invocation time | Concise routing instructions, quick-reference |
| `SPEC.md` | Skill authors, maintainers, orchestrators | Versioned capability contract, roadmap, invariants |

`SPEC.md` is the _source of truth for what a skill intends to cover_, how that coverage is versioned, and what gaps exist for future development.

---

## 1. SPEC.md Frontmatter Schema

Every `SPEC.md` must open with a YAML frontmatter block using the following fields.

### Required Fields

| Field | Type | Values / Format | Description |
|-------|------|-----------------|-------------|
| `schema_version` | integer | `2` | Frontmatter schema version (always `2`) |
| `doc_type` | string | `skill_spec` | Canonical document type identifier |
| `skill_name` | string | kebab-case, matches directory name | Identifies the skill |
| `skill_version` | string | semver (`MAJOR.MINOR.PATCH`) | Current version of the skill spec |
| `status` | string | `draft` \| `stable` \| `deprecated` | Maturity state (see §4) |
| `created` | string | `YYYY-MM-DD` | Date SPEC.md was first authored |
| `updated` | string | `YYYY-MM-DD` | Date of last edit |
| `owner` | string | GitHub handle or short name | Primary maintainer |
| `source_docs` | list of strings | Relative or absolute paths | Canonical user/dev docs this skill routes to |

### Optional Fields

| Field | Type | Values / Format | Description |
|-------|------|-----------------|-------------|
| `aligned_app_version` | string | semver (e.g., `0.35.0`) | Version of the parent application this skill was last verified against. Used to identify skills needing updates after app releases. |
| `deprecated_by` | string | Path | Path to the skill that supersedes this one |
| `deprecation_date` | string | `YYYY-MM-DD` | When deprecation takes effect |
| `related_skills` | list of strings | Skill names | Sibling skill names |
| `affects_commands` | list of strings | Command names | `/dev:*` or other commands this skill supports |

### Example Frontmatter

```yaml
---
schema_version: 2
doc_type: skill_spec
skill_name: skillmeat-cli
skill_version: 1.0.0
status: stable
created: 2026-04-14
updated: 2026-04-14
owner: nick
source_docs:
  - docs/user/guides/cli/commands.md
  - docs/user/guides/cli/reference.md
related_skills: [artifact-tracking, planning]
affects_commands: []
---
```

---

## 2. Required Sections

Every `SPEC.md` must contain the following sections in the order listed. Sections may be brief for narrow skills but must not be omitted.

### 2.1 Purpose & Scope

State what the skill does, what problems it solves for agents, and what is explicitly out of scope.

**Required content**:
- One-paragraph description of the skill's mission
- In-scope capabilities (bulleted list)
- Out-of-scope items that agents might expect (to prevent misuse)

**Anti-patterns**:
- Do not restate the `SKILL.md` verbatim
- Do not include routing instructions (those live in `SKILL.md`)

### 2.2 Capability Coverage

A mapping table from user intents to the workflow or document that handles them, plus the canonical source doc agents should consult for command syntax.

**Required columns**:

| Column | Description |
|--------|-------------|
| Intent | The user or agent goal expressed in plain language |
| Workflow / Section | The file or section within this skill that handles it |
| Canonical Doc | The user/dev doc link agents should reference for authoritative detail |

**Rules**:
- Every intent row must have a non-null canonical doc if one exists
- New capabilities added to `SKILL.md` must appear in this table before release
- Deprecated intents must be marked `[deprecated]` in the Intent column with a forward reference

### 2.3 Invariants & Constraints

Non-negotiable behavioral rules that agents must respect when using the skill.

**Required content**:
- Numbered list of invariants
- Each invariant is a single, testable statement
- Include source reference when the invariant traces to a policy doc

**Anti-patterns**:
- Do not list preferences or recommendations here — those go in the workflow docs
- Invariants must remain stable across minor versions; breaking an invariant requires a MAJOR version bump

### 2.4 Enhancement Backlog

A structured list of capability gaps, improvements, and future directions. This section absorbs ideas from deprecated workflows and gives roadmap visibility.

**Required format for each entry**:

```markdown
- **[BL-N] Title**: One-sentence description of the enhancement.
  _Status_: candidate | planned | deferred | will-not-fix
  _Rationale_: Why this is deferred or why it matters.
```

**Rules**:
- Entries must have a stable ID (`BL-1`, `BL-2`, etc.) for cross-referencing
- When an enhancement is implemented, move it to the Changelog (do not delete)
- `will-not-fix` entries should state why, so future authors do not re-propose them

### 2.5 Changelog

Version history for the SPEC.md itself (not the underlying skill implementation).

**Required format**:

```markdown
## Changelog

### v1.0.0 — 2026-04-14
- Initial SPEC.md authored
- Capability coverage matrix: N intents across M workflows
```

**Rules**:
- First entry is always `v0.1.0 — initial draft` (or `v1.0.0` if publishing directly as stable)
- Use ISO date (`YYYY-MM-DD`)
- Summarize what changed in the capability matrix, invariants, or structure — not code changes

### 2.6 Integration Points

Which agents and commands depend on this skill, and how they invoke it.

**Required content**:
- Table or list of agent names and the invocation pattern
- Which `/dev:*` or other commands load this skill (if any)
- Any skills this skill delegates to or expects to be loaded alongside

**Example format**:

```markdown
| Agent / Command | Invocation | Notes |
|-----------------|------------|-------|
| `lead-architect` | `Skill("skillmeat-cli")` | Uses discovery + deployment workflows |
| `/dev:execute-phase` | loads `dev-execution` which delegates here | Indirect |
```

### 2.7 Success Signals

Observable indicators that the skill is working as intended. These are not tests — they are heuristics for reviewers and maintainers.

**Required content**:
- 3–7 bullet points describing what "good usage" looks like
- May include: agent behaviors, output quality markers, token efficiency indicators, error rate expectations

---

## 3. Version-Management Rules

### 3.1 Semver Bump Triggers

| Change | Bump |
|--------|------|
| Adding a new intent row to the Capability Coverage table | MINOR |
| Removing or marking an intent deprecated | MINOR |
| Adding a new invariant | MINOR |
| Breaking or removing an invariant | MAJOR |
| Updating a canonical doc reference path | PATCH |
| Correcting prose, typos, formatting | PATCH |
| Restructuring the skill (new workflows, deprecations, consolidations) | MAJOR |
| First publication (`draft` → `stable`) | Promote to `1.0.0` |

### 3.2 Capability Coverage Matrix Versioning

The Capability Coverage table is the versioned contract surface:

- When a workflow file is renamed, update both the workflow column and bump PATCH
- When a workflow is consolidated into another, update affected rows and bump MINOR
- When a canonical doc changes location, update the link and bump PATCH
- Add the previous doc path as a comment if the old link may be cached by agents

### 3.3 Aligned App Version

When `aligned_app_version` is present in the frontmatter, maintainers should check whether the skill needs updates whenever the app version advances beyond this value.

The field tracks _verification_, not coupling — a skill aligned to `0.35.0` may still be correct at `0.36.0` if no relevant CLI or API changes occurred. It is intended as a lightweight signal, not a hard dependency gate.

**Bump rules**:
- Set `aligned_app_version` (or update it) whenever the skill is verified against a new app release.
- Do not update it speculatively — only update after actual verification.
- A missing `aligned_app_version` means the skill has never been explicitly verified against a versioned release; treat it as potentially stale.

**Relationship to `skill_version`**: `aligned_app_version` changes do not require a `skill_version` bump unless capability coverage or invariants also change. A pure re-verification (no content changes) may update `aligned_app_version` and `updated` without bumping `skill_version`.

### 3.4 Staleness Protocol

`SPEC.md` staleness is a first-class maintenance concern:

1. **Source-doc commit trigger**: When `source_docs` change (e.g., CLI commands are added or renamed), the SPEC.md for any skill that references those docs must be updated in the same commit.
2. **Quarterly review**: Skills with `status: stable` should have their Capability Coverage table reviewed against the current CLI surface once per quarter. Mark stale entries with `[stale - verify]` until confirmed.
3. **Deprecation trigger**: If a skill's primary `SKILL.md` is deprecated, the `SPEC.md` must be updated to `status: deprecated` in the same commit.

**Pre-commit reminder** (see risks section of meta-plan): A pre-commit hook may be added to detect changes under `skillmeat/cli/` and emit a warning if the SPEC.md for `skillmeat-cli` is not also staged.

---

## 4. Maturity Lifecycle

### States

| State | Meaning | Entry Criteria | Exit Criteria |
|-------|---------|----------------|---------------|
| `draft` | Being authored; may be incomplete | SPEC.md created | All required sections present; no `TODO` markers |
| `stable` | Published; actively maintained | All sections complete; version ≥ 1.0.0; reviewed by owner | Skill deprecated or superseded |
| `deprecated` | No longer recommended; superseded | Owner decision; `deprecated_by` field set | Not applicable (terminal state) |

### Transition Rules

**`draft` → `stable`**:
- All 7 required sections must be present and non-empty
- No unresolved `TODO` or `{{PLACEHOLDER}}` markers
- `skill_version` must be set to `1.0.0` or higher
- Owner must explicitly set `status: stable` in frontmatter (not automatic)

**`stable` → `deprecated`**:
- Set `status: deprecated`
- Set `deprecated_by` to the path of the replacement skill
- Set `deprecation_date` to today
- Add final Changelog entry noting the deprecation reason
- Do not delete the SPEC.md — archive it with the skill

**`draft` → `deprecated`** (rare, abandoned spec):
- Set `status: deprecated`
- Add a Changelog note explaining abandonment
- No `deprecated_by` required if no replacement

---

## 5. File Layout Convention

`SPEC.md` lives at the root of the skill directory, alongside `SKILL.md`:

```
.claude/skills/skill-name/
├── SKILL.md          # Invocation-time routing and quick-reference (required)
├── SPEC.md           # This convention (required for new skills; optional backfill)
├── workflows/        # Detailed workflow files referenced from SKILL.md and SPEC.md
├── references/       # Supporting reference files
├── scripts/          # Node.js scripts (ESM)
└── templates/        # Template files
```

`SPEC.md` must not duplicate routing instructions from `SKILL.md`. Cross-reference `SKILL.md` sections by name where needed, but do not copy them.

---

## 6. Enforcement Policy

### New Skills (Required)

All skills created via `skill-creator` or `skill-builder` after this convention is published must include a `SPEC.md` before the skill is considered ready for use. The skill-creator and skill-builder workflows explicitly call out SPEC.md authoring as a required step.

A skill without SPEC.md should be treated as `draft` status regardless of its `SKILL.md` maturity.

### Existing Skills (Optional Backfill)

The 40+ existing skills as of 2026-04-14 are **not** required to have a SPEC.md unless they are being actively modified. Backfill priority is managed in Phase 4 of the meta-plan, with candidates ordered by agent dependency weight:

1. `artifact-tracking` — central to CCDash/planning
2. `dev-execution` — feeds all `/dev:*` commands
3. `planning` — orchestrator dependency
4. `debug` — tier-1 debugging skill
5. `meatycapture-capture` — request-log lifecycle

### Reviews

When reviewing a new skill PR:
- [ ] `SPEC.md` is present
- [ ] Frontmatter contains all required fields
- [ ] All 7 required sections are present
- [ ] No `TODO` or `{{PLACEHOLDER}}` markers (if `status: stable`)
- [ ] Capability Coverage table covers all workflows listed in `SKILL.md`
- [ ] `source_docs` list is accurate and paths resolve

---

## 7. Relationship to Other Specs

| Spec / Doc | Relationship |
|------------|-------------|
| `.claude/specs/doc-policy-spec.md` | Parent policy; SPEC.md lives in the agent tooling layer, not `/docs/` |
| `.claude/specs/artifact-structures/skill-spec-template.md` | Fillable template implementing this convention |
| `.claude/skills/artifact-tracking/schemas/field-reference.md` | `doc_type: skill_spec` is registered there |
| `.claude/context/key-context/spec-backed-skills-convention.md` | Agent-oriented playbook for reading and using SPEC.md files |

---

## 8. Anti-Patterns

| Anti-Pattern | Correct Approach |
|--------------|-----------------|
| Copying `SKILL.md` content into `SPEC.md` | Reference `SKILL.md` sections by name; do not duplicate |
| Using `SPEC.md` as a changelog for the skill implementation | Changelog section tracks SPEC.md changes only; implementation changes go to git commits |
| Leaving `status: draft` indefinitely | Progress to `stable` once all sections are complete, or explicitly mark `deprecated` |
| Omitting `source_docs` | Every skill that routes to CLI commands or user docs must list them; helps agents find canonical syntax |
| Adding TODOs without BL-N IDs | All backlog items need stable IDs for cross-referencing |
| Writing invariants as preferences | Invariants must be non-negotiable; preferences go in workflow docs |
