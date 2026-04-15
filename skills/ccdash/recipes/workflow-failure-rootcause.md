# Recipe: Workflow Failure Root-Cause

Trigger: "Which workflows are failing?", "why is workflow X flaky?", "root-cause this test failure".

## Steps

1. **Pull the failure burden (JSON).**

   ```bash
   ccdash workflow failures --json
   # or scoped to a feature
   ccdash workflow failures --feature FEATURE_ID --json
   ```

   Echo: top 3 entries by `burden_score` — `workflow_id`, `failure_count`, `last_failure_at`, `feature_ids`, first `linked_session_ids`.

2. **Pick the target workflow.**
   - User specified one → use it.
   - Otherwise → pick the highest `burden_score`.

3. **Pick the most relevant failing session.**
   Use the first entry from the chosen workflow's `recent_failure_summaries`. Note its `session_id`.

4. **Session context.**

   ```bash
   ccdash session show SESSION_ID --json
   ```

   Echo `session_id`, `root_session_id`, `feature_id`, `risk_signals`. If `risk_signals` includes `churn` or `scope_drift` entries tied to the failure, note those too.

5. **Drilldown on the failure's dominant concern.**

   Pick a concern based on signals:

   - High `churn` score → `--concern churn`.
   - `scope_drift` flagged → `--concern scope_drift`.
   - Tone-heavy error patterns (frustration / confusion) → `--concern sentiment`.
   - Default when ambiguous → `--concern churn` (most diagnostic for test failures).

   ```bash
   ccdash session drilldown SESSION_ID --concern churn --json
   ```

   Echo `findings` and `evidence_line_refs`.

6. **(Optional) Search transcripts.**

   If findings reference a specific error string that would help the user, run:

   ```bash
   ccdash session search "<error_substring>" --session SESSION_ID --json
   ```

7. **Summarize root cause to the user.**

   Structure (3-5 bullets):

   - Workflow + burden score.
   - Representative failing session (with `session_id`, `feature_id`, `timestamp`).
   - Top finding from drilldown + 1-2 evidence line refs.
   - Suggested next action (fix, retry, dive deeper into sibling sessions via `session family`).

## Provenance To Echo

`workflow_id`, `session_id`, `root_session_id`, `feature_id`, `concern`, `generated_at`.

## Anti-Patterns

- Do not drill every failing session — pick one and go deep. If the user wants multiple, they'll ask.
- Do not skip the `session show` step; `drilldown` findings are much clearer with surrounding context.
- Do not substitute `report aar` for this recipe — AAR is per-feature and retrospective, not per-workflow-failure and diagnostic.

## Cross-Links

- `references/command-workflow.md`
- `references/command-session.md`
- `recipes/session-cluster-investigation.md` (when the failure is one of many siblings)
