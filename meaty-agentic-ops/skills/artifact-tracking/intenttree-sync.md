# IntentTree SDLC Sync — capture plans & progress as a typed work tree

Mirror this repo's SDLC artifacts (implementation plans + `.claude/progress/**` files) into the
shared **IntentTree** instance as a typed `Feature → Phase → Task` node tree, ranked and
dependency-aware. **Markdown stays canonical**; IntentTree is a *derived projection* (source → node
only; nothing writes back to your files).

## What gets projected

- **Feature container** (one per plan/PRD) ← the plan file (idempotency key = its path).
- **Phase containers** (`Phase N`) ← each `phase-N-progress.md`.
- **Task nodes** (`atomic_task`) ← each entry in a progress file's `tasks[]` frontmatter, with
  `status`, `points`, `priority`, `dependencies` (→ `depends_on` edges), and `description`.
- **Progress rollup** is computed by IntentTree from leaf progress, which the backend derives from
  task status (**DI-105**): `completed`→1.0, `in_progress`→0.5, else 0.0 — so feature/phase % is
  faithful with no `/complete` post-pass.

The **source of rich tasks is the `.claude/progress/` files** — they already carry structured
`tasks[]`. Implementation plans/PRDs supply the feature container (title + path); they need **no**
`tasks[]` of their own.

## Enable (per repo)

```bash
export INTENTTREE_SDLC_SYNC=1                     # turn the auto-sync hook on
export INTENTTREE_TREE=<this repo's tree id>      # see mapping below
export INTENTTREE_WORKSPACE=ws_01KV8VMWX9EJ6VDQKEBMYQZRXG
export INTENTTREE_API_URL=http://10.42.10.76:8032 # default; the shared node
```

When `INTENTTREE_SDLC_SYNC` is truthy and `INTENTTREE_TREE` is set, status writes via the
artifact-tracking scripts call `intenttree_sync.push_to_intenttree(file)`, which runs the capture
shim (below) for that file — parsing/normalization is server-side. The hook is **best-effort and
non-fatal**: if the node
is unreachable it logs a warning and continues; it never changes a script's exit code. With the
flag unset (default), everything behaves exactly as before.

### Repo → tree map (shared instance)

| Repo | Tree id |
|------|---------|
| intenttree | `tree_01KV8VMWXKJPDM2TN1C39VYSC5` |
| skillmeat | `tree_01KV8VMWXMF3RV2ZWN263D0KV3` |
| meatywiki | `tree_01KV8VMWXMJ87Q7J5DEBJ59PB3` |
| meatywiki-portal | `tree_01KV8VMWXKGVMWH1VC5EG5FZ1D`¹ |
| CCDash | `tree_01KV8VMWXKZRDQ9TQKCJ5KDXRP` |
| research-foundry | `tree_01KV8VMWXM5408KY0XRSGCQD7Q` |
| agentic_meta_dev | `tree_01KV8VMWXK2NC4Y6HDPE8T2JS1` |
| meatycapture | `tree_01KV8VMWXKABAWH2BV7XC9J7XM` |
| arc | `tree_01KV8VMWXKGVMWH1VC5EG5FZ1D` |

¹ confirm with `itt tree list --json`; ids are stable per the seeded instance.

## Manual commands

```bash
# sync one file (what the hook calls):
python scripts/intenttree_capture.py sync <progress-or-plan-file> --tree $INTENTTREE_TREE --apply

# backfill every in-flight feature in this repo (one-time / periodic):
python scripts/intenttree_capture.py backfill --repo-root . --tree $INTENTTREE_TREE \
  --workspace $INTENTTREE_WORKSPACE --cutoff 2026-05-30        # dry-run by default
python scripts/intenttree_capture.py backfill --repo-root . --tree $INTENTTREE_TREE --apply
```

Both are **idempotent** (keyed on `(source_artifact_id, source_task_id)`): re-running with
unchanged source is a no-op. `backfill` captures only **in-flight** features (≥1 non-complete task,
recently updated). **Catch-all dirs** (e.g. `quick-features/`) are captured **per-file** — each file
becomes its own feature (its path is the idempotency key), so the generic ids those files reuse
(`QF-1`, `TASK-1`) never collide across files (**DI-107**).

`itt sync import <file> --apply --tree $INTENTTREE_TREE` now also works natively (no script): the
CLI POSTs the raw file and the backend parses + normalizes server-side (see "Native path" below).

## Native path (server-side parsing — DI-103/104/105 resolved 2026-06-20)

`itt sync import <file>` now POSTs the **raw file text** as `content`; the backend (which has
PyYAML) parses the YAML frontmatter, normalizes task fields, and projects the subtree — there is
nothing to parse client-side. The backend now:

- derives a node title from `description` when no `title` is present (**DI-104**),
- parses unit-suffixed effort (`estimated_effort: "1.5 pts"`, `effort`) into points (**DI-104**),
- derives leaf progress from status (`completed`→1.0, `in_progress`→0.5; **DI-105**),
- accepts raw `content` on both `/source-artifacts` (register) and `/work-item-sync/import`, with a
  server-side dry-run reporting the true task count.

`intenttree_capture.py` is now a **thin shim** over this native path: it only orchestrates *which*
files capture as *which* feature (aggregating a feature's phase files; capturing catch-all dirs
per-file — **DI-107**) and POSTs the raw tasks for the backend to normalize. It is slated for
removal after a burn-in release.

### Resolved (historical): why a separate capture script existed

> The `intenttree-client` (`itt` CLI) ships **without** a YAML parser, so the old `itt sync import`
> fall-back parser could not read nested/multi-line `tasks[]` and silently imported **zero** task
> nodes (**DI-103**); `description`→title (**DI-104**) and status→progress (**DI-105**) were also
> dropped. The script worked around this by parsing + normalizing client-side. Those gaps are now
> fixed backend-side (2026-06-20); parsing moved to the server and the script is a thin shim.

## Requirements

`pyyaml` (already a dependency of the artifact-tracking scripts). Network access to
`INTENTTREE_API_URL`. No auth token required on the loopback/LAN shared node.
