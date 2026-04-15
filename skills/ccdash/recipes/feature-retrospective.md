# Recipe: Feature Retrospective

Trigger: "AAR for FEAT-X", "retrospective on FEAT-X", "why did FEAT-X take so long?", "what happened with FEAT-X?"

## Steps

1. **Preflight.** Verify `feature_id` looks well-formed. If the user gave a title instead, run `ccdash feature list --json` and pick the match (ask if ambiguous).

2. **Pull feature detail (JSON) to anchor the story.**

   ```bash
   ccdash feature show FEATURE_ID --json
   ```

   Echo: `feature_id`, `status`, `session_ids`, `workflow_ids`, `document_ids`, `risk_signals`, `created_at`, `updated_at`.

3. **Pull the session set.**

   ```bash
   ccdash feature sessions FEATURE_ID --json
   ```

   Sort by `cost` (or `duration_seconds`) descending. Note the top 3 sessions for later citation. Echo the highest-cost `session_id` and its `model`, `cost`, `started_at`.

4. **Generate the AAR (markdown).**

   ```bash
   ccdash report aar --feature FEATURE_ID --md
   ```

   **Render verbatim** to the user. The server-side template already synthesizes the session set into a curated narrative. Do not re-summarize above or below the report — the report is the deliverable.

5. **Offer optional follow-ups** (1-2 bullets max, appended after the rendered report):

   - "Want me to drill into session X for <concern>?" (only if a top session shows a relevant risk signal from step 2).
   - "Want the narrative `report feature` variant instead?" (if they wanted current-state, not retrospective).

## Provenance To Echo

- `feature_id`, `generated_at` (from the AAR footer).
- Top 3 `session_ids` with cost (in your working context, even if the AAR covers them).

## Anti-Patterns

- Do not summarize the AAR. Render it. Operators and reviewers read it directly.
- Do not chain `session drilldown` proactively — wait for a follow-up ask. AAR is the terminal step here.
- Do not re-run `report aar` if the first call succeeded but the user asked a tangential question — answer from the JSON variant of `feature show` or `feature sessions` instead.

## Cross-Links

- `references/command-report.md`
- `references/command-feature.md`
- `recipes/workflow-failure-rootcause.md` (if follow-up is about workflow failures)
- `recipes/session-cluster-investigation.md` (if follow-up is about a specific session cluster)
