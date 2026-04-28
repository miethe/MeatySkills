# Recipe: Feature Retrospective

Trigger: "AAR for FEAT-X", "retrospective on FEAT-X", "why did FEAT-X take so long?", "what happened with FEAT-X?"

## Transport Choice

- Prefer MCP when the workspace `ccdash` server is discoverable and the result is being consumed by the agent.
- Fall back to the CLI when MCP is unavailable or when the user explicitly wants CLI markdown/human output.

Equivalent shipped surfaces:

- MCP: `ccdash_feature_forensics`, `ccdash_generate_aar`
- CLI: `ccdash feature report FEATURE_ID`, `ccdash report aar --feature FEATURE_ID`

## Steps

1. **Resolve the feature ID.** If the user gives a title instead of an ID, ask for the exact `feature_id` or use the broader project-status/feature-forensics context already available in CCDash. Do not route through stale `feature list` or `feature sessions` commands that are not part of the shipped in-repo CLI.

2. **Pull feature forensics first to anchor the story.**

   Preferred MCP:

   - call `ccdash_feature_forensics`

   CLI fallback:

   ```bash
   ccdash feature report FEATURE_ID --json
   ```

   Echo the stable provenance you receive: `feature_id`, `project_id`, `generated_at`, `data_freshness`, and the key evidence refs that explain the retrospective.

3. **Generate the AAR.**

   Preferred MCP:

   - call `ccdash_generate_aar`

   CLI fallback:

   ```bash
   ccdash report aar --feature FEATURE_ID --md
   ```

4. **Render the retrospective in the format the user asked for.**

   - If you used CLI markdown output, render it directly.
   - If you used MCP or CLI JSON, summarize only the evidence-backed points that explain duration, rework, or failure burden.
   - Keep the retrospective anchored to the returned evidence refs and freshness fields.

5. **Offer one precise follow-up only when useful.**

   Examples:
   - "Want the current-state feature forensics instead of the retrospective narrative?"
   - "Want the workflow-failure view for the same project to see whether the delay was part of a broader pattern?"

## Provenance To Echo

- `feature_id`
- `project_id`
- `generated_at`
- `data_freshness`
- `source_refs`

## Anti-Patterns

- Do not claim there is a canonical `feature sessions` CLI command in the current repo.
- Do not invent session-level drilldowns or task-level subcommands that the current CLI does not ship.
- Do not route runtime-health questions through this recipe; use `recipes/unreachable-server.md` instead.
- Do not describe MCP as deferred. It is shipped and should be preferred for in-workspace agent use.

## Cross-Links

- [SKILL.md](/Users/miethe/dev/homelab/development/CCDash/.claude/skills/ccdash/SKILL.md)
- [docs/guides/mcp-setup-guide.md](/Users/miethe/dev/homelab/development/CCDash/docs/guides/mcp-setup-guide.md)
- [docs/guides/mcp-troubleshooting.md](/Users/miethe/dev/homelab/development/CCDash/docs/guides/mcp-troubleshooting.md)
