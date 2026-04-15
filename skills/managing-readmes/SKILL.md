---
name: managing-readmes
description: >
  Create, rebuild, or maintain a project README using a modular Handlebars build system.
  Covers bootstrapping the .github/readme/ scaffold for any project, planning screenshot
  and GIF visual assets, crafting content strategy (audience analysis, section structure,
  success metrics), assembling or rebuilding README.md from partials and data files,
  validating links and screenshots, and wiring CI workflows or pre-commit hooks for
  README freshness. Also use when a version bump, feature addition, or screenshot update
  requires regenerating README content. Supports CLI tools, web apps, libraries, and
  SaaS products.
---

# Managing READMEs

## When to Use This Skill

Route selection table:

| User Request | Route | Action |
|---|---|---|
| "set up README build" / "scaffold README system" | Route 1: Bootstrap | See `./bootstrapping-readme-system.md` |
| "plan screenshots" / "what screenshots do I need" | Route 2: Screenshot Planning | See `./screenshot-planning-guide.md` |
| "README content strategy" / "structure my README" | Route 3: Content Strategy | See `./content-strategy-guide.md` |
| "rebuild README" / "update README" / "regenerate" | Route 4: Build & Rebuild | Inline below |
| "validate README" / "check links" / "README broken" | Route 5: Validate | Inline below |
| "README CI" / "auto-update README" / "README hook" | Route 6: Workflow Integration | See `./ci-and-hook-integration.md` |

## Route 1: Bootstrap (Summary)

Run `node scripts/bootstrap.js --project-type [cli|web|library|saas]` to scaffold `.github/readme/` with templates, data files, and partials. Supports `--output`, `--name`, and `--force` flags. After scaffolding, run `node scripts/analyze-project.js` to auto-populate `features.json` from your codebase. See `./bootstrapping-readme-system.md` for full post-bootstrap workflow and template customization for different project types.

## Route 2: Screenshot Planning (Summary)

Enumerate all capturable surfaces (web pages, CLI commands, endpoints, states). Generate `screenshots.json` with capture instructions, tool recommendations, and asset metadata. Primary capture via Chrome MCP tools for web; CLI screenshots via terminal capture. See `./screenshot-planning-guide.md` for surface enumeration patterns, state identification, and GIF recording workflows.

## Route 3: Content Strategy (Summary)

Audience analysis, section priority by project type, prose style guide, success metrics for README effectiveness. Self-contained framework: analyze reader motivations (DevOps, end users, architects), structure content by priority (above-the-fold, scanning, depth), enforce style consistency. See `./content-strategy-guide.md` for decision windows, section templates, and tone guidelines.

## Route 4: Build & Rebuild (Inline)

```bash
node scripts/build-readme.js --root .                        # full rebuild
node scripts/build-readme.js --root . --dry-run              # preview
node scripts/update-version.js --root . --version X.Y.Z      # version bump
```

For partial update patterns and template authoring, see `./build-and-rebuild-workflow.md`.

## Route 5: Validate (Inline)

```bash
node scripts/validate-links.js --root .                                          # internal links
node scripts/validate-links.js --root . --check-external                         # + external URLs
node scripts/check-screenshots.js --root . --required-only                       # screenshot check
node scripts/validate-links.js --root . && node scripts/check-screenshots.js --root . --required-only  # CI suite
```

Exit codes: 0 = pass, 1 = fail. For failure triage, see `./validation-workflow.md`.

## Route 6: Workflow Integration (Summary)

Wire README validation into CI (GitHub Actions), pre-commit hooks (Claude Code or git), and version bump scripts for automated freshness checks. Includes complete GitHub Actions workflows for PR validation and auto-rebuild on version changes. See `./ci-and-hook-integration.md` for ready-to-use YAML workflows and hook scripts.

## Data File Reference

Quick reference for the 3 core data files:

### features.json

Structure driving feature grid, CLI commands list, feature counts:

```json
{
  "categories": [
    {
      "id": "core-id",
      "name": "Core Features",
      "features": [
        {
          "id": "feature-1",
          "name": "Feature Name",
          "description": "What it does",
          "since": "1.0.0",
          "highlighted": true,
          "cliCommand": "skillmeat feature-1 [options]",
          "webPage": "/artifacts",
          "screenshot": "feature-1.png"
        }
      ]
    }
  ]
}
```

Schema: `./data-schemas/features.schema.json`

### screenshots.json

Structure driving screenshot table, category grouping, status tracking:

```json
{
  "screenshots": [
    {
      "id": "screenshot-1",
      "file": "docs/screenshots/feature-1.png",
      "alt": "Feature 1 in action",
      "status": "captured",
      "category": "readme",
      "page": "/artifacts",
      "width": 1280,
      "height": 720,
      "capturedAt": "2025-03-12T10:00:00Z",
      "notes": "Shows feature grid with 3 items"
    }
  ],
  "gifs": [
    {
      "id": "gif-1",
      "file": "docs/gifs/deployment-flow.gif",
      "alt": "Deployment workflow animation",
      "tool": "chrome-mcp",
      "sequence": ["navigate-to-deploy", "fill-form", "submit", "confirm"]
    }
  ]
}
```

Status values: `pending` (not captured), `captured` (ready to use), `outdated` (needs refresh)

Schema: `./data-schemas/screenshots.schema.json`

### version.json

Structure driving version badges, release metadata, staleness checks:

```json
{
  "current": "1.2.0",
  "releaseDate": "2025-03-12",
  "releaseNotes": "New features and bug fixes",
  "previousVersions": [
    { "version": "1.1.0", "releaseDate": "2025-02-15" },
    { "version": "1.0.0", "releaseDate": "2025-01-01" }
  ]
}
```

Schema: `./data-schemas/version.schema.json`

## Handlebars Helper Reference

| Helper | Purpose | Example |
|---|---|---|
| `formatDate` | Locale date string | `{{formatDate date "short"}}` |
| `isoDate` | Current ISO timestamp | `Generated {{isoDate}}` |
| `filter` | Array filter by key/value | `{{#filter items "status" "active"}}...{{/filter}}` |
| `eq` | Equality conditional | `{{#if (eq status "done")}}...{{/if}}` |
| `count` | Array length | `Total: {{count features}}` |
| `join` | Join with separator | `{{join tags ", "}}` |
| `isOdd` | Alternating row detection | `{{#if (isOdd @index)}}...{{/if}}` |
| `highlightedFeatures` | Flatten highlighted features across categories | `{{#each (highlightedFeatures categories)}}...{{/each}}` |
| `screenshotsByCategory` | Filter screenshots by category | `{{#each (screenshotsByCategory screenshots "readme")}}...{{/each}}` |
| `totalFeatures` | Count all features | `{{totalFeatures categories}} total` |
| `hasCliCommands` | Boolean: any feature has CLI command | `{{#if (hasCliCommands categories)}}...{{/if}}` |
| `cliCommands` | Comma-joined CLI list | `{{cliCommands categories}}` |

See `./build-and-rebuild-workflow.md` § "Handlebars Helper Reference" for complete helper details and conditional rendering patterns.

## Scripts Reference

The README build system includes 8 scripts for different stages of the README lifecycle:

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `bootstrap.js` | Scaffold `.github/readme/` for any project type | Project type (cli/web/library/saas) | Full directory structure + templates + data files |
| `analyze-project.js` | Auto-populate `features.json` from project analysis | `package.json`, routes, OpenAPI, Python CLIs | Updated `features.json` |
| `generate-screenshot-spec.js` | Generate `screenshots.json` spec from surfaces | Project structure + UI/CLI surfaces | Initial `screenshots.json` |
| `build-readme.js` | Main build engine — compiles README from partials + data | Templates, partials, data files | Generated `README.md` |
| `validate-links.js` | Check internal links, relative refs, image paths | README.md + referenced files | Exit 0 (pass) or 1 (fail) |
| `check-screenshots.js` | Verify screenshots exist, dimensions match spec | `screenshots.json` + image files | Exit 0 or 1; detailed error report |
| `sync-features.js` | Detect orphaned features, missing references | `features.json` + templates | Feature sync report |
| `update-version.js` | Bump version in `version.json` and package.json | Version string (e.g., 2.0.0) | Updated files + rebuild trigger |

All scripts accept `--dry-run` (preview without writing) and `--verbose` (detailed output) flags. Run from project root.

## Agent Delegation Patterns

When to delegate vs. execute directly:

| Task | Delegate To | Notes |
|---|---|---|
| Run project analysis | `codebase-explorer` or direct (`analyze-project.js`) | Symbol-first discovery, or script auto-populates `features.json` |
| Scaffold bootstrap | Direct (`bootstrap.js`) | Script scaffolds entire `.github/readme/` structure |
| Generate screenshot spec | Direct (`generate-screenshot-spec.js`) | Script generates initial `screenshots.json` from project surfaces |
| Content strategy | Direct (Sonnet) | Inline reasoning; no multi-system synthesis |
| Web screenshot capture | Chrome MCP tools | Use directly; integrated with Claude Code |
| GIF recording | Chrome MCP `gif_creator` | Record sequences; tool-native workflow |
| Build & validate scripts | Direct (Bash/Node.js) | No delegation — scripts are standalone |
| CI workflow authoring | Direct (Sonnet) or `python-backend-engineer` | YAML expertise; can be manual or delegated |

## Cross-Tool Compatibility

All scripts in `scripts/` are plain Node.js (ESM). They work with any agent or CI system without Claude Code-specific features:

```bash
# Install dependencies (once per project)
npm ci

# Run any script standalone
node scripts/build-readme.js --root .
node scripts/validate-links.js --root .
node scripts/check-screenshots.js --root .
```

**Claude Code enhancements** (when using this skill):
- Direct Skill invocation for workflows
- Chrome MCP integration for web screenshot capture
- Pre-commit hook scaffolding with `git` CLI

**Other agents** (Cursor, Codex, Gemini):
- Use scripts directly — they're universal Node.js
- Reference Route guides as documentation
- No special setup needed

**CI systems** (GitHub Actions, GitLab CI):
- Use scripts in workflow YAML
- Exit codes integrate with CI gates
- No Node.js CLI tooling required beyond `npm ci`

## Quick Workflows

### Add Feature & Rebuild

```bash
# 1. Edit data/features.json — add feature object to category
# 2. Rebuild
node scripts/build-readme.js --root .
# 3. Verify feature in grid + CLI list (if applicable)
```

### Update Screenshot & Rebuild

```bash
# 1. Place new screenshot in docs/screenshots/
# 2. Edit data/screenshots.json — add/update entry
# 3. Verify file exists
node scripts/check-screenshots.js --root .
# 4. Rebuild
node scripts/build-readme.js --root .
```

### Version Bump & Rebuild

```bash
# 1. Bump version
node scripts/update-version.js --root . --version 2.0.0
# 2. Rebuild README
node scripts/build-readme.js --root .
# 3. Validate
node scripts/validate-links.js --root . && \
node scripts/check-screenshots.js --root . --required-only
```

### Dry-Run Before Committing

```bash
# Preview changes without writing files
node scripts/build-readme.js --root . --dry-run

# Review output, then commit
git add data/ partials/ README.md
git commit -m "docs: update README with new features"
```

## File Organization

```
project/
├── README.md                     ← Generated (commit alongside source)
├── package.json                  ← Declares build scripts
├── .github/readme/               ← README build system (or custom location)
│   ├── data/
│   │   ├── features.json         ← Feature definitions + highlights
│   │   ├── screenshots.json      ← Screenshot metadata + GIF specs
│   │   └── version.json          ← Version + release info
│   ├── templates/
│   │   ├── README.hbs            ← Main template (layout + structure)
│   │   ├── feature-grid.hbs      ← Feature grid partial
│   │   ├── screenshot-table.hbs  ← Screenshot table partial
│   │   ├── command-list.hbs      ← CLI commands partial
│   │   └── hero-section.hbs      ← Hero section partial
│   ├── partials/                 ← Content partials (custom per project)
│   │   ├── intro.md
│   │   ├── installation.md
│   │   ├── usage.md
│   │   ├── api.md
│   │   └── contributing.md
│   ├── scripts/
│   │   ├── bootstrap.js          ← Scaffold .github/readme/ structure
│   │   ├── analyze-project.js    ← Auto-populate features.json
│   │   ├── generate-screenshot-spec.js ← Generate screenshots.json
│   │   ├── build-readme.js       ← Main builder
│   │   ├── validate-links.js     ← Link validator
│   │   ├── check-screenshots.js  ← Screenshot checker
│   │   ├── sync-features.js      ← Feature sync validator
│   │   └── update-version.js     ← Version updater
│   └── data-schemas/
│       ├── features.schema.json
│       ├── screenshots.schema.json
│       └── version.schema.json
└── docs/screenshots/             ← Captured screenshots (referenced by JSON)
```

For troubleshooting build failures and validation errors, see `./validation-workflow.md` § Common Failure Triage.

## Key Principles

1. **Idempotent builds**: Running `build-readme.js` twice produces identical output
2. **Commit source + output**: Generate README.md, but commit both source files (JSON, partials) and output
3. **Data drives content**: Changes to `data/*.json` don't require template edits
4. **Validation gates CI**: Use `--required-only` mode in CI to skip expensive checks
5. **Partial reusability**: Keep partials focused — one section per file for easy updates
6. **Version as source of truth**: `data/version.json` drives all badges and release metadata; keep in sync with package.json

---

**For routes 1, 2, 3, and 6 details, see supporting files:**
- Route 1: `./bootstrapping-readme-system.md`
- Route 2: `./screenshot-planning-guide.md`
- Route 3: `./content-strategy-guide.md`
- Route 4: `./build-and-rebuild-workflow.md` (detailed patterns)
- Route 5: `./validation-workflow.md` (detailed patterns)
- Route 6: `./ci-and-hook-integration.md`
