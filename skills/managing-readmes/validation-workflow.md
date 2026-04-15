# Validation Workflow (Route 5)

Commands, triage patterns, and CI integration for README link validation and screenshot verification.

## Validation Commands

All commands execute from project root. All exit with 0 (pass) or 1 (failure).

### Validate Internal Links
```bash
node scripts/validate-links.js --root /path/to/project
```
Checks all Markdown links within the project (anchors, relative file refs, images).

### Validate External URLs
```bash
node scripts/validate-links.js --root /path/to/project --check-external
```
Also validates external http/https URLs. Slower; requires network access. Use in CI with timeout protection.

### Check Screenshots Exist
```bash
node scripts/check-screenshots.js --root /path/to/project
```
Verifies all files referenced in `data/screenshots.json` exist on disk with correct dimensions.

### Check README-Category Screenshots Only
```bash
node scripts/check-screenshots.js --root /path/to/project --category readme
```
Filter to `category === "readme"` before checking.

### CI Mode (Skip Pending)
```bash
node scripts/check-screenshots.js --root /path/to/project --required-only
```
Only check screenshots with `status: "required"` or `status: "captured"`. Skip `pending`. Use in automated CI.

### Validate Feature References
```bash
node scripts/sync-features.js --root /path/to/project --check-refs --verbose
```
Ensures all feature IDs referenced in `data/screenshots.json` exist in `data/features.json`. Verbose mode prints each check.

### Full Pre-Commit Validation
```bash
node scripts/validate-links.js --root . && \
node scripts/check-screenshots.js --root . --required-only && \
node scripts/sync-features.js --root . --check-refs
```
All critical checks in sequence. Fail-fast; exits on first failure.

## Exit Codes

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | All checks passed | Safe to commit/merge |
| 1 | At least one check failed | Fix errors before proceeding |

All validators are CI-compatible: exit 0/1 only, no partial success codes.

## Freshness Heuristics

README staleness is detected by comparing file modification times:

- **README stale vs features**: `data/features.json` mtime > `README.md` mtime
- **README stale vs version**: `data/version.json` mtime > `README.md` mtime
- **Screenshot stale**: Referenced page was modified after capture timestamp in `data/screenshots.json`

### Quick Staleness Check
```bash
# Is features.json newer than README?
if [ "data/features.json" -nt "README.md" ]; then
  echo "README likely stale — rebuild recommended"
fi

# Is version.json newer?
if [ "data/version.json" -nt "README.md" ]; then
  echo "Version info changed — rebuild recommended"
fi
```

## Staleness Detection

Implement staleness checks before operations that depend on current README content:

1. **Check feature grid staleness**: Compare `data/features.json` mtime vs `README.md`
2. **Check screenshot references**: Compare `data/screenshots.json` mtime vs `README.md`
3. **Check version badges**: Compare `data/version.json` mtime vs `README.md`

If any source is newer, recommend rebuild before proceeding with validation.

## Common Failure Triage

| Failure | Cause | Fix |
|---------|-------|-----|
| `validate-links: broken internal link` | File moved, renamed, or deleted | Update link path in partial/template or restore file |
| `validate-links: broken anchor #section` | Section header changed or removed | Update anchor to match current heading in target file |
| `validate-links: broken external URL` | Remote page moved, deleted, or DNS down | Update URL to current location or mark as known-broken in validation config |
| `check-screenshots: file not found` | Screenshot not yet captured | Capture missing screenshot or mark status as `pending` |
| `check-screenshots: wrong dimensions` | Screenshot captured at different viewport | Recapture with correct preset (1280x720, 800x600, mobile, etc.) |
| `check-screenshots: file too old` | Reference page was modified after capture | Recapture to refresh, or document reason for stale screenshot |
| `sync-features: orphaned reference` | Feature ID changed in `features.json` | Update all references in `screenshots.json` to new ID |
| `sync-features: missing screenshot ref` | New feature without corresponding screenshot | Plan and capture screenshot, or remove feature from highlight list |

### Triage Workflow
1. Run validator → capture failure output
2. Identify failure pattern from table above
3. Apply fix to appropriate file
4. Re-run single validator to verify fix
5. If multiple failures, re-run full suite

## CI Integration Quick Reference

### When to Run Validators
Run in CI after any PR that touches:
- `.github/readme/**` — any data, template, or partial change
- `README.md` — direct edits (should trigger rebuild, flag as error)
- `docs/screenshots/**` — screenshot file additions/updates
- `data/` — feature/version/screenshot data changes

### Pre-Merge Validation
```bash
# Full suite for PR merge gate
node scripts/validate-links.js --root . || exit 1
node scripts/check-screenshots.js --root . --required-only || exit 1
node scripts/sync-features.js --root . --check-refs || exit 1
echo "All validations passed"
```

### Handling CI Failures
- **Link failures**: Review error message → update partial/template → force rebuild
- **Screenshot failures**: Capture missing/stale screenshots → re-run validator
- **Feature reference failures**: Fix orphaned IDs → re-run validator

Do not merge PRs with validation failures.

## When to Run Which Validator

| Situation | Command | Reason |
|-----------|---------|--------|
| After rebuilding README | `validate-links` | Ensure rebuild didn't break internal structure |
| After adding new screenshots | `check-screenshots --required-only` | Verify files exist and are correct size |
| After editing `features.json` | `sync-features --check-refs --verbose` | Ensure no orphaned references |
| Before PR merge (CI gate) | All three in sequence | Comprehensive validation before production |
| Quick sanity check | `validate-links` only | Fastest check for link integrity |
| Manual pre-commit | All three | Developer verification before commit |
| Post-deployment validation | `validate-links --check-external` | Verify all external links still valid |

## Validator Output Format

### validate-links Output
```
✓ Internal links: 12/12 valid
✓ Relative paths: 5/5 valid
✓ Anchors: 8/8 valid
✓ Images: 3/3 found
Validation passed (exit 0)
```

Failures show:
```
✗ Broken link: docs/api/README.md (referenced at line 42)
✗ Broken anchor: #install-from-source (referenced at line 15)
Validation failed (exit 1)
```

### check-screenshots Output
```
✓ docs/screenshots/feature-1.png [1280x720]
✓ docs/screenshots/feature-2.png [1280x720]
✓ 2/2 screenshots verified
Validation passed (exit 0)
```

Failures show:
```
✗ docs/screenshots/missing.png [not found]
✗ docs/screenshots/wrong-size.png [expected 1280x720, got 1024x576]
Validation failed (exit 1)
```

### sync-features Output
```
✓ feature-1: referenced in 1 screenshot
✓ feature-2: referenced in 0 screenshots
✓ All references valid
Validation passed (exit 0)
```

Failures show:
```
✗ feature-old: no longer in features.json (orphaned in screenshots.json)
✗ feature-new: referenced in screenshots.json but not in features.json
Validation failed (exit 1)
```

## CI Configuration Example

### GitHub Actions Workflow
```yaml
name: README Validation

on:
  pull_request:
    paths:
      - '.github/readme/**'
      - 'README.md'
      - 'data/**'
      - 'docs/screenshots/**'

jobs:
  validate-readme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Validate links
        run: node scripts/validate-links.js --root .

      - name: Check screenshots
        run: node scripts/check-screenshots.js --root . --required-only

      - name: Verify feature references
        run: node scripts/sync-features.js --root . --check-refs
```

### Local Pre-Commit Hook
```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running README validation..."
node scripts/validate-links.js --root . || exit 1
node scripts/check-screenshots.js --root . --required-only || exit 1
node scripts/sync-features.js --root . --check-refs || exit 1

echo "README validation passed"
exit 0
```

## Error Recovery

### Validator Timeouts (External URLs)
If `--check-external` hangs on a specific URL:
1. Cancel with Ctrl+C
2. Run without `--check-external`
3. Manually verify the problematic URL
4. Add to known-broken config (if applicable)

### Partial Failures
If validators report inconsistent results:
1. Delete any cached data: `rm -rf .readme-build-cache/`
2. Rebuild README: `node scripts/build-readme.js --root .`
3. Re-run validators

### Missing Data Files
If validator complains about missing `data/screenshots.json`:
1. Ensure `.github/readme/` directory exists
2. Ensure all required data files are present
3. Run dry-build to verify: `node scripts/build-readme.js --root . --dry-run`
