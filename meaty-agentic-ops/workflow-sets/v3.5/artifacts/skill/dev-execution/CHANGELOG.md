# Changelog — dev-execution

## v1.1 — 2026-07-29

- **Add the `plan-optimization` mode** (risk-classed reviewer-gate selection at the plan/execute
  boundary): new `modes/plan-optimization.md` (the pre-dispatch procedure) + `references/gate-risk-classes.md`
  (risk-class → reviewer-lens ruleset, verbatim defect checklist, cost calibration, and the RF
  Operator MCP P1 worked example). Wired into the Execution Modes dispatch table and the Mandatory
  Reviewer Gates section. Emits advisory `gate_lens`/`gate_shared_with` keys per phase, a duplicate-lens
  report, a paste-ready defect checklist, a cheap pre-gate before each security lens, and a
  cost/inversion projection. Never removes the only lens a phase's risk class requires.
  Spec: `docs/skill-development/plan-optimizer/spec.md`. Grounding: RF Operator MCP P1 execution retro.
- **First validator-conformant version.** Added `version`/`app_version`/`updated` frontmatter, this
  CHANGELOG, and the required `When NOT To Use` + `Deferred / Do Not Say` + absolute `Key References`
  sections. Clears all 6 `skill-dev` `validate_skill.py` FAILs (mirror-parity + ≤500-line WARNs remain;
  mirror parity is skillmeat-generated on codex deploy).
