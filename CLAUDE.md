# CLAUDE.md

> **Branch note:** This file lives on **`ibm-main` only** and is intentionally **not** present on the `main` branch. It documents the IBM deploy mirror and its tooling. **Never cherry-pick or merge this file (or `scripts/sync.sh`) up to `main`.**
>
> ⚠️ **"not on `main`" is not the same as "not public."** `ibm-main` is itself pushed to `origin`, which is a **public** repo, so this file is publicly readable right now. Keeping it off `main` is a branch-hygiene rule, not a confidentiality one — see § "Two claims this file used to make are false".

## Repo

BoxBoat's downstream mirror of the public **MeatySkills** library — a portable library of agent workflow assets: command prompts, reusable skills, markdown artifact formats, schemas, and helper scripts for planning, execution, debugging, recovery, and project intelligence.

## Mirror & sync model

Two remotes, three remote branches — and note `ibm-main` is pushed to **both** remotes:

| Local branch | Pushed to | Visibility | Role |
|---|---|---|---|
| `main` | `origin` → `github.com/miethe/MeatySkills` | **PUBLIC** | Nominally the canonical source of truth. In practice a stale subset — see below. |
| `ibm-main` | `ibm` → `github.ibm.com/boxboat-presales/agent-artifacts` | private | The branch that is checked out and **deployed from**. |
| `ibm-main` | `origin` → `github.com/miethe/MeatySkills` | **PUBLIC** | ⚠️ The same branch, also on the public remote. PRs are opened and merged against it there. |

### ⚠️ Two claims this file used to make are false. Both measured 2026-08-10.

**1. The superset invariant does not hold.** This file claimed `ibm-main == origin/main + a
small stack of IBM-private commits`. Measured:

```
git merge-base --is-ancestor origin/main origin/ibm-main   ->  FALSE
commits on ibm-main not on main : 59   (of which [ibm-only]: 5; generic: 54, now 57)
commits on main not on ibm-main : 4
diff origin/main..origin/ibm-main : 510 files, +155,596 / -1,309
```

The branches have diverged in **both** directions. `meaty-agentic-ops/` — the executable
workflow engine, `delegation-router`, the per-provider executor agents, the configs, and the
frozen `workflow-sets/` snapshots — exists **only on `ibm-main`**. So a correctly-routed generic
fix landing on `main` never reaches the branch in use, and nothing reports it: it looks exactly
like the work shipped. Most consequential instance found: `MODE_D_INTENT_PATTERNS` (the
routing-time half of Mode-D enforcement) is present on `ibm-main` and **absent entirely** from
`origin/main`, so anyone provisioning workflows from the canonical branch gets the
pre-enforcement version. `scripts/sync.sh status` now checks this invariant and reports it in
red rather than assuming it.

**2. `[ibm-only]` is NOT a privacy boundary.** This file claimed those commits "must never be
public". Every one of them already is:

```
gh api repos/miethe/MeatySkills/contents/skills/ica-delegate/SKILL.md?ref=ibm-main
  -> 200, 51,516 bytes                        (repo visibility: PUBLIC)
gh pr view 12 --repo miethe/MeatySkills
  -> baseRefName: ibm-main, MERGED 2026-08-10  (on the public remote)
```

`ibm-main` is routinely pushed to `origin`, and `origin` is public — so `scripts/sync.sh`, this
`CLAUDE.md`, and `skills/ica-delegate/` (internal gateway URL included) are all publicly
readable today. Read `[ibm-only]` as **"belongs on the deploy branch"**, never as "cannot be read
by the public". Concretely: **never put a credential or a client-confidential fact in an
`[ibm-only]` commit** expecting the branch to hold it. (Audited 2026-08-10: no key-shaped
material exists anywhere in the `ibm-main`-only file set — the exposure is the internal gateway
hostname in 9 files, not secrets.)

`to-personal`'s `[ibm-only]` refusal is still worth keeping — it prevents *duplication* onto
`main` and keeps deploy-branch-specific files off the canonical branch. It simply is not, and
never was, a confidentiality control.

### Where this is going

Hand-maintaining a per-branch difference across the ~105 files that reference the ICA lane is
what produced this divergence, and re-splitting them by hand would reproduce it. The resolution
is to stop expressing the difference as a **branch** and express it as a **render**: provider /
edition conditional regions plus a values layer, so one source tree serves both the generic and
the IBM variant. SkillMeat already ships the rendering primitive (`strip_conditional_blocks`,
wired into the PAL substitution pass); the gaps are the axis, the `.claude` lane, and a selector.
Design spec:
`agentic_meta_dev/docs/project_plans/design-specs/provider-conditional-artifacts-v1.md`.
Tracker: `node_01KZP5880QKRFEDKWDWNP07ZV5`.

Until that lands, treat `ibm-main` as the honest canonical for anything under
`meaty-agentic-ops/`, and do not describe `main` as carrying it.

### Direction of flow

- **Personal → IBM (down): full & routine.** Every change on `origin/main` flows
  into `ibm-main` by rebasing the IBM-private stack on top of the latest
  `origin/main`. Run after `origin` gets new work.
  ⚠️ **This direction is currently BLOCKED** — the rebase conflicts in
  `meaty-agentic-ops/skills/delegation-router/model-registry.yaml`, and the conflict is
  ibm-main-internal history replay (that file does not exist on `origin/main` at all), not a
  main-vs-ibm-main disagreement. Read the conflict-handling note in `scripts/sync.sh` before
  attempting a resolve.
- **IBM → personal (up): selective & manual.** Only cherry-pick *generic* commits
  worth sharing. IBM-private commits are not cherry-picked up — that keeps them off the
  canonical branch; it does not make them non-public.
  ⚠️ **This direction has not kept up:** 57 generic commits are stranded on `ibm-main`.
  "Selective & manual" degraded into "never", because `status` displayed the entire
  divergence under the heading *IBM-private commits*, so the backlog was invisible.

```
                 (full, routine: rebase + force-push)  [BLOCKED — see above]
   origin/main  ───────────────────────────────────────▶  ibm/main
   (PUBLIC)     ◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                 (selective: cherry-pick generic commits)
                 [57 stranded]

   ibm-main  ─────────────────────────────────────────▶  origin  (PUBLIC)
                 (the hop the model above omits entirely)
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

## Licensing

The entire library is licensed under the **MIT License**, `Copyright (c) 2026
Nick Miethe` — retains ownership while opening the assets for use, modification,
and redistribution.

Every skill is licensed individually **and** at the repo root, so each skill
stays self-contained when copied out (e.g. into SkillMeat):

- Root `LICENSE` covers the whole repo.
- A per-skill `LICENSE` (identical text, same copyright line) lives in **every**
  `skills/<name>/` directory — including IBM-specific skills (you authored them).

### Rule when adding a new skill

Always drop a `LICENSE` into the new skill directory — `cp LICENSE
skills/<name>/LICENSE`. Then:

- **Generic / shareable skill:** add it (and its `LICENSE`) on `main`, push to
  `origin`; it flows down to `ibm-main` via `to-ibm`.
- **IBM-only skill** (e.g. `ica-delegate`): the skill and its `LICENSE` are added
  on `ibm-main` as part of an `[ibm-only]` commit — they never reach the public repo.

### Invariants

- Keep the copyright line identical across the root and all per-skill files.
- Never leave a skill without a `LICENSE`. Quick audit:

  ```bash
  for d in skills/*/; do test -f "$d/LICENSE" || echo "MISSING: $d"; done
  ```
