# Release Orchestration Workflow

Single linear flow for executing a complete, validated SkillMeat release.
Steps are ordered and non-optional. Do not reorder or skip steps.

**Canonical specs**: `.claude/specs/version-bump-spec.md`, `.claude/specs/changelog-spec.md`
**Scripts**: `.claude/skills/release/scripts/rollover-changelog.py`, `.claude/skills/release/scripts/audit-coverage.py`

---

## Prerequisites

Before starting:

- You are on the `main` branch (or the designated release branch) with a clean working tree.
- `[Unreleased]` in `CHANGELOG.md` has entries for the changes being released.
- The target version string `NEW_VERSION` (semver: `X.Y.Z`) has been decided.
- `gh` CLI is authenticated (`gh auth status`).

```bash
NEW_VERSION="X.Y.Z"
BUMP_DATE=$(date +%Y-%m-%d)
```

---

## Step 1: Version Bump

Update all 5 canonical version locations as defined in `.claude/specs/version-bump-spec.md §Manual Update Required`.

```bash
# 1a. Python source of truth
sed -i '' "s/__version__ = \".*\"/__version__ = \"${NEW_VERSION}\"/" skillmeat/__init__.py

# 1b. pyproject.toml
sed -i '' "s/^version = \".*\"/version = \"${NEW_VERSION}\"/" pyproject.toml

# 1c. Frontend package.json (no git tag)
cd skillmeat/web && npm version ${NEW_VERSION} --no-git-tag-version && cd ../..

# 1d. README build data
python -c "
import json
for f in ['.github/readme/data/version.json', '.github/readme/data/features.json', '.github/readme/data/screenshots.json']:
    with open(f) as fh: data = json.load(fh)
    if 'current' in data: data['current'] = '${NEW_VERSION}'
    if 'version' in data: data['version'] = '${NEW_VERSION}'
    with open(f, 'w') as fh: json.dump(data, fh, indent=2); fh.write('\n')
"

# 1e. Doc references
sed -i '' "s/<!-- VERSION: .* -->/<!-- VERSION: ${NEW_VERSION} -->/" README.md
sed -i '' "s/(v[0-9]*\.[0-9]*\.[0-9]*[-a-z]*)/(v${NEW_VERSION})/" CLAUDE.md
```

**Validation** (run before proceeding):

```bash
python -c "import skillmeat; print(skillmeat.__version__)"   # must print NEW_VERSION
grep '"version"' pyproject.toml                               # must match
grep '"version"' skillmeat/web/package.json                  # must match
grep 'VERSION:' README.md                                     # must match
```

> If any validation fails, fix the discrepancy before continuing. Do not proceed to Step 2 with mismatched version strings.

---

## Step 2: Regen OpenAPI

Regenerate `skillmeat/api/openapi.json` from the live FastAPI app so the spec reflects the new version and any route changes.

```bash
python -c "from skillmeat.api.openapi import export_openapi_spec; export_openapi_spec()"
```

If `export_openapi_spec` is unavailable (import error), fall back to patching the 4 version occurrences manually:

```bash
sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"${NEW_VERSION}\"/" skillmeat/api/openapi.json
sed -i '' "s/\"x-package-version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"x-package-version\": \"${NEW_VERSION}\"/" skillmeat/api/openapi.json
```

**Validation**:

```bash
jq '.info.version' skillmeat/api/openapi.json   # must print "NEW_VERSION"
```

> Per SPEC.md Invariant 4: this step must complete before Step 3 (SDK regen). Never skip or reverse the order.

---

## Step 3: Regen SDK

Regenerate the TypeScript SDK client artifacts that derive from `openapi.json`.

```bash
cd skillmeat/web && pnpm generate-sdk && cd ../..
```

Generated files (do not edit manually):
- `skillmeat/web/sdk/core/OpenAPI.ts`
- `skillmeat/web/sdk/SkillMeatClient.ts`

**Validation**: Confirm both files contain the new version string or that generation exited zero without errors. If `pnpm generate-sdk` is not available or fails, log the error and continue — SDK regen failure is non-blocking for the audit gate but must be documented in the release notes.

---

## Step 4: Audit Gate

Run `audit-coverage.py` to validate that `[Unreleased]` in `CHANGELOG.md` covers all commits since the last tagged release. **This step gates tagging.** The audit must exit zero before proceeding to Step 5.

```bash
python .claude/skills/release/scripts/audit-coverage.py \
  --changelog CHANGELOG.md \
  --version ${NEW_VERSION}
```

### Audit Passes (exit 0)

Continue to Step 5.

### Audit Fails (exit non-zero)

1. Print the full gap list to the operator (the script writes it to stdout).
2. **Halt the release flow.** Do not proceed to rollover, commit, or tag.
3. Instruct the operator:

   > The following commits are not represented in `[Unreleased]`. Update `CHANGELOG.md` to cover them, then re-run the release flow from Step 4.

4. Wait for operator action. Do not proceed automatically.

### Force-Bypass Protocol

If the operator explicitly passes `--force` (or requests that the audit gate be skipped), the workflow may continue past a failing audit. This bypass is **strictly opt-in by a human operator** — agents must never decide to pass `--force` on their own.

Before continuing after `--force`:

1. Print a visible warning:

   ```
   WARNING: Audit gate bypassed with --force. The following commits are not covered
   in [Unreleased] and will be absent from the release notes:
   <gap list>
   Proceeding requires explicit operator confirmation.
   ```

2. Prompt the operator for confirmation ("yes" / "y" required; anything else halts).
3. Only after confirmation: continue to Step 5.

> The `--force` bypass is intended for emergency releases where an incomplete CHANGELOG is an acceptable tradeoff. It is not a shortcut for routine use.

---

## Step 5: Rollover Changelog

Rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` and insert a fresh empty `[Unreleased]` section above it.

```bash
python .claude/skills/release/scripts/rollover-changelog.py \
  --version ${NEW_VERSION} \
  --date ${BUMP_DATE}
```

**Expected outcomes**:

| Condition | Behavior |
|-----------|----------|
| `[Unreleased]` has entries | Renamed to `[X.Y.Z]`; fresh empty `[Unreleased]` inserted above it — exit 0 |
| `[Unreleased]` already rolled for this version | Script emits a warning and exits without modifying the file — exit 0 (idempotent) |
| `[Unreleased]` is missing entirely | Script exits with an error — **halt, do not tag** |

**Validation**:

```bash
grep "\[${NEW_VERSION}\]" CHANGELOG.md      # version heading must exist
grep "\[Unreleased\]" CHANGELOG.md          # fresh Unreleased section must exist
```

> Per SPEC.md Invariant 3: `rollover-changelog.py` must complete successfully before `git tag` is created. A tag must never be cut against a CHANGELOG with `[Unreleased]` as the current-version header.

---

## Step 6: Skill Alignment Check (Advisory)

**Purpose**: Surface skills whose `aligned_app_version` is behind the release version, so the
operator can decide whether a follow-up update is warranted.

**Action**: Run the alignment check from `.claude/specs/version-bump-spec.md §Step 10`.

```bash
echo "Skills with stale aligned_app_version:"
grep -rl "aligned_app_version:" .claude/skills/*/SPEC.md 2>/dev/null | while read f; do
  ver=$(grep "aligned_app_version:" "$f" | sed 's/.*: *//' | tr -d '"')
  if [ "$ver" != "${NEW_VERSION}" ]; then
    echo "  $f → aligned at $ver (current: ${NEW_VERSION})"
  fi
done
```

**Decision gate**: This step is advisory. Stale skills do NOT block the release. Options:
1. Update skills now (in the same release commit) if CLI surface changed
2. Defer to a follow-up PR if changes are non-trivial
3. Skip if the skill's CLI surface didn't change

**When to update a skill**: Only when commands, flags, or CLI behaviors the skill documents have
changed. A version bump alone does not require a skill update.

---

## Step 7: Git Commit

Stage all version bump and changelog changes and create the release commit.

```bash
git add \
  skillmeat/__init__.py \
  pyproject.toml \
  skillmeat/web/package.json \
  skillmeat/web/package-lock.json \
  skillmeat/api/openapi.json \
  skillmeat/web/sdk/core/OpenAPI.ts \
  skillmeat/web/sdk/SkillMeatClient.ts \
  .github/readme/data/version.json \
  .github/readme/data/features.json \
  .github/readme/data/screenshots.json \
  README.md \
  CLAUDE.md \
  CHANGELOG.md

git commit -m "chore(release): bump version to ${NEW_VERSION}"
```

> Do not use `git add -A` or `git add .` — stage only the known version files listed above to avoid accidentally including unrelated changes.

---

## Step 8: Git Tag

Create an annotated tag at the release commit.

```bash
git tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}: <brief one-line description of this release>"
```

**Confirm before running**: this is a destructive, push-forward operation. In interactive contexts, ask the operator to confirm the tag message before executing.

Push the tag:

```bash
git push origin "v${NEW_VERSION}"
```

---

## Step 9: GitHub Release

Create the GitHub release from the tag. The release notes should summarize the `[X.Y.Z]` section of `CHANGELOG.md`.

```bash
gh release create "v${NEW_VERSION}" \
  --title "v${NEW_VERSION}: <release title>" \
  --notes "$(python -c "
import re, sys
with open('CHANGELOG.md') as f:
    txt = f.read()
# Extract the section for this version
m = re.search(r'## \[${NEW_VERSION}\][^\n]*\n(.*?)(?=^## \[|\Z)', txt, re.M | re.S)
print(m.group(1).strip() if m else 'See CHANGELOG.md for details.')
")"
```

Alternatively, open the release in the browser to edit notes manually:

```bash
gh release create "v${NEW_VERSION}" \
  --title "v${NEW_VERSION}: <release title>" \
  --notes-from-tag \
  --draft
```

Review the draft in the GitHub UI, finalize, and publish.

---

## Full Sequence Summary

```
Step 1: Version Bump      — 5 locations per version-bump-spec.md
Step 2: Regen OpenAPI     — export_openapi_spec() or sed fallback
Step 3: Regen SDK         — pnpm generate-sdk
Step 4: Audit Gate        — audit-coverage.py; exit non-zero HALTS
Step 5: Rollover          — rollover-changelog.py
Step 6: Skill Alignment   — advisory check; does not block release
Step 7: Git Commit        — stage known files only
Step 8: Git Tag           — annotated tag + push
Step 9: GitHub Release    — gh release create
```

Steps 1–6 are non-destructive (or advisory). Steps 7–9 are destructive and require operator confirmation in interactive contexts.

---

## Validation Checklist (Post-Release)

Per `.claude/specs/version-bump-spec.md §Validation Checklist`:

- [ ] `python -c "import skillmeat; print(skillmeat.__version__)"` prints `NEW_VERSION`
- [ ] `grep '"version"' pyproject.toml` matches `NEW_VERSION`
- [ ] `grep '"version"' skillmeat/web/package.json` matches `NEW_VERSION`
- [ ] `jq '.info.version' skillmeat/api/openapi.json` matches `NEW_VERSION`
- [ ] `grep 'VERSION:' README.md` matches `NEW_VERSION`
- [ ] `pytest tests/test_smoke.py -v` passes
- [ ] `pytest tests/unit/test_version_capture.py -v` passes
- [ ] `CHANGELOG.md`: `[Unreleased]` section is empty (rolled forward); `[X.Y.Z]` section exists with date
- [ ] `git tag` lists `vX.Y.Z`
- [ ] `gh release list` shows `vX.Y.Z` as the latest release
