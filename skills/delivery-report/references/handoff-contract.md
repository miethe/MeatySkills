# The Handoff Contract — the core of this skill

Every forward-route item carries a **handoff**: enough for a reader to go from "this is behind" to
a dispatched agent in one click. It is what distinguishes `delivery-report` from a status dashboard.
The handoff is rendered as a `<details>` block with a **Copy handoff** button, and its copyable
payload is plain text meant to be pasted into a fresh session with zero prior context.

## Shape

```yaml
handoff:
  command: "/execute-plan"      # slash-command, CLI invocation, or null for human-only acts
  repo: "/abs/path/to/repo"     # ABSOLUTE — agents resolve "repo root" unreliably
  paths: ["docs/.../plan.md"]   # must exist at render time (checked when the repo is present)
  requirement_ids: ["FR-11"]    # real IDs; grep-verified present in at least one path
  gates: ["G0"]                 # blocking gate ids, or []
  tracker: "node_01… — title"   # IntentTree / Linear / Jira node, or null
  trigger: "..."                # REQUIRED when the item kind is deferred
  prompt: "..."                 # <=60 words, imperative, self-contained
```

Plus one report-global `report.constraints` string, injected into **every** payload rather than
authored per item — the project invariants a dispatched agent must not violate.

## Validation rules (all blocking)

1. **`paths` are existence-checked** against `handoff.repo` (falling back to
   `report.generated_from.repo`). A handoff pointing at a missing file is worse than no handoff.
   The check runs only when the repo is present on disk; when it is absent (portable manifest, CI)
   it is skipped rather than failed — you can only existence-check when you have the tree.
2. **`requirement_ids` must be grep-verifiable** in at least one listed path (same present-repo
   condition). Invented IDs are the fastest way a report becomes untrustworthy. If a requested
   identifier convention does not exist in the repo, report that and use the real prefixes — never
   invent a mapping.
3. **`prompt` must stand alone.** It is pasted into a fresh session. Name the concrete first action
   and the single most important constraint. Over ~60 words earns a warning.
4. **`command: null` is meaningful** and renders distinctly — it asserts *no agent can do this*.
   A `blocked_external` item **must** carry `command: null`; a non-null command fails validation.
5. **Absolute `repo` path is mandatory.** Subagents and workflow agents resolve relative roots to
   the main checkout and silently misfire against the wrong tree.
6. **`deferred` requires a non-empty `trigger`.** A deferral asserts *we decided not to do this
   yet, and here is what would change that*. Without a trigger it is just untracked work wearing a
   label, and validation rejects it.

## Copy payload format (plain text — pasted into a chat prompt, not parsed)

```
<command | "human decision -- no agent path">

Task: <item title>
Domains: <d1>, <d2>
Repo: <absolute repo path>

Paths:
  - <path>

Requirement IDs: <ids>
Gates: <gates> (blocked-external, human-only)
Tracker: <node — title>
Re-entry trigger: <trigger>          # deferrals only

Prompt:
<prompt>

Constraints: <report-global report.constraints>
```

## Which item kinds require a handoff

| kind | meaning | handoff |
|---|---|---|
| `shipped` | delivered and merged | optional |
| `partial` | started, incomplete, **or built-but-unmerged** | **required** |
| `not_started` | planned, nothing built | **required** |
| `blocked_external` | waiting on a named human act; no agent path | **required**, `command: null` |
| `deferred` | consciously postponed with a re-entry trigger | **required**, with `trigger` |
| `finding` | a defect, surprise, or negative result | **required** when actionable |

`partial` explicitly covers unmerged branch work — see the reconcile-against-git note in
`aos-integration.md` §2.
