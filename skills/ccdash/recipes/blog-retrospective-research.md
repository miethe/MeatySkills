# Recipe: Blog / Retrospective Research

Use when the user wants retrospective or narrative content about one or more features — blog posts, AARs, post-mortems, "what did we ship in Wave X" roll-ups — and `report aar` / `status project` / `workflow failures` are unavailable or timing out (see `SKILL.md` "Known Expensive Endpoints"). The cheap per-feature endpoints return ~80% of the same content deterministically.

## Preconditions

- `ccdash doctor` reports `PASS` (server reachable).
- You know either a feature slug / ID, a topic keyword, or a time window the user cares about.

If you know none of these, ask the user before running anything — blind `feature list` on a large project burns tokens.

## Flow

### 1. Build the candidate map

```bash
ccdash feature list --json > /tmp/ccdash-features.json
```

Save raw JSON to `/tmp/`; you will re-parse it multiple times. Default is to return all features; add `--status active` / `--category <cat>` if the user scoped it.

Filter client-side for candidates. Typical filters:

- **By topic** — grep the `name` / `category` fields for keywords (`"tenant"`, `"auth"`, `"migration"`).
- **By time** — filter `updated_at` within the user's window.
- **By volume** — sort by `session_count` or `task_count` desc; the top N are usually the blog-worthy ones.

If the topic keyword doesn't match any feature name, fall back to:

```bash
ccdash session search "<keyword>" --json
```

Session search hits transcripts, which often carry the real names of refactors / initiatives that never got a feature slug.

### 2. Pull per-feature forensics (parallel)

For each candidate (2–5 is the usual batch size), run in parallel:

```bash
ccdash feature show <id> --json   > /tmp/feat-<id>-show.json
ccdash feature sessions <id> --json > /tmp/feat-<id>-sessions.json
# Optional, if the retrospective needs PRD / plan / progress docs:
ccdash feature documents <id> --json > /tmp/feat-<id>-docs.json
```

Together these yield: `iteration_count`, `total_cost`, `total_tokens`, `workflow_mix`, `rework_signals`, `failure_patterns`, `linked_sessions`, `linked_documents`, `summary_narrative`, and per-session `model`, `duration`, `cost`, `tokens`, `tool_names`, `status`.

**Payload gotcha:** `feature show` returns `feature_slug` and `feature_status` at the top level, *not* `name` / `status`. `feature list` does return `name` / `status`. Normalize when cross-referencing.

### 3. Drill into high-signal sessions (optional but high-leverage)

Pick the 2–3 longest-running or highest-cost sessions per feature and call:

```bash
ccdash session show <session_id> --json
```

That is where the "moment of decision" narratives live. Skip this step if the user only wants quantitative roll-ups.

For sibling / parallel-delegation context:

```bash
ccdash session family <session_id> --json
```

### 4. Synthesize

Cross-reference `rework_signals` and `failure_patterns` against any quality claims the user is making in the draft. CCDash surfaces `multiple_sessions`, `tool_error`, `non_completed_session` as real-and-important signals — a draft claiming "clean parallel execution" should be checked against these before publishing.

## Output Mode

All steps use `--json` — the agent is doing the synthesis, not the CLI. Render the final narrative to the user as markdown from the agent's own composition, not from a CLI command.

## Provenance To Echo

- `feature_id`, `feature_slug`, `updated_at` (per candidate)
- `session_id`, `started_at`, `ended_at`, `cost`, `duration_seconds` (per drilled-in session)
- Any `document_id` referenced, for citation

## Do Not

- Run `ccdash report aar --feature <id>` as the first call. It is known-expensive and hits the 30 s client timeout on non-trivial features. Use this recipe instead, then run `report aar` only if the user explicitly wants the server-rendered artifact.
- Re-run `feature show` multiple times for the same ID — re-parse the saved JSON in `/tmp/`.
- Paginate `feature list` without a filter on projects with hundreds of features; scope by status or category first.

## Cross-Links

- `recipes/feature-retrospective.md` — the "report aar is healthy" version of this flow.
- `recipes/unreachable-server.md` "Endpoint timeout branch" — route here when `report aar` times out.
- `references/command-feature.md`, `references/command-session.md`.
