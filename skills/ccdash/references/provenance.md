# Provenance Fields To Echo

After every `ccdash` call used for reasoning, capture the following fields into the agent's working context. They enable follow-up calls to chain without re-fetching and let the agent cite stable IDs to the user.

## Always Echo

| Field | Source Command(s) | Why it matters |
|---|---|---|
| `project_id` | `status project`, target config | Scopes every follow-up call. |
| `generated_at` (or `as_of`) | all structured outputs | Freshness. If older than ~15 min, caveat the answer. |
| `last_sync_at` | `status project` | FS->DB sync age; governs trust. |
| `target.name` / `target.url` | `target show` | Distinguishes staging vs prod answers. |

## Entity-Specific

Capture whichever apply to the current command:

| Entity | Fields |
|---|---|
| Feature | `feature_id`, `status`, `category`, `updated_at` |
| Session | `session_id`, `root_session_id`, `feature_id`, `started_at`, `ended_at`, `cost`, `model` |
| Document | `document_id`, `doc_type`, `path`, `feature_id` |
| Workflow | `workflow_id`, `failure_count`, `last_failure_at`, `feature_ids` |
| Report | `feature_id`, `generated_at`, source `session_ids` |

## How To Echo

When summarizing to the user, surface stable IDs inline (e.g., "FEAT-123 had 4 sessions, the longest being SESS-abc at 2h12m"). When handing off to another agent step, serialize the captured fields into the next tool call's arguments directly — do not paraphrase them.

## Freshness Heuristics

- `generated_at` within 1 minute: trust unconditionally.
- `generated_at` within 15 minutes: trust; mention age only if the user asks.
- `last_sync_at` older than 15 minutes: warn that the answer lags the filesystem; suggest the operator trigger a sync.
- Any timestamp more than 1 hour stale: re-run the command before acting on it.

## Do Not Invent

If a field is missing from a response, say so explicitly. Do not fabricate IDs or timestamps to "fill in" a summary. Missing IDs are themselves signal (e.g., an orphan session has no `feature_id`).
