# Recipe: Task Attribution — Which Agent Worked on What

Trigger: "who worked on FEAT-X", "which agent owned this feature", "break down work by agent role", "attribute work on FEAT-X".

## Constraint

The shipped CCDash repo does not expose the older task/session attribution CLI flow described in stale skill docs. Use the feature-forensics surface that exists today, and make clear when attribution is inferred rather than explicit.

Preferred transport:

- MCP: `ccdash_feature_forensics`

CLI fallback:

```bash
ccdash feature report FEATURE_ID --json
```

## Steps

1. **Resolve the feature ID.** If the user gives only a title, ask for the exact `feature_id` unless the surrounding CCDash context already disambiguates it.

2. **Pull feature forensics.** Use MCP first when available; otherwise use the CLI fallback above.

3. **Look for explicit ownership signals in the returned evidence.**

   Prioritize fields and evidence that directly identify:

   - linked tasks or task owners
   - evidence refs naming the contributing agent or role
   - workflow/problem summaries tied to a specific execution path
   - generated narrative that clearly attributes work

4. **If explicit ownership is missing, state that attribution is inferred.**

   Base the inference on the returned evidence only. Acceptable phrasing:

   - "The current feature-forensics payload does not carry explicit task-owner fields, but the evidence suggests `<agent/role>` drove the main work."
   - "Ownership is partially attributable from the feature evidence; some work remains unattributed in the current surface."

5. **Produce a compact attribution summary.**

   Recommended format:

   ```text
   explicit owner: <agent or role> -> <evidence-backed work>
   inferred contributor: <agent or role> -> <why the evidence suggests this>
   unattributed: <gaps or missing signals>
   ```

6. **Offer a better-supported adjacent view when attribution is weak.**

   Usually:
   - a feature retrospective (`report aar`)
   - workflow failure patterns for the same project

## Provenance To Echo

- `feature_id`
- `project_id`
- `generated_at`
- `data_freshness`
- `source_refs`

## Gotchas

- Do not reference `linked_tasks[].owner` as if it is a guaranteed field in the current shipped skill contract.
- Do not reference stale CLI commands such as `feature sessions`, `session drilldown`, or target-management flows.
- Keep the distinction between explicit attribution and inference visible to the user.

## Cross-Links

- [SKILL.md](/Users/miethe/dev/homelab/development/CCDash/.claude/skills/ccdash/SKILL.md)
- [recipes/feature-retrospective.md](/Users/miethe/dev/homelab/development/CCDash/.claude/skills/ccdash/recipes/feature-retrospective.md)
