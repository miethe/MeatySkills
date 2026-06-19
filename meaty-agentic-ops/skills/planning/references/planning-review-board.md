# Planning Review Board — Generator Reference

## Overview

The Planning Review Board is an auto-generated, self-contained HTML dashboard that visualizes all planning artifacts for a feature. It reads YAML frontmatter from planning docs to auto-discover relationships and build an interactive board.

## Generator Script

**Location**: `scripts/generate-planning-board.py`
**Template**: `scripts/templates/planning-board.html.tmpl`
**Dependencies**: PyYAML (required), Pillow (optional, for wireframe embedding)

## Usage

### Quick Generation (feature slug)
```bash
python scripts/generate-planning-board.py \
  --feature-slug <slug> \
  --output planning-review-board.html
```

### Full Generation (with wireframes)
```bash
python scripts/generate-planning-board.py \
  --feature-slug <slug> \
  --wireframe-dir docs/project_plans/wireframes/<dir> \
  --title "Feature Name v1" \
  --output planning-review-board.html \
  --open
```

### From Implementation Plan Path
```bash
python scripts/generate-planning-board.py \
  --plan docs/project_plans/implementation_plans/features/<plan>.md \
  --output planning-review-board.html
```

### Dry Run (preview discovery)
```bash
python scripts/generate-planning-board.py \
  --feature-slug <slug> \
  --dry-run
```

## CLI Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--feature-slug` | One of slug/plan | — | Feature slug for auto-discovery |
| `--plan` | One of slug/plan | — | Direct path to implementation plan |
| `--project-root` | No | `.` | Project root directory |
| `--output` | No | `planning-review-board.html` | Output file path |
| `--wireframe-dir` | No | auto-discover | Directory with wireframe PNGs |
| `--template` | No | `scripts/templates/planning-board.html.tmpl` | Custom HTML template |
| `--title` | No | From impl plan title | Custom board title |
| `--dry-run` | No | false | Preview discovery without generating |
| `--open` | No | false | Open in browser after generation |

## Auto-Discovery Logic

Given a feature slug, the generator:

1. **Finds the implementation plan** by globbing `docs/project_plans/implementation_plans/**/*{slug}*.md`
2. **Parses YAML frontmatter** to extract: `prd_ref`, `spike_ref`, `adr_refs`, `charter_ref`, `related_documents`, `files_affected`
3. **Recursively discovers** all related docs by following reference chains
4. **Extracts content** from each doc: title, status, sections, key findings, files affected
5. **Discovers wireframes** from `--wireframe-dir` or auto-detected paths
6. **Extracts decisions** from open-questions docs (markdown table parsing)
7. **Extracts implementation files** from `files_affected` frontmatter

### Frontmatter Fields Used

| Field | Purpose | Doc Types |
|-------|---------|-----------|
| `doc_type` | Classify document | All |
| `feature_slug` | Group related docs | PRD, SPIKE, Impl Plan, Progress |
| `status` | Show current state | All |
| `prd_ref` | Link to parent PRD | SPIKE, Impl Plan, Progress |
| `spike_ref` | Link to research | Impl Plan |
| `charter_ref` | Link to SPIKE charter | SPIKE Report |
| `adr_refs` | Link to architecture decisions | Impl Plan |
| `related_documents` | Cross-references | All (90% coverage) |
| `files_affected` | Implementation scope | PRD, SPIKE, Impl Plan |
| `tags` | Filtering | All (95% coverage) |

## Template Architecture

The HTML template at `scripts/templates/planning-board.html.tmpl` contains:
- Complete CSS (dark theme, responsive)
- Complete JS rendering functions
- 12 placeholder injection points for data

### Injection Placeholders

| Placeholder | Type | Description |
|-------------|------|-------------|
| `/* __DOCUMENTS_JSON__ */` | Array | All discovered documents |
| `/* __PHASES_JSON__ */` | Array | Phase timeline data |
| `/* __DECISIONS_JSON__ */` | Array | Decision tracker data |
| `/* __WIREFRAMES_JSON__ */` | Array | Wireframe metadata |
| `/* __WIREFRAME_IMAGES_JSON__ */` | Object | Base64 image data |
| `/* __IMPL_FILES_JSON__ */` | Array | Implementation file list |
| `/* __PROJECT_CONFIG_JSON__ */` | Object | Project metadata |
| `__BOARD_TITLE__` | String | Board title text |
| `__BOARD_SUBTITLE__` | String | Board subtitle |
| `__START_DATE__` | String | Start date |
| `__DOC_COUNT__` | String | Document count |
| `__PROJECT_STATUS__` | String | Project status |

## 5 Interactive Tabs

1. **Document Map** — Cards grouped by type, clickable detail modals with sections/findings/dependencies
2. **Wireframe Gallery** — Embedded images, filterable by phase/persona, expanded modal with related docs
3. **Decision Tracker** — Table of decisions with status filtering (blocking/resolved/important/deferred)
4. **Phase Timeline** — Horizontal timeline with progress bars
5. **Implementation Scope** — Files grouped by backend/frontend with batch assignments

## Customization

### Custom Template
Create a copy of the template and modify CSS/JS/HTML structure:
```bash
cp scripts/templates/planning-board.html.tmpl my-template.html.tmpl
# Edit my-template.html.tmpl
python scripts/generate-planning-board.py --feature-slug xyz --template my-template.html.tmpl
```

### For a New Feature
Only the CLI invocation changes — the script auto-discovers everything from frontmatter:
```bash
python scripts/generate-planning-board.py --feature-slug new-feature-name --output new-feature-board.html
```
