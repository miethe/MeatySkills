# Recipe: Session Cluster Investigation

Trigger: "what happened across session SESS-X's siblings?", "did the agent retry this?", "show me the cluster around SESS-X".

A cluster is a set of sessions sharing the same `root_session_id` — typically a main run plus its resumes, branches, or parallel agents.

## Steps

1. **Anchor on the named session.**

   ```bash
   ccdash session show SESS_ID --json
   ```

   Echo `session_id`, `root_session_id`, `feature_id`, `cost`, `risk_signals`.

2. **Pull the full family.**

   ```bash
   ccdash session family SESS_ID --json
   ```

   Note the `sessions` array: count, earliest `started_at`, latest `ended_at`, total cost across the cluster. Identify the anchor session's position (first, middle, last).

3. **Branch on cluster size.**

   - **1 session (no siblings)** → the user asked the wrong question; tell them, offer `session drilldown` on the single session.
   - **2-5 sessions** → drilldown each non-anchor session on its dominant concern (see step 4). Full coverage is tractable.
   - **>5 sessions** → drilldown only the anchor + the 2 highest-cost siblings. Note the skipped count in the summary.

4. **Pick concern per session.**
   Use `risk_signals` from `session show` (run per sibling if not already cached). Default to `--concern churn` when signals are flat.

5. **Run drilldowns.**

   For each chosen session:

   ```bash
   ccdash session drilldown SIBLING_ID --concern <concern> --json
   ```

   Echo `findings` + top 1-2 `evidence_line_refs` per session.

6. **Synthesize the cluster story.**

   Structure (4-6 bullets):

   - Cluster overview: `root_session_id`, count, total cost, feature link.
   - Timeline: first → last, duration.
   - Per-session one-liner: what that run accomplished, cost, dominant concern finding.
   - Pattern across the cluster (if any): repeated churn on same files, escalating sentiment, scope drift after resume N.
   - Suggested next action (open the feature AAR, dig a specific error via `session search`, etc.).

## Provenance To Echo

`root_session_id`, all `session_ids` considered, `feature_id`, `generated_at` per drilldown.

## Anti-Patterns

- Do not drilldown every session unconditionally for large clusters — token cost blows up.
- Do not confuse a "family" (shared root) with "linked to same feature" (broader). Use `session family` for root-based, `feature sessions` for feature-based.
- Do not render the raw drilldown JSON to the user. Summarize findings and cite evidence line refs.

## Cross-Links

- `references/command-session.md`
- `recipes/workflow-failure-rootcause.md` (when the cluster is driven by a failing workflow)
- `recipes/feature-retrospective.md` (when the user wants the whole feature, not just the cluster)
