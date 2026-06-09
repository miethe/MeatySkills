# CLAUDE.md

> **Branch note:** This file lives on **`ibm-main` only** and is intentionally **not** present on the public `origin/main`. It documents the private IBM mirror and its tooling. **Never cherry-pick or merge this file (or `scripts/sync.sh`) up to `main`/`origin`.**

## Repo

BoxBoat's downstream mirror of the public **MeatySkills** library — a portable library of agent workflow assets: command prompts, reusable skills, markdown artifact formats, schemas, and helper scripts for planning, execution, debugging, recovery, and project intelligence.

## Mirror & sync model

Two remotes, two local branches:

| Local branch | Remote | Visibility | Role |
|---|---|---|---|
| `main` | `origin` → `github.com/miethe/MeatySkills` | **PUBLIC** | Canonical source of truth. Generic, shareable assets only. |
| `ibm-main` | `ibm` → `github.ibm.com/boxboat-presales/agent-artifacts` | **PRIVATE** | Mirror of `origin/main` **plus** IBM-private commits. |

**Invariant:** `ibm-main` == `origin/main` + a small stack of IBM-private commits.

IBM-private commits are things that must never be public: the README rebrand
("BoxBoat's Agentic Artifacts Library"), internal references, client-specific
content, and this `CLAUDE.md` + `scripts/sync.sh`.

### Direction of flow

- **Personal → IBM (down): full & routine.** Every change on `origin/main` flows
  into `ibm-main` by rebasing the IBM-private stack on top of the latest
  `origin/main`. Run after `origin` gets new work.
- **IBM → personal (up): selective & manual.** Only cherry-pick *generic* commits
  worth sharing publicly. IBM-private commits never go up.

```
                 (full, routine: rebase + force-push)
   origin/main  ───────────────────────────────────────▶  ibm/main
   (PUBLIC)     ◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    (PRIVATE)
                 (selective: cherry-pick generic commits)
```

### Conventions

- Do **generic / shareable** work on `main`; `git push` to `origin`.
- Do **IBM-private** work on `ibm-main`, and **prefix the commit subject with
  `[ibm-only]`** so it's easy to spot and can never be cherry-picked upstream
  by accident (`scripts/sync.sh to-personal` refuses `[ibm-only]` commits).
- The local branch is **`ibm-main`**, not `ibm`, to avoid colliding with the
  remote named `ibm` (which caused `refname 'ibm' is ambiguous` warnings).
- `ibm-main` history is rebased and force-pushed — it's a mirror you control.
  Don't base long-lived shared work on it.

## Commands — `scripts/sync.sh`

Run from anywhere in the repo. (Lives on `ibm-main`, so check that branch out first.)

| Command | What it does |
|---|---|
| `scripts/sync.sh status` | Show how far each branch is from its remote, and list the IBM-private commits (cherry-pick candidates for `to-personal`). |
| `scripts/sync.sh to-ibm` | **Downstream sync.** Fetch, rebase `ibm-main` onto `origin/main` (keeping IBM-private commits on top), force-push to `ibm/main`. |
| `scripts/sync.sh to-personal <commit>...` | **Selective upstream.** Fast-forward `main`, cherry-pick the given generic commit(s), push to `origin`. Refuses `[ibm-only]` commits. |

### Typical loop

1. Work on `main` → `git push` (to `origin`).
2. `scripts/sync.sh to-ibm` — mirror everything down to IBM.
3. IBM-private tweak: on `ibm-main`, commit with an `[ibm-only]` subject, then
   `scripts/sync.sh to-ibm` (or `git push --force-with-lease ibm ibm-main:main`).
4. Share an IBM-developed generic fix back: `scripts/sync.sh to-personal <sha>`,
   then `scripts/sync.sh to-ibm` to drop the now-duplicated commit from `ibm-main`.

### Conflicts

If `origin/main` edits the same lines as an IBM-private commit (commonly
`README.md`), `to-ibm` pauses on a rebase conflict. Resolve it, then:

```bash
git rebase --continue
git push --force-with-lease ibm ibm-main:main
```

### Optional shortcuts (git aliases)

```bash
git config alias.sync-ibm '!bash scripts/sync.sh to-ibm'
git config alias.sync-status '!bash scripts/sync.sh status'
# usage: git sync-ibm   /   git sync-status
```
