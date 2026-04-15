# Bootstrapping the README Build System (Route 1)

This is the detailed Route 1 reference for scaffolding a `.github/readme/` directory structure with everything needed to build READMEs from modular templates and data files. The `bootstrap.js` script handles scaffolding; this guide explains the decisions, workflow, and customization patterns.

## Quick Start

```bash
# Scaffold for a web app (creates .github/readme/)
node scripts/bootstrap.js --project-type web --name "My App"

# Scaffold for a CLI tool
node scripts/bootstrap.js --project-type cli --name "mytool"

# Scaffold for a library
node scripts/bootstrap.js --project-type library --output .github/readme

# Scaffold for a SaaS platform
node scripts/bootstrap.js --project-type saas --force

# Install dependencies
cd .github/readme && npm install

# Preview what will be generated (dry-run)
node scripts/build-readme.js --dry-run

# Generate README.md
node scripts/build-readme.js
```

## What Bootstrap Creates

The `bootstrap.js` script creates a complete, ready-to-customize README build system:

```
.github/readme/                    # Main build directory
├── package.json                   # ESM, handlebars dependency
├── scripts/                       # Copy these from the skill directory
│   ├── build-readme.js           # Main build script
│   ├── validate-links.js         # Link validation
│   ├── check-screenshots.js      # Screenshot checker
│   ├── sync-features.js          # Feature sync validator
│   └── update-version.js         # Version updater
├── templates/
│   └── README.hbs                # Main template (project-type-specific layout)
├── partials/
│   ├── hero.md                   # Project name + tagline (TODO: fill in)
│   ├── quickstart.md             # Type-specific getting started (TODO: customize)
│   ├── features.md               # Feature grid section (auto-populated)
│   ├── contributing.md           # Standard contributing guide
│   └── footer.md                 # License + metadata footer
├── data/
│   ├── features.json             # Categories + seeded placeholder features (TODO: populate)
│   ├── screenshots.json          # Pending screenshot entries (TODO: capture)
│   └── version.json              # Starts at 0.1.0 with today's date
└── data-schemas/
    ├── features.schema.json      # JSON schema for features.json
    ├── screenshots.schema.json   # JSON schema for screenshots.json
    └── version.schema.json       # JSON schema for version.json
```

## Project Type Matrix

Bootstrap provides opinionated starting points based on your project type. Customize after scaffolding:

| Type | Feature Categories Seeded | Screenshots Seeded | Template Focus | Quickstart Pattern |
|------|--------------------------|-------------------|----------------|--------------------|
| `cli` | Core Commands, Configuration, Output | 1 terminal + 1 GIF | Commands-first layout | `<binary> init` example |
| `web` | User Interface, Data Management, Authentication | 2 pages + 1 GIF | Screenshots-first layout | signup/login flow |
| `library` | Core API, Utilities, Configuration | 1 code example | API/usage-first layout | `npm install` + minimal example |
| `saas` | Platform, Integrations, Administration | 2 pages + 1 GIF | Dashboard-first layout | Free account signup |

## Bootstrap Options

### Command-Line Flags

```bash
--project-type <type>     Required. One of: cli, web, library, saas
--output <dir>            Target directory relative to cwd (default: .github/readme)
--name <name>             Project name. Auto-derived from package.json or dirname if omitted
--force                   Overwrite existing files (default: skip existing files)
--help, -h                Show help message
```

### Examples

```bash
# Web app with custom name
node bootstrap.js --project-type web --name "Acme Dashboard"

# CLI tool with custom output path
node bootstrap.js --project-type cli --output .readme-build

# Library, overwrite existing scaffold
node bootstrap.js --project-type library --force

# SaaS, auto-detect project name from package.json
node bootstrap.js --project-type saas
```

## Bootstrap Workflow

### Step 1: Run Bootstrap

```bash
cd your-project/
node /path/to/managing-readmes/scripts/bootstrap.js --project-type [cli|web|library|saas]
```

Bootstrap creates the directory structure and seed data. It prints what was created vs. skipped:

```
Bootstrapping web README build system
  Project : My App
  Output  : /Users/you/project/.github/readme
  Force   : false

Created:
  + package.json
  + templates/README.hbs
  + partials/hero.md
  + partials/quickstart.md
  + partials/features.md
  + partials/contributing.md
  + partials/footer.md
  + data/features.json
  + data/screenshots.json
  + data/version.json

Done. Next steps:
  1. cd .github/readme
  2. npm install          # install handlebars
  3. Copy build scripts from the managing-readmes skill scripts/ dir
  4. Edit data/ files with your real content
  5. npm run build        # generate README.md
```

### Step 2: Install Dependencies

```bash
cd .github/readme
npm install
```

This installs Handlebars (the templating engine). The script files are not installed via npm — they're copied or symlinked in the next step.

### Step 3: Link or Copy Build Scripts

The build scripts live in the `managing-readmes` skill directory. You have three options:

**Option A: Direct Invocation (Recommended for Local Dev)**
```bash
# Run scripts directly from the skill directory
node /path/to/managing-readmes/scripts/build-readme.js --root .
```
Pro: Always up-to-date; no file copying. Con: Long paths.

**Option B: Copy Scripts (Recommended for CI)**
```bash
# Copy all scripts from skill to your .github/readme/scripts/
cp /path/to/managing-readmes/scripts/*.js .github/readme/scripts/

# Now run them locally
cd .github/readme && npm run build
```
Pro: Self-contained; works anywhere. Con: Manual updates needed.

**Option C: Symlink (Advanced)**
```bash
# Symlink scripts into .github/readme/scripts/
ln -s /path/to/managing-readmes/scripts/*.js .github/readme/scripts/

# Now run them locally
cd .github/readme && npm run build
```
Pro: Always up-to-date. Con: Breaks if skill moves.

### Step 4: Populate Data Files

Edit the seed data created by bootstrap:

#### A. Edit `data/features.json`

Replace placeholder features with your real ones:

```json
{
  "categories": [
    {
      "category": "User Interface",
      "items": [
        {
          "id": "responsive-layout",
          "name": "Responsive Layout",
          "description": "Adapts seamlessly to any screen size",
          "highlight": true
        },
        {
          "id": "dark-mode",
          "name": "Dark Mode",
          "description": "System-aware dark/light theme toggle",
          "highlight": false
        }
      ]
    }
  ]
}
```

**Guidance:**
- Keep features benefit-focused ("What problem does it solve?")
- Mark 2-3 features per category as `highlight: true` (appear first in grids)
- Use simple, scannable descriptions (1 sentence max)

#### B. Edit `data/screenshots.json`

Update placeholder screenshot entries with your actual captures:

```json
{
  "screenshots": [
    {
      "id": "dashboard-overview",
      "type": "screenshot",
      "status": "captured",
      "file": "docs/screenshots/dashboard.png",
      "alt": "Main dashboard showing widgets and metrics",
      "caption": "Dashboard Overview",
      "notes": "Captured at 1440px with demo data"
    },
    {
      "id": "quickstart-walkthrough",
      "type": "gif",
      "status": "pending",
      "file": "docs/gifs/quickstart.gif",
      "alt": "Animated walkthrough of first-time user experience",
      "caption": "Get Started in 60 Seconds",
      "notes": "Record: signup through dashboard, keep under 30s at 2x playback"
    }
  ]
}
```

**Status values:**
- `pending`: Asset not yet captured (skipped from README)
- `captured`: Asset exists and will be included
- `outdated`: Needs refresh (included but marked for review)

#### C. Update `data/version.json`

The version file is auto-created with `0.1.0`. Update when you release:

```json
{
  "current": "1.0.0",
  "releaseDate": "2025-03-12"
}
```

### Step 5: Edit Partials (Content)

Edit `partials/*.md` files to customize the prose:

**partials/hero.md** — Project name and tagline
```markdown
# {{projectName}}

> {{tagline}}

<!-- Add badges here: CI, npm version, etc. -->
```

**partials/quickstart.md** — Type-specific getting started
```markdown
## Quickstart

```bash
npm install your-package
```

```javascript
import { myFunction } from 'your-package';
myFunction();
```

See [docs](./docs) for full guide.
```

**partials/features.md** — Auto-populated from features.json (usually don't edit)

**partials/contributing.md** — Contribution guidelines
```markdown
## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Open a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.
```

**partials/footer.md** — License and metadata
```markdown
---

Released under the [MIT License](LICENSE).

Generated by [managing-readmes](https://github.com/anthropics/claude-code) skill.
```

### Step 6: Preview Before Building

Test your changes before writing `README.md`:

```bash
node scripts/build-readme.js --dry-run
```

This outputs the generated README to stdout. Review for:
- Feature grid renders correctly
- Screenshot captions and paths are correct
- No placeholder text remains (e.g., `<!-- TODO -->`)
- All partial content appears in the right order

### Step 7: Generate README

```bash
node scripts/build-readme.js
```

Generates `README.md` in your project root. Commit both source files (data, partials) and the generated `README.md`:

```bash
git add .github/readme/data .github/readme/partials README.md
git commit -m "docs: initialize README build system"
```

## Customization Guide

### Adding New Sections

1. **Create a new partial**
   ```bash
   echo "## My New Section\n\nContent here" > .github/readme/partials/my-section.md
   ```

2. **Add to template**
   ```handlebars
   {{> my-section}}
   ```

3. **Rebuild**
   ```bash
   node scripts/build-readme.js
   ```

### Changing Section Order

Edit `templates/README.hbs` — move the `{{> partial-name}}` lines to reorder sections:

```handlebars
{{> hero}}
{{> my-new-section}}      ← Now appears before features
{{> features}}
{{> quickstart}}
```

### Adding Data-Driven Content

If you need more than features, screenshots, and version:

1. Create a new JSON file: `data/my-data.json`
   ```json
   {
     "myItems": [
       { "name": "Item 1", "value": 100 }
     ]
   }
   ```

2. The build script auto-loads all `.json` files from `data/` into the template context

3. Reference in `README.hbs`:
   ```handlebars
   {{#each myData.myItems}}
     {{this.name}}: {{this.value}}
   {{/each}}
   ```

### Removing Sections

1. Delete the `{{> partial-name}}` line from `README.hbs`
2. Optionally delete `partials/partial-name.md`
3. Rebuild

### Renaming Partials

```bash
# Rename the file
mv .github/readme/partials/old-name.md .github/readme/partials/new-name.md

# Update README.hbs
# Change: {{> old-name}}
# To:     {{> new-name}}

# Rebuild
node scripts/build-readme.js
```

## Template Customization by Project Type

Each project type gets a type-specific `templates/README.hbs` template. Here's what bootstrap decides:

### CLI Tool Template
```handlebars
{{> hero}}
## Installation
...
{{> quickstart}}
## Commands
...
{{> features}}
{{> contributing}}
{{> footer}}
```

Rationale: Developers want to install and immediately see available commands.

### Web App Template
```handlebars
{{> hero}}
## Screenshots
...
{{> features}}
{{> quickstart}}
{{> contributing}}
{{> footer}}
```

Rationale: End users need visual proof of concept; features second.

### Library Template
```handlebars
{{> hero}}
## Installation
...
## API Reference
{{> features}}
## Usage
{{> quickstart}}
{{> contributing}}
{{> footer}}
```

Rationale: Developers need to understand the API surface before using.

### SaaS Template
```handlebars
{{> hero}}
## Features
{{> features}}
## Quickstart
...
{{> contributing}}
{{> footer}}
```

Rationale: Product information (features) comes before signup/technical setup.

## Script Linking Strategies

Since the build scripts live in the skill directory (not your project), you need to decide how to use them:

| Strategy | How | Pros | Cons |
|----------|-----|------|------|
| **Direct Invocation** | `node /path/to/skill/scripts/build-readme.js --root .` | Always up-to-date; no copying | Long paths; less discoverable |
| **Copy Scripts** | `cp skill/scripts/*.js .github/readme/scripts/` | Self-contained; local discovery | Manual updates; version drift |
| **Symlink** | `ln -s /path/to/skill/scripts/*.js .github/readme/scripts/` | Up-to-date; appears local | Breaks if skill moves; POSIX-only |
| **npm Script** | Update `package.json` scripts to point to skill paths | Centralized configuration | Version drift if skill moves |
| **GitHub Action** | CI downloads scripts, runs them (Route 6) | Decoupled from repo; always latest | Network-dependent; slower |

**Recommendation:**
- **Local dev**: Direct invocation or symlink (always up-to-date)
- **CI/CD**: Copy scripts into repo (self-contained; reproducible)
- **Teams**: Symlink or GitHub Action (everyone uses latest)

## Existing Project Migration

If you have an existing `README.md`:

### Step 1: Bootstrap

```bash
node bootstrap.js --project-type [your-type] --force
```

### Step 2: Analyze and Seed

Run the analysis script to auto-populate features from your codebase:

```bash
node scripts/analyze-project.js --root ../.. --output data/features.json
```

This script examines your project structure and guesses initial feature categories.

### Step 3: Extract Content

Manually extract sections from your existing README into the appropriate partials:

- **Current introduction** → `partials/hero.md`
- **Installation section** → Update `templates/README.hbs` if not already there
- **Feature list** → `data/features.json` (already seeded, refine)
- **Usage examples** → `partials/quickstart.md`
- **Contributing** → `partials/contributing.md`

### Step 4: Verify Against Original

```bash
node scripts/build-readme.js --dry-run
```

Compare the output to your original README. The generated version should be structurally similar.

### Step 5: Iterate

- Edit partials and data files to match your original content
- Use `--dry-run` to preview changes
- Commit the new source files and generated README

### Step 6: Deprecate Manual Edits

Once the generated README matches your needs, document that all README changes should:
1. Edit source files (data, partials, templates)
2. Run `node scripts/build-readme.js`
3. Commit both source and generated `README.md`

This prevents accidental out-of-sync content.

## Troubleshooting Bootstrap

### "Cannot find module 'handlebars'"

The `build-readme.js` script requires handlebars. Install it:

```bash
cd .github/readme && npm install
```

### "Scripts not found"

The scripts are in the skill directory, not auto-installed. Either:
- Use direct invocation: `node /path/to/skill/scripts/build-readme.js`
- Copy scripts: `cp /path/to/skill/scripts/*.js .github/readme/scripts/`
- Symlink scripts: `ln -s /path/to/skill/scripts/*.js .github/readme/scripts/`

### Generated README looks wrong

Use `--dry-run` to debug:

```bash
node scripts/build-readme.js --dry-run
```

Check for:
1. Placeholder text in partials (e.g., `<!-- TODO -->`)
2. Misnamed partials (case-sensitive)
3. Missing data files or JSON syntax errors

### Bootstrap overwrites my files

Use `--force` only if you intended to overwrite. By default, bootstrap skips existing files:

```bash
node bootstrap.js --project-type web
# Skipped: README.hbs (already exists)
# Created: partials/hero.md
```

To overwrite selectively:

```bash
rm .github/readme/templates/README.hbs
node bootstrap.js --project-type web
```

## Next Steps After Bootstrap

After bootstrapping and customization:

1. **Wire CI/CD** — See Route 6: `./ci-and-hook-integration.md`
   - Auto-rebuild README on version bump
   - Validate links and screenshots in PR checks
   - Block merge if README is stale

2. **Plan Screenshots** — See Route 2: `./screenshot-planning-guide.md`
   - Enumerate all capturable surfaces
   - Generate capture instructions
   - Record GIFs and screenshots

3. **Content Strategy** — See Route 3: `./content-strategy-guide.md`
   - Analyze your audience
   - Optimize section order
   - Refine prose style

4. **Build & Rebuild** — See Route 4: `./build-and-rebuild-workflow.md`
   - Update data files as features change
   - Add screenshots when ready
   - Version bumps trigger rebuilds

For key design principles, see `SKILL.md` § Key Principles.

