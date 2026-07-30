---
skill: skillmeat-cli
workflow_id: upstream-linking
workflow_name: Link Local Artifact to GitHub Upstream
canonical_docs:
  - docs/user/guides/cli/commands.md § "Core Commands"
  - docs/user/guides/cli/commands.md § "Phase 2: Sync Commands"
  - docs/user/guides/cli/commands.md § "Adding Artifacts"
version: 1.0
updated: 2026-06-02
---

# Link Local Artifact to GitHub Upstream

**Use when**: You have your own version of an artifact in your collection (locally created or modified) and want it linked to a GitHub upstream so SkillMeat tracks the upstream and pins a `resolved_sha` — while keeping YOUR content as the canonical version in the collection and any deployed projects.

For full command flag reference see `docs/user/guides/cli/commands.md`.

---

## Why the Naive Paths Fail

Two approaches seem obvious but both break the invariant:

**(a) `skillmeat add skill ./local-path --name X --force`**
After a GitHub import, re-adding from a local path hardcodes `origin=local` in the artifact record and wipes the upstream link. SkillMeat does not treat `origin=local` artifacts as upstream-tracked regardless of any provenance string set elsewhere.

**(b) GitHub import then `add --force` from local**
The `add` command always wins: `origin` is reset to `local`, `upstream` and `resolved_sha` are cleared. No version-overlay command exists; `update --strategy local` means "skip the update," not "replace content from a local path."

**The supported layering**: `sync-pull --strategy overwrite` (project → collection). This command replaces content files and updates the lock hash but never rewrites `collection.toml`, so `origin`, `upstream`, and `resolved_sha` survive intact.

---

## Verified Recipe

Verified 2026-06-02 for `skill_seekers` ← `github.com/yusufkaraaslan/Skill_Seekers/skills/skill-seekers`.

### Prerequisites

- Your artifact files are available at a known local path (keep them out-of-tree during the recipe).
- A scratch staging project directory exists or you can create one (`mkdir -p /tmp/skillmeat-stage`).
- GitHub token is configured: `skillmeat config set github-token <token>`.

### Steps

**Step 1 — Safety snapshot**

```bash
skillmeat snapshot -m "pre relink"
# Also back up your artifact files to a path outside the collection:
cp -rf ~/.skillmeat/collection/skills/<X>/ /tmp/<X>-backup/
```

**Step 2 — Import the GitHub baseline**

This establishes `origin=github`, pins `upstream` + `resolved_sha`. Content will temporarily be the upstream baseline.

```bash
skillmeat add skill <user/repo/path@ref> --name <X> --force --dangerously-skip-permissions
# Example:
# skillmeat add skill yusufkaraaslan/Skill_Seekers/skills/skill-seekers --name skill_seekers --force --dangerously-skip-permissions
```

`--dangerously-skip-permissions` suppresses the trust prompt for local execution.
Omit `@ref` to resolve the repo's actual default branch (works for non-`main` defaults too).

**Step 3 — Deploy baseline to a scratch staging project**

```bash
STAGE=/tmp/skillmeat-stage
mkdir -p "$STAGE"
skillmeat deploy <X> --project "$STAGE" --overwrite --no-recipe-preview
```

**Step 4 — Overwrite staging with your version**

```bash
cp -rf /tmp/<X>-backup/. "$STAGE/.claude/skills/<X>/"
```

**Step 5 — Flow your version into the collection (provenance-preserving)**

`sync-pull --strategy overwrite` copies content + updates the lock hash. It never rewrites the manifest, so `origin`/`upstream`/`resolved_sha` are preserved.

```bash
skillmeat sync-pull "$STAGE" --strategy overwrite --artifacts <X> --no-interactive
```

**Step 6 — Deploy final version to your real project**

```bash
skillmeat deploy <X> --project <your-project-path> --overwrite --no-recipe-preview
```

**Step 7 — Verify**

```bash
skillmeat show <X>
# Expect: origin=github, upstream=<tree URL>, resolved_sha=<pinned SHA>

skillmeat sync-check <your-project-path>
# Expect: <X> absent from drift list (content_hash matches)
```

Also confirm `origin: github` in `collection.toml` directly if any doubt.

---

## Provenance Preservation Guarantee

`sync-pull --strategy overwrite` calls `_sync_overwrite` internally, which:
1. `shutil.copytree`s content files from the project into the collection.
2. Calls `_update_collection_lock` to refresh the content hash.
3. Does **not** call `save_collection()` or touch manifest metadata.

This means `origin`, `upstream`, `resolved_sha`, and all other manifest fields written during Step 2 survive the content overwrite.

---

## Gotchas

### Stale manifest metadata after content sync

`sync-pull --strategy overwrite` refreshes content but not `collection.toml` metadata fields like `metadata.description` or `metadata.extra.frontmatter.name`. After Step 5, `skillmeat show`/`list` and the web UI may still display the upstream baseline's description and name (e.g., showing `name: skill-builder` and a "35 tools" description while the on-disk content is your version).

**Why**: There is no supported "re-extract metadata from current content" path for a `github`-origin artifact. `update` for `origin=github` pulls upstream (clobbering your version); `_refresh_local_artifact` only runs for `origin=local`. The `PUT /api/v1/artifacts/{id}` endpoint does not write back to the manifest.

**Mitigation**: Treat the content hash match (`sync-check` shows artifact in-sync) as the real success criterion. Flag the stale description to the user. Do not hand-edit `collection.toml` in a large manifest (corruption risk). Enhancement candidates: `sync-pull --re-extract-metadata`, a `skillmeat artifact refresh-metadata <name>` command, or a manifest write-back in `PUT /artifacts/{id}`.

### `skillmeat history` empty in local edition

`add`, `sync-pull`, and `deploy` do not seed version/activity events in local edition (event seeding is a TODO in `artifact.py`). Provenance lives in `resolved_sha` and the content hash, not in history. Use `skillmeat show <X>` and `sync-check` for ground truth.

### `update --strategy upstream` will clobber your version

After linking, `skillmeat update <X>` (or `update --strategy upstream`) pulls the current upstream HEAD and overwrites your content. The artifact is pinned by default; no automatic update will occur unless you explicitly run `update`. Document this clearly to the user when handing off.

---

## Boundaries

- This workflow is for collection-level linking only. For adding a purely local artifact without upstream tracking, use `./deployment-workflow.md`.
- For snapshot and rollback operations, see `./versioning-workflow.md`.
- For syncing an already-linked artifact forward to a new upstream commit, use `skillmeat update <X>` (be aware of the clobber caveat above).
