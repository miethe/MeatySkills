# Build & Rebuild Workflow (Route 4)

Detailed reference for README generation, partial management, and templating.

## Section-Only Update Patterns

When you need to update specific content without full rebuild context:

### Add Feature
1. Edit `data/features.json` — add feature object to appropriate category
2. Run `node scripts/build-readme.js --root .`
3. Verify feature appears in feature grid and (if applicable) CLI commands list

### Update Screenshots
1. Edit `data/screenshots.json` — change status (`captured`, `pending`, `required`)
2. Run `node scripts/build-readme.js --root .`
3. Run `node scripts/check-screenshots.js --root . --category readme` to verify files exist

### Version Bump
1. Run `node scripts/update-version.js --root . --version X.Y.Z`
2. Run `node scripts/build-readme.js --root .`
3. Verify version badges/header updated in README

### Edit Section Prose
1. Edit relevant `partials/*.md` file
2. Run `node scripts/build-readme.js --root . --dry-run` to preview
3. Run `node scripts/build-readme.js --root .` to apply
4. Commit both partial and generated README

### Change Structure
1. Edit `templates/README.hbs` — modify layout or add/remove sections
2. Run `node scripts/build-readme.js --root . --dry-run`
3. Review output carefully (structure changes often require data updates)
4. Run `node scripts/build-readme.js --root .` to apply

## Template Authoring Guide

### README.hbs Structure
Main template includes partials via Handlebars:

```handlebars
# {{projectName}}

{{> intro}}

## Features
{{> features-grid}}

{{> installation}}

{{> usage}}

{{> api}}

{{> contributing}}
```

### Data Injection
Data files populate template context:
- `data/features.json` — drives feature grid, command list, feature count
- `data/screenshots.json` — drives screenshot table, category grouping
- `data/version.json` — drives badges, header metadata, release info

### Available Handlebars Helpers

All 12 helpers:

- **`formatDate`** — Locale-formatted date string
  ```handlebars
  {{formatDate date "short"}}
  ```

- **`isoDate`** — Current ISO 8601 timestamp
  ```handlebars
  Generated {{isoDate}}
  ```

- **`filter`** — Array filter by key/value
  ```handlebars
  {{#filter features "category" "core"}}
    - {{name}}: {{description}}
  {{/filter}}
  ```

- **`eq`** — Equality comparison
  ```handlebars
  {{#if (eq status "active")}}
    Active feature
  {{/if}}
  ```

- **`count`** — Array length
  ```handlebars
  Total features: {{count features}}
  ```

- **`join`** — Join array with separator
  ```handlebars
  {{join commands ", "}}
  ```

- **`isOdd`** — Alternating row detection
  ```handlebars
  {{#each items}}
    {{#if (isOdd @index)}}
      <tr class="odd">
    {{else}}
      <tr class="even">
    {{/if}}
  {{/each}}
  ```

- **`highlightedFeatures`** — Flatten highlighted features across all categories
  ```handlebars
  {{#each (highlightedFeatures features)}}
    - {{name}}
  {{/each}}
  ```

- **`screenshotsByCategory`** — Filter screenshots by category
  ```handlebars
  {{#each (screenshotsByCategory screenshots "setup")}}
    ![{{alt}}]({{file}})
  {{/each}}
  ```

- **`totalFeatures`** — Count all features across categories
  ```handlebars
  {{totalFeatures features}} features total
  ```

- **`hasCliCommands`** — Boolean: any feature has cliCommand field
  ```handlebars
  {{#if (hasCliCommands features)}}
    ## CLI Commands
    {{> cli-commands}}
  {{/if}}
  ```

- **`cliCommands`** — Comma-joined list of all CLI commands
  ```handlebars
  {{cliCommands features}}
  ```

### Conditional Sections
Use helpers in `{{#if}}` blocks to conditionally render sections:

```handlebars
{{#if (hasCliCommands features)}}
  ## CLI Commands
  {{cliCommands features}}
{{/if}}

{{#if screenshots}}
  ## Screenshots
  {{> screenshots-table}}
{{/if}}
```

## Creating Custom Partials

### Partial File Structure
1. Create `.md` file in `partials/` directory
2. Name is the partial identifier (without `.md` extension)
3. Include Handlebars expressions and helpers as needed

### Referencing Partials
In `README.hbs`, use:
```handlebars
{{> partial-name}}
```

The builder automatically resolves to `partials/partial-name.md`.

### Partial Design Patterns

**Single-section partial:**
```markdown
## {{sectionName}}

{{description}}

- Item 1: {{detail1}}
- Item 2: {{detail2}}
```

**Data-driven partial:**
```markdown
## Features

{{#each features}}
  ### {{name}}
  {{description}}
{{/each}}
```

**Conditional content:**
```markdown
{{#if hasAdvancedFeatures}}
  ## Advanced Usage
  {{> advanced-section}}
{{/if}}
```

### Partial Reusability
Keep partials focused — one section per partial. This enables:
- Standalone testing of partial output
- Easy updates without full README rebuild
- Mixing partials in different README layouts

## Data File Quick Reference

### features.json
Structure:
```json
{
  "categories": [
    {
      "name": "Core Features",
      "features": [
        {
          "id": "feature-1",
          "name": "Feature Name",
          "description": "What it does",
          "highlighted": true,
          "cliCommand": "skillmeat feature-1"
        }
      ]
    }
  ]
}
```

Drives:
- Feature grid in README
- CLI commands list (if any feature has `cliCommand`)
- Feature count helpers

### screenshots.json
Structure:
```json
{
  "screenshots": [
    {
      "id": "screenshot-1",
      "file": "docs/screenshots/feature-1.png",
      "alt": "Feature 1 in action",
      "category": "core",
      "width": 1280,
      "height": 720,
      "status": "captured",
      "capturedAt": "2025-03-12T10:00:00Z"
    }
  ]
}
```

Drives:
- Screenshot table
- Category grouping
- Validation checks

**Status values**: `captured`, `pending`, `required`

### version.json
Structure:
```json
{
  "current": "1.2.0",
  "releaseDate": "2025-03-12",
  "releaseNotes": "New features and bug fixes"
}
```

Drives:
- Version badges in header
- Release info in README
- Staleness heuristics (compare against `package.json`)
