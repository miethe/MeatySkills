# Recipe: Project Triage

Trigger: user asks "how is this project", "what's the state", or similar project-health opener with agent reasoning in the loop.

## Steps

1. **Preflight.** `ccdash target show` (confirm scope). If preflight fails, drop into `recipes/unreachable-server.md`.

2. **Pull project status (JSON).**

   ```bash
   ccdash status project --json
   ```

   Echo into context: `project_id`, `generated_at`, `last_sync_at`, `feature_counts`, `risky_features`.

3. **Branch on health.**

   - **Healthy** (`risky_features` empty, no recent workflow failures, `feature_counts.blocked == 0`):
     Report a concise positive summary. Include counts and `generated_at`. Stop.
   - **Risky** (any of: non-empty `risky_features`, `recent_workflow_failures`, `feature_counts.blocked > 0`):
     Continue.

4. **Pick the top-signal risky feature.**
   Sort `risky_features` by `signal_score` descending. Pick the first. If none, but there are blocked features, pick the most recently updated blocked feature from `feature list --status blocked --json`.

5. **Pull feature detail.**

   ```bash
   ccdash feature show <feature_id> --json
   ```

   Echo: `feature_id`, `status`, `risk_signals`, `session_ids`, `workflow_ids`.

6. **Pull the feature's sessions.**

   ```bash
   ccdash feature sessions <feature_id> --json
   ```

   Sort by `cost` or `duration_seconds` descending to find the costliest recent session. Echo its `session_id`, `started_at`, `cost`.

7. **If workflow failures look related**, branch into `recipes/workflow-failure-rootcause.md` using `workflow_ids` from step 5.

8. **Summarize to the user.** One short paragraph: project health, the top-signal feature, why it's risky, the costliest session. End with the IDs so the user (or agent) can follow up: "Next step: `ccdash report aar --feature <id> --md` for a full retrospective, or drill a specific session."

## Provenance To Echo

`project_id`, `generated_at`, `last_sync_at`, `feature_id`, `session_id` (the costliest), `workflow_id` (if any).

## Anti-Patterns

- Do not run `report aar` in step 2 — it's heavy and narrative; the user asked for triage.
- Do not summarize every risky feature; pick one and go deep. Shallow breadth beats deep depth here.
- Do not paraphrase JSON into prose then reason from the prose — keep the JSON in context and cite IDs verbatim.

## Cross-Links

- `references/command-status.md`
- `references/command-feature.md`
- `recipes/feature-retrospective.md` (deeper dive on the picked feature)
- `recipes/workflow-failure-rootcause.md` (when workflow failures dominate)
