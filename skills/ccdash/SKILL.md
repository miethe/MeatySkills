---
name: ccdash
description: Drive the standalone CCDash CLI from natural language to answer questions about project status, feature forensics, agent sessions, workflow failures, and after-action reports. Use when the operator or another agent asks about CCDash project health, agent-session analytics ("why did FEAT-X take so long", "what sessions ran for this feature", "which workflows are failing"), wants an AAR / narrative feature report, or needs help installing / authenticating the `ccdash` CLI against a target server. Routes intent to `ccdash` subcommands with the right `--output` mode, echoes provenance IDs for chaining, and degrades gracefully through `ccdash doctor` on transport/auth failures. Do not use for unrelated coding tasks, writing UI components, or anything outside CCDash project/session intelligence.
---

# ccdash Skill

A thin natural-language router over the standalone `ccdash` CLI. The CLI is authoritative; this skill decides which subcommand to run, which `--output` mode to pick, and how to chain calls using provenance IDs.

## When To Use

Trigger on intents such as:

- "What's the state of this project?" / "project status" / "project summary"
- "Why did FEAT-X take so long?" / "retrospective on FEAT-X" / "AAR for FEAT-X"
- "Which workflows are failing?" / "failure burden" / "flaky workflows"
- "Show sessions for FEAT-X" / "search session transcripts for Y" / "drilldown sentiment on session Z"
- "Install ccdash" / "set up ccdash against staging" / "log in to the staging target"
- Connectivity / auth error messages mentioning `ccdash`, `CCDASH_TARGET`, or an HTTP failure against a CCDash server.

## When NOT To Use

- General coding tasks unrelated to CCDash observability (building UI, editing backend code, unrelated debugging).
- Questions about other CLIs or platforms even if phrased as "project status" (e.g. Linear, GitHub, Vercel).
- Authoring new CCDash reports, workflows, or analytics queries — this skill only invokes existing commands.
- MCP tool invocation — deferred until the CCDash MCP surface ships; see the parent enablement plan (Phase 4 of this skill).

## Preflight (run once per session on uncertainty)

```bash
ccdash --version            # verify install; if missing -> recipes/target-onboarding.md
ccdash target show          # confirm active target + auth mode
```

If `ccdash` is not on PATH or `target show` errors: follow `recipes/target-onboarding.md`.
If a subsequent command returns a connection or 401/403 error: follow `recipes/unreachable-server.md` before surfacing the raw error.

## Known Gotchas

- **`feature list` default limit is 200** (raised from 50 in phase 5). Results may still be truncated — check for `"truncated": true` and `"total"` in JSON; surface both values to the user. Use `--q KEYWORD` to narrow before paginating.
- **Two `linked_sessions` surfaces exist.** `feature show` returns `linked_sessions` (may lag behind the sync engine). `feature sessions FEATURE_ID` is canonical and always fresh. The DTO carries a `sessions_note` hint field when lag is detected. For fresh data, always prefer `feature sessions`.
- **Keyword search (`--q`) is substring-only.** Case-insensitive match against feature name/title only — brittle for multi-word queries. Fall back to `feature show` for detail or use `--status` / `--category` filters to narrow first.
- **CLI timeout is 30 s by default.** Override per-invocation with `--timeout N` (seconds) or globally via `CCDASH_TIMEOUT=N`. `ccdash doctor` reports the active value and its source. See `docs/guides/cli-timeout-debugging.md` for slow-query diagnosis.
- **Query cache: 4 agent-query endpoints are cached with a 60 s TTL** (`CCDASH_QUERY_CACHE_TTL_SECONDS`; background refresh interval `CCDASH_QUERY_CACHE_REFRESH_INTERVAL_SECONDS`). Append `--no-cache` when immediate consistency is required (e.g. right after a sync or data import).

## Known Expensive Endpoints

The following commands run synchronous cross-domain aggregations on the server and routinely exceed the default 30 s timeout on non-trivial datasets. Use `--timeout N` or `CCDASH_TIMEOUT=N` to raise the ceiling before invoking them:

- `ccdash status project`
- `ccdash report aar --feature <id>`
- `ccdash report feature <id>`
- `ccdash workflow failures`

Before invoking them, warn the user that they may time out and offer the decomposed fallback in `recipes/blog-retrospective-research.md` (for retrospectives) or the `feature list` + client-side filter pattern (for status / workflow roll-ups). If they *do* time out, doctor will still report `PASS` — that is a false negative, not a green light. Route through the "Endpoint timeout branch" in `recipes/unreachable-server.md`.

The cheap, reliable-today set: `ccdash target *`, `ccdash doctor`, `ccdash feature list|show|sessions|documents`, `ccdash session list|show|search|drilldown|family`.

## Routing

The authoritative intent -> command map lives in `scripts/router-table.json`. Load it for disambiguation; the summary below is a lossy render kept for quick scanning.

| Intent | Command | Default `--output` | Reference |
|---|---|---|---|
| Project status | `ccdash status project` | `json` (agent) / `human` (operator) | `references/command-status.md` |
| Doctor / diagnose | `ccdash doctor` | `human` | `references/command-doctor.md` |
| Install / onboard | `pipx install ccdash-cli`, then `target add` | `human` | `references/install-setup.md` |
| Target management | `ccdash target {list,add,use,show,remove,login,logout,set-token,check}` | `human` | `references/command-target.md` |
| Workflow failures | `ccdash workflow failures` | `json` | `references/command-workflow.md` |
| Feature list / show / sessions / documents | `ccdash feature {list,show,sessions,documents}` | `json` | `references/command-feature.md` |
| Session list / show / search / drilldown / family | `ccdash session {list,show,search,drilldown,family}` | `json` | `references/command-session.md` |
| AAR / narrative report | `ccdash report {aar,feature}` | `markdown` | `references/command-report.md` |

Output-mode decision rules live in `references/output-modes.md`. Provenance fields to echo back into agent context live in `references/provenance.md`.

## Multi-Step Flows (Recipes)

Multi-step investigations use deterministic recipes in `recipes/`:

- `recipes/project-triage.md` — `status project` -> risky feature -> `feature show` -> `feature sessions`.
- `recipes/feature-retrospective.md` — `feature show` -> `feature sessions` -> `report aar`.
- `recipes/workflow-failure-rootcause.md` — `workflow failures` -> pick workflow -> `session drilldown --concern`.
- `recipes/session-cluster-investigation.md` — `session show` -> `session family` -> drilldown each sibling.
- `recipes/unreachable-server.md` — transport/auth failure + endpoint-timeout interpretation via `ccdash doctor`.
- `recipes/target-onboarding.md` — fresh operator: install -> `target add` -> `target login` -> `doctor`.
- `recipes/blog-retrospective-research.md` — retrospective / blog research from cheap endpoints when `report aar` is unavailable or too slow.
- `recipes/task-attribution.md` — determine which agent worked on what: `feature show` → `linked_tasks[].owner` → correlate with `feature sessions`.

Prefer a recipe whenever the user's intent requires more than a single subcommand call. Single-command intents route directly via the table above.

## Output Mode Quick Rule

- Commands consumed **by the agent for reasoning**: `--output json` (or the `--json` shortcut).
- Commands rendered **verbatim to the user as narrative**: `--output markdown` (or `--md`). Defaults for `report aar` and `report feature`.
- Commands an **operator runs in a terminal** (target management, doctor): default `human`.

Full rules: `references/output-modes.md`.

## Provenance (always echo)

For every command result used in reasoning, surface the stable IDs and timestamps listed in `references/provenance.md` into the agent's working context so follow-up calls can chain without re-fetching.

## Graceful Degradation

Any transport/auth error (connection refused, DNS, TLS, 401/403, 5xx) MUST route through `ccdash doctor` before being surfaced as a raw error. See `recipes/unreachable-server.md`.

## Extending The Skill

When a new `ccdash` subcommand ships, do not edit this file. Follow the update protocol in the implementation plan (Update Protocol section):

1. Add/extend `references/command-<group>.md`.
2. Append a row to `scripts/router-table.json`.
3. Update `CHANGELOG.md`.

Edit `SKILL.md` only if trigger scope or when-not-to-use guidance changes.

## Key Files

- `scripts/router-table.json` — canonical intent -> command map (load on ambiguity).
- `scripts/preflight.sh` — optional install/connectivity probe.
- `references/cli-overview.md` — full command tree snapshot + global flags + target/auth resolution.
- `references/install-setup.md` — pipx / pip / repo-local install + verification.
- `references/output-modes.md` — human vs json vs markdown decision rules.
- `references/provenance.md` — IDs, timestamps, freshness fields to echo into agent context.
- `references/eval-scenarios.md` — 20-scenario routing eval fixture (Phase 2).
- `CHANGELOG.md` — dated log of skill changes tied to CLI surface.
