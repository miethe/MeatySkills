---
schema_version: "1.0"
doc_type: "reference"
doc_category: "templates"
title: "SkillMeat Template Configurations"
description: "Pre-curated TOML artifact collection templates for common development stacks. Reference templates for bundle creation and project scaffolding workflows."
audience: "developers"
created: 2024-02-26
updated: 2026-04-14
tags: ["templates", "scaffolding", "bundles", "configuration"]
status: "reference"
---

# SkillMeat Template Configurations

Pre-curated artifact collection templates for common development stacks. These TOML files define the skills, tools, and configurations recommended for specific project types.

## Overview

Each template in this directory is a TOML configuration file that specifies:

- **Artifacts**: Required and optional skills to include (frontend-design, testing, API development, etc.)
- **Dependencies**: Runtime requirements (Node.js, Python, PostgreSQL versions)
- **Recommendations**: Suggested setup steps, project structure, tools, and scripts
- **Use Cases**: When and how to use each template

## Available Templates

### 1. React Development (`react.toml`)

**For**: React, Next.js, TypeScript frontend projects

**Includes**:
- `frontend-design` (required) - UI patterns, Tailwind CSS
- `webapp-testing` (optional) - Jest, Testing Library
- `chrome-devtools` (optional) - Browser debugging
- `npm-package-manager` (optional) - NPM/Yarn management

**Best For**: Single-page apps, Next.js projects, React component libraries

---

### 2. Python Development (`python.toml`)

**For**: Python backend projects (FastAPI, Django, Flask)

**Includes**:
- `openapi-expert` (optional) - API schema design
- `postgresql-psql` (optional) - Database management
- `pytest-expert` (optional) - Python testing
- `python-package-manager` (optional) - Pip/Poetry/uv
- `data-processing` (optional) - Pandas, NumPy

**Best For**: REST APIs, microservices, data processing backends

---

### 3. Node.js Backend (`nodejs.toml`)

**For**: Node.js/Express backend projects with TypeScript

**Includes**:
- `webapp-testing` (optional) - Jest, Supertest
- `openapi-expert` (optional) - API documentation
- `postgresql-psql` (optional) - Database queries
- `npm-package-manager` (optional) - Package management
- `typescript-config` (optional) - TypeScript setup

**Best For**: Express APIs, GraphQL servers, TypeScript backends

---

### 4. Full-Stack Development (`fullstack.toml`)

**For**: Complete web applications with frontend + backend

**Includes**:
- `frontend-design` (required) - UI development
- `webapp-testing` (optional) - Full-stack testing
- `openapi-expert` (required) - API contracts
- `postgresql-psql` (optional) - Database
- `chrome-devtools` (optional) - Debugging
- `python-package-manager` (optional) - Python backend deps
- `npm-package-manager` (optional) - Frontend deps
- `data-processing` (optional) - Data transformation

**Recommended Stacks**:
1. **Next.js + FastAPI**: Modern, type-safe, excellent DX
2. **Next.js + Express**: Full TypeScript, shared types
3. **React SPA + Django**: Django admin + REST API

**Best For**: Monorepo projects, complex web applications, SaaS products

---

## Usage

### Creating a Bundle from a Template

Templates can be used as reference when creating artifact bundles:

```bash
# Create bundle from context analysis (AI-driven)
skillmeat scaffold --from-context <path> --scope whole-project

# Create bundle with specific artifacts
skillmeat bundle create my-bundle --filter "skill"
```

### Customizing Templates

Copy a template and modify it:

```toml
[template]
name = "my-custom-stack"
display_name = "My Custom Stack"
description = "Tailored for my team's workflow"
version = "1.0.0"
tags = ["custom", "internal"]

[[artifacts]]
name = "artifact-name"
type = "skill"
source = "owner/repo/path"
required = true
description = "Purpose of this artifact"

[dependencies]
node = ">=18.0.0"
python = ">=3.9"

[recommendations]
setup_guide = """Custom setup instructions..."""
```

Save to `.claude/skills/skillmeat-cli/templates/my-custom-stack.toml`

---

## Reference Information

### Template Structure

Each TOML template includes these sections:

**[template]**: Metadata
- `name` - Template identifier
- `display_name` - Human-readable name
- `description` - Purpose and use cases
- `version` - Semantic version
- `tags` - Categorization tags

**[[artifacts]]**: Array of skills/tools
- `name` - Artifact identifier
- `type` - "skill", "command", "agent", etc.
- `source` - GitHub path or internal reference
- `required` - Boolean for mandatory inclusion
- `description` - What this artifact provides

**[dependencies]**: Runtime requirements
- Runtime versions (Node.js, Python, PostgreSQL, etc.)

**[recommendations]**: Suggested setup
- Project structure examples
- Package management suggestions
- Recommended scripts and tools
- Setup workflows

**[notes]**: Additional guidance
- Setup guides
- Testing strategies
- Best practices
- Configuration patterns

---

## Related Documentation

- **Scaffolding Workflows**: `skillmeat scaffold --help`
- **Bundle Management**: `skillmeat bundle --help`
- **CLI Reference**: `docs/user/guides/cli/commands.md`

---

## Best Practices

1. **Start with a template**: Use the template most closely matching your stack
2. **Reference, don't copy**: Templates are guides—customize for your needs
3. **Document your choices**: Note which artifacts and dependencies your project requires
4. **Keep updated**: Monitor artifact versions and upgrade as needed
5. **Share templates**: Contribute useful team-specific templates

---

## Template Versioning

Templates follow semantic versioning:
- **Major**: Breaking changes (incompatible artifacts)
- **Minor**: New features (additional artifacts)
- **Patch**: Bug fixes, documentation updates

Check template metadata:
```bash
# TOML templates—read directly
head -10 fullstack.toml

# API-based templates—query the server
curl http://localhost:8080/api/v1/templates/scaffold/
```

---

## Notes on Current Usage

These TOML templates serve as **reference configurations** for project setup. The modern SkillMeat CLI uses:

- **AI-driven scaffolding**: `skillmeat scaffold --from-context <path>` analyzes your project and recommends artifacts
- **Bundle-based scaffolding**: `skillmeat scaffold --bundle <id>` applies a pre-curated bundle
- **Backstage integration** (enterprise): `skillmeat template create --bundle <id>` for Backstage Software Templates

These TOML files remain useful for **documentation, training, and custom workflows**.
