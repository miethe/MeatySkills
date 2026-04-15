# Route 6: CI and Hook Integration Guide

Integrate the README build system with local development hooks and CI/CD pipelines to maintain README freshness automatically.

## Pre-Commit Hook (Local Development)

### Claude Code Hook

Create `.claude/hooks/check-readme-staleness.sh`:

```bash
#!/bin/bash
# Check if features.json or other build files are newer than README.md
FEATURES=".github/readme/data/features.json"
README="README.md"

if [ -f "$FEATURES" ] && [ -f "$README" ]; then
  if [ "$FEATURES" -nt "$README" ]; then
    echo "⚠️  README may be stale — features.json is newer"
    echo "   Run: node .github/readme/scripts/build-readme.js --root ."
    exit 0  # Warning only, don't block commit
  fi
fi
```

Wire into `.claude/settings.json`:

```json
{
  "hooks": {
    "PreCommit": [".claude/hooks/check-readme-staleness.sh"]
  }
}
```

### Git Hook (husky/lefthook)

For projects using husky or lefthook, create `.husky/pre-commit`:

```bash
#!/bin/bash
# Detect README build file changes and validate

if git diff --cached --name-only | grep -qE '\.github/readme/(data|partials|templates|scripts)/'; then
  echo "README build files changed — validating..."

  # Run validation only if changed
  node .github/readme/scripts/validate-links.js --root . || exit 1
  node .github/readme/scripts/check-screenshots.js --root . --required-only || exit 1
fi
```

Make it executable:
```bash
chmod +x .husky/pre-commit
```

## GitHub Actions Workflows

### Validation on PR (readme-validation.yml)

Create `.github/workflows/readme-validation.yml`:

```yaml
name: README Validation

on:
  pull_request:
    paths:
      - '.github/readme/**'
      - 'README.md'
      - 'docs/screenshots/**'
      - '.github/workflows/readme-validation.yml'

jobs:
  validate-readme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: '.github/readme/package-lock.json'

      - name: Install dependencies
        run: cd .github/readme && npm ci

      - name: Validate links
        run: node .github/readme/scripts/validate-links.js --root .

      - name: Check screenshots
        run: node .github/readme/scripts/check-screenshots.js --root . --required-only

      - name: Sync feature references
        run: node .github/readme/scripts/sync-features.js --root . --check-refs
```

### Auto-Rebuild on Data Changes (readme-autobuild.yml)

Create `.github/workflows/readme-autobuild.yml`:

```yaml
name: README Auto-Rebuild

on:
  push:
    branches: [main]
    paths:
      - '.github/readme/data/**'
      - '.github/readme/partials/**'
      - '.github/readme/templates/**'
      - '.github/readme/scripts/build-readme.js'

jobs:
  rebuild-readme:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: '.github/readme/package-lock.json'

      - name: Install dependencies
        run: cd .github/readme && npm ci

      - name: Rebuild README
        run: node .github/readme/scripts/build-readme.js --root .

      - name: Check for changes
        id: check
        run: |
          if git diff --quiet README.md; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi

      - name: Commit and push
        if: steps.check.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add README.md
          git commit -m "docs: auto-rebuild README from data changes"
          git push
```

## npm Scripts Integration

Add to `package.json` for local development commands:

```json
{
  "scripts": {
    "readme:build": "node .github/readme/scripts/build-readme.js --root .",
    "readme:validate": "node .github/readme/scripts/validate-links.js --root . && node .github/readme/scripts/check-screenshots.js --root . --required-only",
    "readme:preview": "node .github/readme/scripts/build-readme.js --root . --dry-run",
    "readme:watch": "nodemon --watch .github/readme/data --watch .github/readme/partials --watch .github/readme/templates --ext json --exec 'npm run readme:build'",
    "prepare": "husky install",
    "prepublishOnly": "npm run readme:validate"
  }
}
```

## Version Bump Integration

When bumping project version, trigger README version update:

```bash
#!/bin/bash
# In your release script (e.g., .github/scripts/release.sh)

NEW_VERSION=$1

# Update version in version.json
node .github/readme/scripts/update-version.js --root . --version "$NEW_VERSION"

# Rebuild README with new version
npm run readme:build

# Commit
git add README.md .github/readme/data/version.json
git commit -m "docs: update README and version to $NEW_VERSION"
```

Or use npm lifecycle hooks:

```json
{
  "scripts": {
    "version": "node .github/readme/scripts/update-version.js --root . --version $npm_package_version && npm run readme:build && git add README.md .github/readme/data/version.json"
  }
}
```

## Trigger Matrix

| Event | Files Changed | Action | Automated? | Blocks PR? |
|-------|---|---|---|---|
| Feature added to `features.json` | `.github/readme/data/features.json` | Rebuild README | Yes (CI) | No |
| Screenshot added | `docs/screenshots/**` | Rebuild README | Yes (CI) | No |
| Template/partial edited | `.github/readme/templates/**`, `.github/readme/partials/**` | Rebuild README | Yes (CI) | No |
| Version bump (npm) | `package.json` (version) | Update version.json + rebuild | Semi (npm hook) | No |
| Pre-commit (local) | Any | Staleness warning | Yes (hook) | No |
| PR with README changes | `.github/readme/**`, `README.md` | Validate links + screenshots | Yes (CI) | Yes |

## Setup Checklist

For a new project, wire up in this order:

- [ ] **1. Bootstrap** — Run Route 1 (create `.github/readme/` structure)
- [ ] **2. npm scripts** — Add `readme:*` scripts to `package.json`
- [ ] **3. Pre-commit hook** — Add Claude Code hook or husky setup
- [ ] **4. CI validation** — Add `.github/workflows/readme-validation.yml`
- [ ] **5. CI auto-rebuild** — Add `.github/workflows/readme-autobuild.yml` (optional, for auto-merging data changes)
- [ ] **6. Test** — Edit `features.json`, commit locally (should warn), push to PR (should validate)

## Troubleshooting

### Hook doesn't fire
- **Husky**: Run `husky install` and verify `.husky/pre-commit` is executable
- **Claude Code**: Check `.claude/settings.json` hook path is correct
- **Git**: Run `git config core.hooksPath` to verify hook dir

### Auto-rebuild doesn't commit
- **Permissions**: Ensure workflow has `contents: write` permission
- **Branch protection**: Check that auto-rebuild branch isn't protected (allow self-pushes)
- **Token**: If using custom token, verify it has repo write permissions

### Links/screenshots validation fails
- **Path resolution**: Ensure `--root .` points to repo root, not subdirectory
- **Node version**: Use Node 18+ (some script features require ES2020+)
- **Dependencies**: Run `cd .github/readme && npm ci` to ensure all deps installed

## References

- **Route 1**: Bootstrap the README build system (`./bootstrapping-readme-system.md`)
- **Route 2**: Plan and capture screenshot and GIF visual assets (`./screenshot-planning-guide.md`)
- **Route 3**: Content strategy, audience analysis, section structure (`./content-strategy-guide.md`)
- **Route 4**: Build and rebuild README from templates and data (`./build-and-rebuild-workflow.md`)
- **Route 5**: Validate links, screenshots, and feature references (`./validation-workflow.md`)
- **Route 6**: This guide (CI and hook integration)
