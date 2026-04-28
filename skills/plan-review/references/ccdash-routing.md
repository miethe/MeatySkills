# CCDash Routing for Plan Review

How to pull post-implementation data from CCDash during a `plan-review`. Mirrors the routing posture in `.claude/skills/ccdash/SKILL.md` but scoped to the retrospective use case.

## Transport Order

1. **Prefer MCP** when the workspace `ccdash` server is discoverable (check `.mcp.json` for `ccdash` entry).
2. **Fall back to CLI** when MCP is unavailable or returns errors.
3. **Skip gracefully** if neither is available — record `ccdash_data: null` in the retrospective and continue with git-only analysis. CCDash data is supplementary, not required.

## Tools to Call (in order)

### 1. Feature Forensics — narrative anchor

Pulls the headline data: total sessions, duration, failure burden, top categories.

- **MCP**: `ccdash_feature_forensics({feature_id: "<slug>"})`
- **CLI**: `ccdash feature report <slug> --json`

Echo `feature_id`, `project_id`, `generated_at`, `data_freshness` into the retrospective's CCDash Provenance section.

### 2. AAR Generation — narrative

Pulls the formatted After-Action Report. Use this for human-readable context, not for numeric extraction.

- **MCP**: `ccdash_generate_aar({feature_id: "<slug>"})`
- **CLI**: `ccdash report aar --feature <slug> --md`

Quote 1–3 sentences in the retrospective's Summary section if they materially explain the variance (e.g., "AAR notes 4 sessions ended with rollback during Phase 3 — corroborates H3 algorithmic flag").

### 3. Workflow Failure Patterns — only if failure burden >20%

If the forensics report shows a high failure rate, pull the failure breakdown to see whether overruns came from rework rather than estimation.

- **MCP**: `ccdash_workflow_failure_patterns({feature_id: "<slug>"})`
- **CLI**: `ccdash workflow failures --feature <slug>`

High failure burden often signals **discovery_work** or **scope_change**, not heuristic failure — adjust attribution accordingly.

## What CCDash Does NOT Provide

- Per-phase SP estimates (those live in the implementation plan).
- The "Estimation Sanity Check" content (lives in the plan).
- Heuristic-failure attribution (this skill computes it).
- Per-file LOC stats (use `git diff --stat`).

CCDash is the **session/effort lens**; the plan + git is the **scope lens**. Both feed the retrospective.

## Anti-Patterns

- Do not invent CCDash CLI subcommands not shipped in this repo (per `.claude/skills/ccdash/SKILL.md` — current shipped: `status`, `feature report`, `workflow`, `report`).
- Do not rely solely on CCDash effort estimates — cross-check against git LOC and wall-clock duration.
- Do not treat CCDash absence as a blocker — the retrospective is valuable on git data alone.

## Cross-Links

- `.claude/skills/ccdash/SKILL.md` — full CCDash routing reference
- `.claude/skills/ccdash/recipes/feature-retrospective.md` — CCDash's own AAR recipe (which this skill extends with heuristic-tuning analysis)
