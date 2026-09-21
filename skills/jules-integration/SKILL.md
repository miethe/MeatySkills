---
name: jules-integration
description: >-
  Delegate an asynchronous coding task — a bug fix, a doc/test/refactor sweep, or any change you
  want to run in the background — to Google Jules, Google's cloud-based async coding agent that
  clones a connected GitHub repo, works on a VM, and opens a PR. Use when creating a Jules
  session, approving a Jules plan, monitoring a running session's activities, or triaging a
  Jules-authored PR before merge. Triggers: "delegate to Jules", "Jules session", "async coding
  agent", "Google Jules", "jules.google", "run this in the background and open a PR". Do NOT use
  for: quick synchronous edits you can do directly, real-time pair-programming style changes,
  tasks that need mid-run interactive steering, or CI/CD workflow file changes — Jules is
  fire-and-forget once a session starts and cannot be steered turn-by-turn like an inline agent.
version: 1.0
app_version: "2026-09-21"
updated: 2026-09-21
---

# Jules Integration

Drives Google Jules — an asynchronous, cloud-hosted coding agent — from the terminal or via its
REST API: create a session against a connected GitHub repo, let Jules work on a VM in the
background, and review the PR it opens.

## When To Use

Use this skill when:
- You want a bounded coding task (bug fix, test-suite addition, doc sweep, refactor, cleanup) run
  in the background while you work on something else.
- You need to kick off, monitor, or pull the result of a Jules session — via the `jules` CLI or
  the REST API directly.
- You're triaging whether a task is a good fit for Jules before delegating it.

## When NOT To Use

Do NOT use this skill for:
- Quick, simple edits you can make directly — the round trip (create session → wait for VM →
  review plan → wait for PR) costs more than doing it yourself.
- Tasks needing real-time or turn-by-turn interaction — Jules runs unattended once started; use an
  inline agent (this Claude Code session, `ica-delegate`, `codex`) when you need to steer mid-task.
- Changes to CI/CD workflow files — handle those manually; a background agent modifying pipeline
  definitions it will itself be gated by is a bad pattern regardless of provider.
- General delegation-routing decisions across providers (ICA, Bob, Codex, Gemini, Jules) — that's
  `delegation-router`; this skill is the Jules-specific leaf once Jules has been chosen.

## Overview

Jules is Google's asynchronous AI coding agent (jules.google). A session clones your connected
GitHub repository onto a cloud VM, works against a prompt you supply, and — depending on
`automationMode` — opens a pull request with its changes. You interact with it three ways: the
`jules` CLI (`npm install -g @google/jules`), the REST API directly, or the jules.google web UI.
The CLI and API are two views of the same session model; the CLI is the faster path for scripted
or repeated use, the API for programmatic integration (e.g. from a CI step or another agent).

## Prerequisites

1. **Jules API key** (for API access) — from <https://jules.google> → Settings.
2. **GitHub connected** — the target repo must be connected to Jules at jules.google before a
   session can reference it.
3. **AGENTS.md** in the repo root, if you want Jules to read repo-specific agent context — Jules
   reads it the way other coding agents do.

## Command Map — CLI (`@google/jules`, current as of v0.1.42)

| Command | Purpose | Key flags |
|---|---|---|
| `jules` | Launch the interactive TUI | — |
| `jules login` / `jules logout` | Authenticate/deauthenticate the CLI's Google account | — |
| `jules new "<prompt>"` | Create a session against the **current directory's repo** | `--repo <owner>/<repo>` to target a different repo, `--parallel <n>` for N parallel sessions on the same task |
| `jules remote list --session` | List your sessions | — |
| `jules remote list --repo` | List repos connected to Jules | — |
| `jules remote pull --session <id>` | Pull a session's result into the local working tree | — |

## Command Map — REST API

Base: `https://jules.googleapis.com/v1alpha`. Auth header: `X-Goog-Api-Key: $JULES_API_KEY`.

| Call | Purpose |
|---|---|
| `POST /sessions` | Create a session (see body shape below) |
| `GET /sessions` | List your sessions |
| `GET /sessions/{id}` | Get one session's status |
| `GET /sessions/{id}/activities` | List progress-update activities for a session |

```bash
export JULES_API_KEY="your-key-here"

curl 'https://jules.googleapis.com/v1alpha/sessions' \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Goog-Api-Key: $JULES_API_KEY" \
  -d '{
    "prompt": "YOUR TASK DESCRIPTION HERE",
    "sourceContext": {
      "source": "sources/github/OWNER/REPO",
      "githubRepoContext": { "startingBranch": "main" }
    },
    "automationMode": "AUTO_CREATE_PR",
    "requirePlanApproval": true
  }'
```

By default `automationMode` creates no PR automatically — set it to `AUTO_CREATE_PR` explicitly to
get one, and keep `requirePlanApproval: true` so Jules waits for plan sign-off before acting.

## Session Workflow

1. **Create the session** — via `jules new "<prompt>"` or the API `POST /sessions` call above.
2. **Review the plan** — Jules proposes a plan before acting; approve or reject it at jules.google
   (or programmatically, if `requirePlanApproval` is set and your integration handles the approval
   step).
3. **Monitor progress** — `jules remote list --session`, `GET /sessions/{id}/activities`, or watch
   at jules.google.
4. **Pull or review the result** — `jules remote pull --session <id>` locally, or review the PR
   Jules opened on GitHub.
5. **Merge manually** — Jules opens the PR; a human (or your own review gate) merges it. Never
   configure automatic merge.

## Writing Good Prompts

**Do:**
- Be specific: "Add unit tests for `parseQueryString` in `utils.js`."
- Set constraints: "Do not modify public APIs."
- Define scope: "Focus on the `src/auth/` directory."

**Don't:**
- Be vague: "Make the code better."
- Skip context: "Fix the bug" (which bug?).
- Request unsafe operations: "Auto-merge when done."

## Guardrails

- **No auto-merge, ever.** Always create-PR, never merge-on-completion — a session's changes are
  unreviewed until a human (or an equivalent gate) has looked at the diff.
- **Plan approval by default.** Set `requirePlanApproval: true` (API) or review the plan at
  jules.google (CLI/TUI) before Jules starts editing.
- **Credentials never touch the repo.** The API key is an environment variable or secret store
  entry, never a literal in a prompt, config file, or committed script.
- **Start small.** Validate a new integration or repo connection with a minor task before handing
  Jules a large refactor.

## Troubleshooting

| Issue | Likely cause / fix |
|---|---|
| "Source not found" | Repo isn't connected to Jules yet — connect it at jules.google first. |
| "401 Unauthorized" | API key invalid, expired, or missing from the request header. |
| Session stuck | Check jules.google for status; it may be waiting on plan approval or feedback. |
| Bad PR / wrong direction | Reject the plan (or close the PR) and re-issue with a more specific prompt — see "Writing Good Prompts". |

## Deferred / Do Not Say

| Claim | Status |
|---|---|
| `jules remote new --repo . --session "YOUR TASK"` creates a session | **STALE — do not say this.** Verified 2026-09-21 against the current `@google/jules` CLI (npm, v0.1.42) help output and README: session creation is the top-level `jules new "<prompt>"` (optionally `--repo <owner>/<repo>`, `--parallel <n>`), not `jules remote new`. `remote` is scoped to `list`/`pull` against existing sessions, not creation. This corrects the source artifact, which predated (or mis-transcribed) the current CLI surface. |
| A GitHub Actions workflow named `jules-review.yml` exists in every repo | Not a Jules product feature — that was a repo-specific convention in the source artifact's origin repo, not something this skill can assume exists anywhere it's deployed. Don't tell a user to "trigger `jules-review.yml`" unless you've confirmed that workflow exists in *their* repo. |
| The exact `automationMode` enum values beyond `AUTO_CREATE_PR` | Not independently re-verified this pass — the API reference (see Key References) is the source of truth for the full set; don't invent additional values. |
| Jules CLI `--session` flag on `jules new` | Does not exist on `new`; `--session <id>` is a flag on `remote list`/`remote pull`, which take an existing session id, not a task description. |

## Key References

- /Users/miethe/dev/homelab/development/MeatySkills/skills/jules-integration/CHANGELOG.md
- /Users/miethe/dev/homelab/development/MeatySkills/skills/jules-integration/LICENSE
