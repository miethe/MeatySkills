---
schema_version: 2
doc_type: skill_spec
skill_name: "{{SKILL_NAME}}"
skill_version: "0.1.0"
status: draft
created: "{{YYYY-MM-DD}}"
updated: "{{YYYY-MM-DD}}"
owner: "{{OWNER}}"
source_docs:
  - "{{PATH_TO_CANONICAL_DOC_1}}"
  - "{{PATH_TO_CANONICAL_DOC_2}}"
related_skills: []
affects_commands: []
# aligned_app_version: "{{X.Y.Z}}"  # optional: app version this skill was last verified against
---

<!-- Convention reference: .claude/specs/artifact-structures/skill-spec-convention.md -->
<!-- Template version: 1.0.0 | Fill in all {{PLACEHOLDER}} values before publishing -->
<!-- Remove all HTML comments before marking status: stable -->

# {{SKILL_NAME}} — Skill Specification

> **Reading this file**: This is the versioned capability contract for the `{{SKILL_NAME}}` skill.
> For invocation-time routing, see `SKILL.md` in this same directory.

---

## 1. Purpose & Scope

<!-- 
Write one paragraph describing what this skill enables agents to do and what problem it solves.
Then list in-scope capabilities and out-of-scope items clearly.
This section must NOT duplicate SKILL.md routing instructions.
-->

**Mission**: {{One sentence: what agents use this skill to accomplish.}}

**In scope**:
- {{Capability 1 — expressed as agent-facing intent}}
- {{Capability 2}}
- {{Capability 3}}

**Out of scope**:
- {{Thing agents might expect but is handled elsewhere — name the correct skill or doc}}
- {{Another out-of-scope item}}

---

## 2. Capability Coverage

<!-- 
Map every user/agent intent to the workflow file or SKILL.md section that handles it,
plus the canonical user or developer doc that provides authoritative command syntax.

Rules:
- Every intent row must have a non-null canonical doc if one exists.
- Add new rows here BEFORE shipping new workflows to SKILL.md.
- Mark deprecated intents as [deprecated] in the Intent column.

Intent phrasing should match what an agent or user would say ("how do I X").
-->

| Intent | Workflow / Section | Canonical Doc |
|--------|-------------------|---------------|
| {{Example: "Find an artifact by name"}} | `workflows/discovery-workflow.md` | `docs/user/guides/cli/commands.md#discovery` |
| {{Example: "Deploy artifact to project"}} | `workflows/deployment-workflow.md` | `docs/user/guides/cli/commands.md#deployment` |
| {{Add one row per addressable user intent}} | `{{path/to/workflow.md or SKILL.md §Section}}` | `{{docs/path/to/canonical.md#anchor}}` |

> When no canonical doc exists for an intent, write `—` in the Canonical Doc column and add a backlog entry (§4) to create one.

---

## 3. Invariants & Constraints

<!--
List non-negotiable behavioral rules agents must respect.
Each invariant should be testable: you should be able to state a pass/fail condition.
Do NOT list preferences or recommendations here — those live in workflow docs.
Breaking or removing an invariant requires a MAJOR version bump per the convention.
-->

1. **{{Invariant title}}**: {{Single testable statement. Example: "Agents must always check SKILL.md § Permission Protocol before executing write operations."}}

2. **{{Invariant title}}**: {{Single testable statement.}}

3. **{{Invariant title}}**: {{Single testable statement.}}

<!-- Add source reference when an invariant traces to a policy doc:
   _Source_: `.claude/rules/context-budget.md` invariant 3
-->

---

## 4. Enhancement Backlog

<!--
Track capability gaps, future improvements, and ideas from deprecated workflows.
Every entry needs a stable BL-N ID for cross-referencing.
Status options: candidate | planned | deferred | will-not-fix

When an enhancement is implemented, move it to the Changelog — do not delete it here.
-->

- **[BL-1] {{Enhancement title}}**: {{One-sentence description of the gap or improvement.}}
  _Status_: candidate
  _Rationale_: {{Why this is not implemented yet, or why it was deferred.}}

- **[BL-2] {{Enhancement title}}**: {{One-sentence description.}}
  _Status_: deferred
  _Rationale_: {{Defer reason, e.g., "Blocked on upstream CLI feature; revisit in Q3."}}

<!-- Example will-not-fix entry:
- **[BL-3] Auto-promote memory items**: Automatically promote candidate memory items to confirmed.
  _Status_: will-not-fix
  _Rationale_: Memory promotion requires human review to prevent low-confidence items polluting context.
-->

---

## 5. Changelog

<!--
Track SPEC.md version history — not the underlying skill implementation changes.
Implementation changes belong in git commit messages.
Format: ### vMAJOR.MINOR.PATCH — YYYY-MM-DD
First entry is always the initial draft.
-->

### v0.1.0 — {{YYYY-MM-DD}}
- Initial SPEC.md drafted
- Capability coverage matrix: {{N}} intents across {{M}} workflows
- Status: draft

---

## 6. Integration Points

<!--
List which agents and commands load or depend on this skill.
Include both direct invocations (Skill("name")) and indirect dependencies (e.g., loaded by /dev:execute-phase).
If no agents currently use this skill, write "None documented yet."
-->

| Agent / Command | Invocation Pattern | Notes |
|-----------------|--------------------|-------|
| `{{agent-name}}` | `Skill("{{skill-name}}")` | {{When / why this agent uses the skill}} |
| `{{/command:name}}` | Loads via `Skill("{{skill-name}}")` | {{Context, e.g., "required before phase execution"}} |

<!--
Also note any sibling skills this skill expects to be loaded alongside:
**Co-loaded with**: `artifact-tracking` (required for progress updates)
-->

---

## 7. Success Signals

<!--
3–7 observable indicators that this skill is working correctly.
These are heuristics for maintainers and reviewers, not formal tests.
Focus on: agent behaviors, output quality, token efficiency, error reduction.
-->

- {{Example: "Agents route to the correct workflow file on the first attempt, without re-reading SKILL.md."}}
- {{Example: "Canonical doc links in the Capability Coverage table resolve without 404s."}}
- {{Example: "Agents do not ask clarifying questions about permission requirements — invariants are clear."}}
- {{Example: "Token usage for a typical intent stays under X tokens because agents land on the right workflow directly."}}
- {{Add 1–3 more success signals specific to this skill's domain.}}
