---
skill: skillmeat-cli
workflow_id: scaffold-workflow
workflow_name: Scaffold and Template Rendering
canonical_docs:
  - docs/user/guides/cli/commands.md § "Scaffold"
  - docs/user/guides/cli/commands.md § "Template"
version: 1.1
updated: 2026-04-27
---

# Scaffold and Template Rendering Workflow

Guide for rendering scaffold files from bundles and managing scaffold templates with SkillMeat.

For complete CLI syntax, see `docs/user/guides/cli/commands.md § "Scaffold"` and `§ "Template"`.

---

## Overview

**Scaffold Operations**:
- **Render**: Generate scaffold files from a bundle or bundle artifact context
- **Manage Templates**: Create, list, configure, and preview scaffold templates
- **Configure**: Set template variables and deployment options

**Use Cases**:
- Generate project structure from a bundle template
- Deploy scaffold configurations to projects
- Share and version scaffold templates across teams
- Customize scaffold output via template variables

---

## Workflow 1: Render Scaffold from Bundle

### Step 1: List Available Bundles

```bash
# List bundles in collection
skillmeat list --type bundle

# Or show details of a specific bundle
skillmeat show my-bundle
```

### Step 2: Preview Scaffold Output

```bash
# Preview scaffold files (dry run)
skillmeat scaffold \
  --bundle my-bundle \
  --project . \
  --dry-run
```

**Output**:
```
Scaffold Preview: my-bundle
Target: /Users/me/project

Would create:
  + .claude/skills/
  + .claude/skills/skill-name/
  + .claude/skills/skill-name/SKILL.md
  + .claude/config/
  + .claude/config/project.toml
  + scripts/
  + scripts/setup.sh

Variables required:
  PROJECT_NAME (string) - Project name
  TEAM_EMAIL (string) - Team email address

Dry run: no files will be modified
```

### Step 3: Configure Variables

```bash
# Pass variables on command line
skillmeat scaffold \
  --bundle my-bundle \
  --project . \
  --set PROJECT_NAME="MyProject" \
  --set TEAM_EMAIL="team@acme.com"
```

Or use a configuration file:

```bash
# Create config: scaffold-config.toml
skillmeat scaffold \
  --bundle my-bundle \
  --project . \
  --config scaffold-config.toml
```

### Step 4: Render Scaffold

```bash
# Render files
skillmeat scaffold \
  --bundle my-bundle \
  --project . \
  --set PROJECT_NAME="MyProject" \
  --set TEAM_EMAIL="team@acme.com"
```

**Output**:
```
✓ Created .claude/skills/ (8 items)
✓ Created .claude/config/project.toml
✓ Created scripts/setup.sh
✓ Registered 3 skills in manifest
Total: 12 files created
```

---

## Workflow 2: Scaffold from Context

Render scaffolds based on project context (auto-detecting project type).

### Step 1: Render from Project Context

```bash
# Auto-detect project type and render appropriate scaffold
skillmeat scaffold-from-context \
  --project . \
  --dry-run
```

**Output**:
```
Detecting project context...

Detected:
  - Language: Python 3.9+
  - Framework: Django
  - Package manager: pip

Recommending scaffold:
  - python-backend-skill (92% match)
  - django-templates (89% match)
  - api-testing-tools (85% match)

Use --approve to render, or specify --scaffold <name> to choose custom
```

### Step 2: Render with Recommendations

```bash
# Auto-render detected scaffolds
skillmeat scaffold-from-context \
  --project . \
  --approve
```

---

## Workflow 3: Manage Scaffold Templates

```bash
# List templates
skillmeat template list

# Show template details
skillmeat template show python-backend

# Preview with variables
skillmeat template preview python-backend \
  --set PROJECT_NAME="MyApp" \
  --set PYTHON_VERSION="3.12"

# Create custom template
skillmeat template create my-custom \
  --bundle my-bundle \
  --description "Custom team setup"

# Configure defaults
skillmeat template configure python-backend \
  --default PROJECT_NAME="default-project"
```

---

## Workflow 4: Scaffold from Remote Git Repository (v0.35.0+)

`--from-repo REPO_URL` clones a remote repository as the context source for scaffold assembly. The clone is shallow (HTTPS). For authoritative flag syntax, see `docs/user/guides/cli/commands.md § "Scaffold"`.

**Agent pattern — use when the user provides a GitHub/HTTPS repo URL as context**:

1. Confirm the user wants LLM-assisted analysis (default on) or pass `--no-llm-analyzer` for deterministic output.
2. Choose scope: `--scope whole-project` (default) or `--scope feature` for a targeted subset.
3. Run with `--dry-run` first to review the planned output.
4. Execute without `--dry-run` once the user confirms.

```bash
# Preview scaffold from remote repo
skillmeat scaffold \
  --from-repo https://github.com/owner/repo \
  --scope whole-project \
  --dry-run

# Execute (interactive confirmation)
skillmeat scaffold \
  --from-repo https://github.com/owner/repo \
  --scope whole-project

# Non-interactive (CI usage)
skillmeat scaffold \
  --from-repo https://github.com/owner/repo \
  --auto-confirm
```

Note: `--from-repo` makes `--bundle` optional. If neither is supplied, scaffold uses the remote repo content directly as context.

---

## Workflow 5: Generate a PR After Scaffold Assembly (v0.35.0+)

`--output-pr REPO_OWNER/REPO_NAME` opens a GitHub PR on the target repository after scaffold files are written. For authoritative flag syntax, see `docs/user/guides/cli/commands.md § "Scaffold"`.

**Agent pattern — use when the user wants scaffold results proposed as a pull request**:

1. Ensure the user has a GitHub token configured (`skillmeat config set github-token <token>`).
2. Combine with `--from-repo` or `--bundle` as the content source.
3. Include `--auto-confirm` for CI pipelines; omit for interactive review.

```bash
# Scaffold from bundle and open a PR on the target repo
skillmeat scaffold \
  --bundle my-bundle \
  --project . \
  --output-pr owner/target-repo

# Scaffold from remote repo context and propose changes as PR
skillmeat scaffold \
  --from-repo https://github.com/owner/source-repo \
  --output-pr owner/target-repo \
  --auto-confirm
```

**When `--output-pr` is used**: SkillMeat creates a branch, writes scaffold files, and opens a draft PR. Report the PR URL to the user.

---

## Advanced Patterns

### Pattern: Team Template Library

```bash
# Create team template bundle
skillmeat bundle create team-templates \
  -r python-backend -r web-dev -r react-app \
  -d "Team scaffold templates"

# Team imports and uses
skillmeat bundle import team-templates.skillmeat-pack
skillmeat template list
```

### Pattern: Multi-Step Scaffolding

```bash
# Render multiple scaffolds
skillmeat scaffold base-project --set PROJECT_NAME="MyApp"
skillmeat scaffold python-backend --set PYTHON_VERSION="3.11"
skillmeat deploy --all
```

---

## Troubleshooting

### Template Not Found

```bash
# List available templates
skillmeat template list

# Check template name spelling
skillmeat template show <template-name>
```

### Variable Validation Failed

```
Error: Variable PROJECT_NAME="invalid-name!" fails validation: alphanumeric

Valid values:
  - Must contain only letters, numbers, underscores
  - Maximum 50 characters
  - Example: my_project_1

Try again with: --set PROJECT_NAME="my_project"
```

### Scaffold Rendering Failed

```bash
# Dry run first to catch issues
skillmeat scaffold my-bundle --project . --dry-run

# Check for missing required variables
# Verify project path is correct
# Ensure you have write permissions
```

---

## Agent-Facing Examples

### Example 1: Create Project from Template

**Agent Task**: "Set up a new Python backend project with the standard team template"

```bash
# List available templates
skillmeat template list

# Preview the template
skillmeat template preview python-backend \
  --set PROJECT_NAME="api-service" \
  --set TEAM_EMAIL="backend-team@acme.com" \
  --set PYTHON_VERSION="3.12"

# Render the scaffold
skillmeat scaffold python-backend \
  --project . \
  --set PROJECT_NAME="api-service" \
  --set TEAM_EMAIL="backend-team@acme.com" \
  --set PYTHON_VERSION="3.12"

# Deploy artifacts
skillmeat deploy --all

# Result: "Project scaffolded at /Users/me/api-service with 12 artifacts deployed"
```

### Example 2: Auto-Detect and Render

**Agent Task**: "Detect project type and render appropriate scaffolds"

```bash
# Auto-detect project context
skillmeat scaffold-from-context \
  --project . \
  --approve

# Report recommendations
# Result: "Detected Python Django project; rendered python-backend and api-testing-tools scaffolds"
```

### Example 3: Custom Template Configuration

**Agent Task**: "Create a custom template for our data science projects"

```bash
# Create new template
skillmeat template create data-science-env \
  --bundle data-science \
  --description "Data science project template with Jupyter, pandas, scikit-learn"

# Configure defaults
skillmeat template configure data-science-env \
  --default PYTHON_VERSION="3.11" \
  --default USE_JUPYTER=true

# Preview before deployment
skillmeat template preview data-science-env

# Result: "Custom template data-science-env created and ready for team use"
```

---

## Related Workflows

- `workflows/bundle-workflow.md` — Creating and managing bundles that contain scaffolds
- `workflows/deployment-workflow.md` — Deploying artifacts after scaffolding

## See Also

- `docs/user/guides/cli/commands.md § "Scaffold"` — Complete scaffold command reference
- `docs/user/guides/cli/commands.md § "Template"` — Complete template command reference
- `docs/user/guides/cli/reference.md` — Auto-generated CLI reference
