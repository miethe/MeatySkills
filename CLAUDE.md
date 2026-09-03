# CLAUDE.md

> **`origin/main` is the single canonical line.** The public/IBM split model this file used to
> document was **retired 2026-09-03** by Nick's decision. `ibm-main` and the `ibm` remote are
> deliberately **frozen** — stale by decision, not by neglect — and anything IBM-specific now goes
> to the private repo **`ibm-agentic-tools`**, not to a branch of this public one.
>
> This file belongs on `main` and is canonical there. (Its predecessor claimed to live on
> `ibm-main` only and instructed readers never to merge it up — see § Five claims this file used to
> make, all of which were false by the time anyone read them.)

## Repo

A portable library of agent workflow assets: command prompts, reusable skills, markdown artifact
formats, schemas, and helper scripts for planning, execution, debugging, recovery, and project
intelligence. `meaty-agentic-ops/` is the executable workflow engine — the `delegation-router`, the
per-provider executor agents, the configs, the hooks, and the frozen `workflow-sets/` snapshots —
and is the **declared upstream** for other repos' deployed `.claude/workflows/` copies
(`agentic_meta_dev/docs/ARTIFACT-UPSTREAM-REGISTRY.md`).

## The split model is retired

**Decided 2026-09-03.** Two remotes and three long-lived branches produced a divergence nobody
could hold in their head, in both directions at once, with the doctrine file describing it going
stale about itself. The resolution is not a better sync script; it is **one line plus a separate
private repo**:

| Ref | Status now |
|---|---|
| `main` → `origin` (`github.com/miethe/MeatySkills`, **PUBLIC**) | **canonical.** All work lands here. |
| `ibm-main` → `origin` and `ibm` | **FROZEN.** Not synced, not deleted, not deployed from. |
| `ibm/main` (`github.ibm.com/boxboat-presales/agent-artifacts`) | **FROZEN**, 22 commits behind the frozen `ibm-main`. Left as-is on purpose. |
| `ibm-agentic-tools` (private) | **where IBM-specific content goes from now on.** |

Consequences, stated so they are not re-derived:

- **Nothing is pushed to the `ibm` remote again.** `scripts/sync.sh to-ibm` — which ended in a live
  `git push --force-with-lease ibm ibm-main:main` — now refuses. So does `to-personal`.
- **Content still on `ibm-main` that is worth keeping gets reconciled onto `main`**, file by file,
  with the direction *measured* rather than assumed. See § How to reconcile a straggler.
- **A stale `ibm/main` is the intended state.** Do not "fix" it. Reporting it as drift is a
  misreading of this decision, not a finding.

### Freezing did NOT unpublish anything

⚠️ `ibm-main` is on the **public** `origin` and remains readable there. `skills/ica-delegate/`
— internal gateway hostname included — is served from `github.com/miethe/MeatySkills?ref=ibm-main`
today, and was before the freeze. **`[ibm-only]` never was a privacy boundary**, and retiring the
model does not make it one retroactively. Never put a credential or a client-confidential fact in
this repo on any branch. (Audited 2026-08-10: no key-shaped material in the `ibm-main`-only file
set; the exposure was the internal gateway hostname in 9 files, not secrets.)

## Five claims this file used to make, all false

Recorded because the *pattern* matters more than the individual errors: this file described a split
that a routine PR had already collapsed, and nothing noticed for weeks. Measured 2026-09-03.

| Former claim | Measured reality |
|---|---|
| "This file lives on `ibm-main` only… never cherry-pick or merge it up to `main`" | It was **on `main`**, byte-identical, put there by `539def0` (PR #37) along with `scripts/sync.sh`. The rule was never enforced by anything. |
| "`meaty-agentic-ops/` exists **only** on `ibm-main`" | `main` carried **677** files under it, `ibm-main` **678** — a one-file delta. |
| "`MODE_D_INTENT_PATTERNS` is present on `ibm-main` and **absent entirely** from `origin/main`" | **9 hits on each.** Identical. This was called the most consequential instance; it had already fixed itself. |
| "diff `origin/main..origin/ibm-main`: 510 files, +155,596 / −1,309" | **66 differing paths**, in four clusters. |
| "IBM-only skills… never reach the public repo" | `skills/ica-delegate/` is on public `main`. |

**Why every one of them rotted the same way:** `539def0` swept the whole `ibm-main` tree onto
`main` as a side effect of an unrelated `preview_url_scope` fix. That silently resolved most of the
divergence *and* violated this file's own "never merge this up" rule — and because every check
anyone ran read the *doctrine* rather than the *trees*, the collapse was invisible. The lesson is
this repo's house rule pointed at its own doctrine: **verify against the instances, not the
mechanism** (`agentic_meta_dev/.claude/rules/remediation-sweeps-state.md`).

## How to reconcile a straggler off `ibm-main`

`ibm-main` is frozen, not erased; if something on it is worth keeping, bring it to `main`. **Do not
trust commit counts or ancestry** — this repo squash-merges, so ancestry says nothing about content,
and the 114/7 commit "divergence" was almost entirely history shape.

```bash
# 1. What actually differs, at TREE level (the only number that means anything).
git diff --name-status origin/main origin/ibm-main

# 2. For each differing file, is main's copy just a STALE SNAPSHOT of an older
#    ibm-main state? If it matches one, main holds no novel work and ibm-main wins.
f=path/to/file
target=$(git rev-parse "origin/main:$f")
for c in $(git rev-list origin/ibm-main -- "$f"); do
  [ "$(git rev-parse "$c:$f" 2>/dev/null)" = "$target" ] && { echo "STALE SNAPSHOT of $c"; break; }
done
```

⚠️ **Comparing blobs against the merge base is not enough.** A file **absent** at the merge base and
added independently on both lines reads as "both changed" under that test, which is how
`publish-report.sh` was briefly mis-called a conflict when `main` was simply newer. Check whether
the file existed at the base before believing a divergence.

**Settled during the 2026-09-03 reconciliation** — do not redo these:

- `meaty-agentic-ops/skills/delegation-router/` — **taken from `ibm-main`** (`e5a86bb`). `main`'s
  nine files were snapshots of nine *different* ibm-main moments (2026-07-26 → 08-17), an incoherent
  mix with zero public-only content.
- `skills/ccdash/` — **stays absent from `main`.** Removed on purpose (`6d742fa`: upstream moved to
  the CCDash repo). Its presence on frozen `ibm-main` is not a reason to restore it.
- `meaty-agentic-ops/skills/dev-execution/hooks/publish-report.sh` — **`main` is newer** (carries PR
  #37's `preview_url_scope`/`DURABILITY` block; `ibm-main` never received it).
- `skills/plan-status/SKILL.md` — **`main` is newer**; `ibm-main` never touched it.

## Conventions

- **Do all work on `main`**, or on a branch off `main` opened as a PR against it. `git push` to
  `origin`.
- **The `[ibm-only]` commit prefix is retired.** It marked a deploy-branch that no longer exists as
  a target, and it never meant private. IBM-specific work goes in `ibm-agentic-tools`.
- **Never base long-lived work on `ibm-main`** — it is frozen and its history was force-pushed for
  most of its life.
- The local branch is named `ibm-main`, not `ibm`, to avoid colliding with the remote named `ibm`
  (which caused `refname 'ibm' is ambiguous`). Kept as-is; it is frozen.

## `scripts/sync.sh` — retired verbs

| Command | State |
|---|---|
| `scripts/sync.sh status` | **works.** Read-only; still useful for measuring the frozen divergence. |
| `scripts/sync.sh to-ibm` | **REFUSES** (exit 1). Would rebase and force-push to the frozen `ibm` remote. |
| `scripts/sync.sh to-personal <commit>...` | **REFUSES** (exit 1). Reconcile onto `main` directly instead — see above. |

The refusals are deliberate rather than a deletion: a deleted script is one someone restores from
history and runs, while a refusal states the decision at the moment of the attempt. The force-push
line still exists in the file, unreachable behind the guard.

## Licensing

The entire library is licensed under the **MIT License**, `Copyright (c) 2026 Nick Miethe` —
retaining ownership while opening the assets for use, modification, and redistribution.

Every skill is licensed individually **and** at the repo root, so each skill stays self-contained
when copied out (e.g. into SkillMeat):

- Root `LICENSE` covers the whole repo.
- A per-skill `LICENSE` (identical text, same copyright line) lives in **every** skill directory.

### Rule when adding a new skill

Always drop a `LICENSE` into the new skill directory — `cp LICENSE skills/<name>/LICENSE` — then add
it on `main` and push to `origin`. There is no longer a second branch for it to flow to, and no
IBM-only variant: a skill that must not be public belongs in `ibm-agentic-tools`.

### Invariants

- Keep the copyright line identical across the root and all per-skill files.
- Never leave a skill without a `LICENSE`. Quick audit:

  ```bash
  for d in skills/*/ artifacts/skills/*/; do test -f "$d/LICENSE" || echo "MISSING: $d"; done
  ```

  ⚠️ The audit covers **two** roots since the ADP-M3/K1 canary began relocating skills to
  `artifacts/skills/` (`f121db7`, currently `claude-agent-sdk` only). A one-root loop silently skips
  everything already moved.
