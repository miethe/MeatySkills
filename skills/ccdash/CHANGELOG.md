# ccdash skill — CHANGELOG

One-line-per-change log. Append a dated entry whenever the skill routing surface or reference files change to track CLI.

## 2026-04-14

- Initial skill layout (Phases 1-3 complete): SKILL.md, router-table.json, references for all CLI groups (status, doctor, target, workflow, feature, session, report, cli-overview, install-setup, output-modes, provenance, eval-scenarios), recipes (unreachable-server, target-onboarding, project-triage, feature-retrospective, workflow-failure-rootcause, session-cluster-investigation), and preflight.sh. Tracks CLI surface as of 2026-04-13 (ccdash-cli with target/doctor/status/workflow/feature/session/report command groups). PRD: .claude/skill-specs/ccdash-skill/prd.md.
- First-run findings incorporated: SKILL.md gained "Known Expensive Endpoints" callout (`status project`, `report aar`, `report feature`, `workflow failures`) warning that the CLI hardcodes a 30 s timeout with no override. `recipes/unreachable-server.md` extended with a triage step and an "Endpoint timeout branch" distinguishing transport failure (server down) from endpoint timeout (server healthy, command too slow; doctor reports PASS false-negative). Added `recipes/blog-retrospective-research.md` codifying the `feature list → feature show → feature sessions` pattern as the supported fallback when `report aar` is unavailable. No router-table changes; no new CLI surface. Findings source: `/Users/miethe/Documents/Other/PKM/MeatyBrain/Blogs/Dev Stories/Bonus B2/notes/ccdash/ccdash-skill-findings.md`.
