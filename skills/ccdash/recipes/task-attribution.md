# Recipe: Task Attribution — Which Agent Worked on What

Trigger: "who worked on FEAT-X", "which agent owned task Y", "break down work by agent role for FEAT-X", "attribute sessions to tasks".

## Steps

1. **Resolve the feature ID.** If the user gave a title, narrow with keyword search first:

   ```bash
   ccdash feature list --q "KEYWORD" --json
   ```

   Check `truncated` and `total`. If `truncated: true`, add `--status` or a more specific `--q` to reduce the set. Pick the matching `feature_id`.

2. **Pull full feature detail.**

   ```bash
   ccdash feature show FEATURE_ID --json
   ```

   Echo: `feature_id`, `status`, `generated_at`.

3. **Extract task ownership from `linked_tasks`.**

   Inspect `linked_tasks[]` in the JSON. Each entry carries:

   ```json
   {
     "task_id": "TASK-42",
     "title": "Implement retry logic",
     "owner": "agent:backend-specialist",
     "status": "done"
   }
   ```

   - `owner` is the agent-role attribution field. Group tasks by `owner` to produce a per-agent work breakdown.
   - If `linked_tasks` is empty or `owner` is null for most entries, the project may not use task-level attribution — fall back to session-level inference in step 4.
   - Note: `linked_tasks` comes from the same snapshot as `feature show`; it may lag the sync engine if data was recently imported.

4. **Correlate with sessions for richer signal.**

   ```bash
   ccdash feature sessions FEATURE_ID --json
   ```

   This is the canonical, always-fresh sessions surface. Each session entry includes `session_id`, `model`, `cost`, `started_at`, `ended_at`, and summary fields. Cross-reference session timestamps against task `started_at` / `completed_at` (if present) to infer which agent session drove each task. When `owner` is present on tasks, use it directly — session correlation is supplementary.

5. **Synthesize the attribution summary.**

   Produce a table or bullet list: agent role → tasks owned → session IDs active during those tasks. Example format:

   ```
   agent:backend-specialist  → TASK-42 (done), TASK-45 (done)   → sess_abc, sess_def
   agent:frontend-dev        → TASK-43 (in-progress)             → sess_ghi
   (unattributed)            → TASK-44                           → —
   ```

   Surface unattributed tasks explicitly so the operator knows where ownership data is missing.

## Command Sequence (minimal)

```bash
# 1. Find the feature
ccdash feature list --q "authentication" --json

# 2. Pull task ownership
ccdash feature show FEAT-123 --json
# → inspect linked_tasks[].owner

# 3. Correlate with sessions
ccdash feature sessions FEAT-123 --json
# → cross-reference timestamps
```

## Provenance To Echo

- `feature_id`, `generated_at` (from `feature show`).
- All `task_id` values with their `owner` fields.
- Top session IDs used in correlation.

## Gotchas

- `linked_tasks[].owner` may be null if the project's task tracker does not populate agent-role fields. In that case, session-level inference from step 4 is the best available signal.
- `feature show`'s `linked_sessions` field may lag; always use `feature sessions` (step 4) for fresh session data.
- Keyword search (`--q`) matches name/title only — brittle for multi-word queries. Use `--status` to pre-filter if the result set is large.

## Cross-Links

- `references/command-feature.md` — `feature show` and `feature sessions` field details.
- `references/provenance.md` — IDs to echo into agent context.
- `recipes/feature-retrospective.md` — broader retrospective flow using the same base commands.
- `recipes/session-cluster-investigation.md` — drill into specific sessions after attribution.
