---
schema_version: 2
doc_type: exploration_charter
title: "[Idea Name] — Exploration Charter"    # Idea name + " — Exploration Charter"
status: draft                                  # draft | in-progress | concluded
created: YYYY-MM-DD
feature_slug: kebab-slug-here                 # Kebab-case; matches exploration directory name
timebox_days: 3                               # Mandatory; default 3; hard max 7
hypothesis: "We believe [X] is worth building because [Y]."   # One falsifiable sentence
deal_killer: "If [Z] is true, abandon immediately."           # Mandatory; validator enforces this field
investigation_legs:                           # 1–4 legs; each needs id, question, assigned_to
  - id: tech
    question: "Is [X] technically feasible within the existing layered architecture?"
    assigned_to: spike-writer
  - id: value
    question: "Do users currently work around the absence of [X]?"
    assigned_to: ux-researcher
verdict_criteria:                             # Define exit gates BEFORE investigation starts
  go:
    - "All investigation legs report confidence >= 0.7"
    - "Deal-killer condition not triggered"
  no_go:
    - "Deal-killer condition triggered"
    - "Technical leg reports infeasibility with confidence >= 0.8"
  conditional:
    - "Open question(s) remain resolvable by a specific named subsequent investigation"
verdict: null                                 # null until concluded; enum: go | no-go | conditional
verdict_rationale: null                       # null until concluded; one paragraph citing leg findings
output_artifacts: []                          # Populated as legs land; list paths to SPIKE outputs
---

# [Idea Name] — Exploration Charter

<!-- Copy to docs/project_plans/exploration/[feature-slug]/[feature-slug]-charter.md -->
<!-- Use /plan:explore to scaffold most fields from an idea description. -->

## Hypothesis Context

<!-- Expand the hypothesis here: signals observed, user pain, adjacent evidence, counterfactual. 2–4 sentences. -->

[Why does this exploration exist? What evidence supports the hypothesis?]

---

## Investigation Legs

<!-- One subsection per leg. Each leg runs as a SPIKE via /plan:spike --leg-of=[charter-path]. -->
<!-- Add/remove subsections to match investigation_legs entries. -->

### Leg: [id] — [Name]

**Question**: [question from frontmatter]
**Assigned to**: `[assigned_to]`
**Expected output**: `docs/project_plans/exploration/[slug]/spikes/[id]-spike.md`

<!-- Specific unknowns, constraints, or sources this leg must address: -->
- [Unknown / source 1]

---

## Verdict Criteria Narrative

<!-- Make each gate concrete so any agent can apply it consistently. -->

**Go** if: [describe what evidence satisfies the go gates].
**No-go** if: [describe what evidence triggers abandonment].
**Conditional** if: [name the unresolved question and the specific next step].

---

## Out of Scope

- [Excluded area 1]
- [Excluded area 2]

---

## Citations / Prior Art

<!-- Back-links to past explorations, SPIKEs, ADRs, or external references consulted before starting. -->
- [Reference 1]

---

## Notes

<!-- Append timestamped entries as legs complete. Format: YYYY-MM-DD: [note]. -->
