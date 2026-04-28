# Changelog

## Unreleased

- SKILL.md frontmatter added (`name`, `description`, `version`, `updated`, `spec`) per Claude Code skill convention.
- All 7 agent prompts in `agents/` now carry standard subagent frontmatter (`name`, `description`, `tools`, `model: sonnet`).
- SPEC.md rewritten under the v2 skill-spec convention (`schema_version: 2`, `doc_type: skill_spec`) with Capability Coverage matrix, 8 invariants, 8 backlog items, integration points, and success signals.
- Registered in `.claude/specs/skills-index.md`.

## 0.1.0

Initial Demo Foundry skill pack.

Included:

- primary skill instructions
- self-setup workflow
- dry-run/apply guardrails
- context update policy
- agent role prompts
- Playwright and Remotion templates
- demo manifest schema
- setup scripts
- quality checklists
- example scenario
