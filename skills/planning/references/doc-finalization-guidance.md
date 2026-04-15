# Documentation Finalization Guidance

Reference for determining what documentation updates are needed and delegating them appropriately.

## Evaluation Heuristics

Use this table to decide which documentation types should be created/updated:

| Doc Type | Include When | Skip When |
|----------|-------------|-----------|
| CHANGELOG | User-facing: new features, breaking changes, deprecations, bug fixes | Internal refactors, dev tooling, test-only changes |
| README | Features, CLI commands, screenshots, or version changed | No user-visible changes |
| User/dev docs | Behavior changes users need to know | Internal implementation details |
| Context files (CLAUDE.md, key-context) | Agent behavior, architecture patterns, dev workflow changes | App code that doesn't change how agents work |

**Key principle**: Documentation exists for humans and agents who use the system, not for code that implements it.

## Delegation Targets

Route documentation work to these agents and skills:

| Doc Type | Agent | Skill | Model |
|----------|-------|-------|-------|
| CHANGELOG | changelog-generator | changelog-generator | haiku |
| README updates | documentation-writer | — | haiku |
| User/dev guides | documentation-writer | — | haiku |
| Context file updates | documentation-writer | — | haiku |

**Pattern**: Use `Task("documentation-writer", "Update [doc type]: ...")` for all human-readable docs.

## Verbosity Standards

Keep all documentation concise and actionable:

- **Lead with impact**: "What changed and how does it affect me?"
- **No verbose background**: Skip explanations of implementation rationale
- **CHANGELOG**: One line per change, grouped by category (Added/Changed/Fixed/Removed/Deprecated)
- **README**: Update affected sections only; don't rewrite unchanged sections
- **Context files**: Pointer-style (one-liner + file path reference), ≤3 lines per addition

## Context File Update Rules (Progressive Disclosure)

Update context strategically to avoid information bloat:

### CLAUDE.md (root or domain-specific)
- **Purpose**: High-level pointers and invariants
- **Style**: One-liner + path reference
- **Limit**: ≤3 lines per addition
- **When to add**: Significant behavior change affecting how agents work
- **When to skip**: Updating existing documentation in key-context files (no need to update CLAUDE.md)

### Key-context files (`.claude/context/key-context/*.md`)
- **Purpose**: Detailed guidance for specific domains
- **Style**: Full explanations, patterns, examples
- **Limit**: Update existing files when possible
- **When to create new**: Only when genuinely new domain area (not a minor addition to existing domain)
- **When to update existing**: Any time behavior or patterns change in that domain

### Rules files (`.claude/rules/*.md`)
- **Purpose**: Invariants and hard constraints
- **Style**: 5-10 line stubs pointing to full documentation
- **When to update**: When invariants or enforcement patterns change
- **Pattern**: "Invariant: [statement]. See `.claude/context/.../details.md` for full conventions."

### Never
- Create new context files for minor changes
- Add verbose explanations to CLAUDE.md (use key-context instead)
- Update documentation without evaluating whether it's necessary (check heuristics table)

## Examples: Good vs Bad

### Good CLAUDE.md Addition
```markdown
**UI Extraction**: Evaluate components for @meaty/ui extraction during planning. See `.claude/specs/ui-package-extraction-spec.md`.
```
Clear, actionable, points to where details live.

### Bad CLAUDE.md Addition
```markdown
**UI Extraction**: We have implemented a process for evaluating which components should be extracted
into a separate UI package. This process involves analyzing component usage patterns, determining
reusability across projects, and documenting the extraction criteria. The full specification
includes examples of components that should and should not be extracted...
```
Verbose, duplicates what's in the spec, bloats CLAUDE.md.

### Good CHANGELOG Entry
```
- Added: Model and Effort columns in implementation plan task tables
- Changed: Task status transitions now validate model compatibility
- Fixed: CHANGELOG entries no longer include internal refactors
```
Concise, scannable, user-focused.

### Bad CHANGELOG Entry
```
- Added: We have now added support for specifying which AI model should be used for each task
  in the implementation plan, and we have also added an Effort column to help with estimation
  and planning purposes. This allows for better allocation of token budgets across different tasks.
```
Verbose, repetitive, hard to scan.

## Decision Flowchart

```
Change made?
  └─ User-visible? (feature, CLI, behavior, docs, version)
     └─ Yes → Check heuristics table
        ├─ CHANGELOG → Delegate to changelog-generator
        ├─ README → Delegate to documentation-writer
        ├─ User guide → Delegate to documentation-writer
        └─ No matches → Stop (no doc update needed)
     └─ No → Check if affects agents/workflow
        └─ Yes → Update CLAUDE.md pointer (documentation-writer) or key-context
        └─ No → Skip documentation
```

## Feature Guide (Post-Implementation Close-Out)

A feature guide is authored once — after all implementation phases complete — as part of the Wrap-Up step, not during Documentation Finalization.

**Location**: `.claude/worknotes/<feature-slug>/feature-guide.md`

**Delegation target**: `documentation-writer` (haiku)

**Frontmatter schema**:
```yaml
---
doc_type: feature_guide
feature_slug: "<feature-slug>"
prd_ref: <path>
plan_ref: <path>
spike_ref: <path or null>
adr_refs: []
created: <YYYY-MM-DD>
---
```

**Content sections** (≤200 lines total):
| Section | Purpose |
|---------|---------|
| What Was Built | 2-4 sentences on the capability delivered and motivation |
| Architecture Overview | Key files/layers; link to ADRs for significant decisions |
| How to Test | Per-edition instructions (local + enterprise); CLI/API examples |
| Test Coverage Summary | What is covered and at what level |
| Known Limitations | Deferred scope or intentional gaps |

**Audience**: Developer/stakeholder. Supplements the CHANGELOG entry with enough context for someone unfamiliar with the implementation to understand and exercise the feature.

**Token budget**: Delegate to `documentation-writer` with paths to the plan, CHANGELOG entry, and any ADR refs. Do not read those files into orchestrator context.

## When in Doubt

- Ask: "Will a user or developer need to know this changed?"
- If yes: Update documentation (via appropriate agent)
- If no: Skip documentation

Progressive disclosure means context files remain lightweight while detailed guidance lives in referenced documents.
