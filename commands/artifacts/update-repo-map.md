---
description: Regenerate ai/repo.map.json with current package structure and dependencies
allowed-tools: Read(./**), Write, Bash(git:*), Bash(pnpm:*), Bash(uv:*), Grep, Glob
argument-hint: "[--dry-run] [--validate-only] [path-filter]"
---

# Update Repository Map

Regenerates `ai/repo.map.json` by scanning the current codebase structure, package dependencies, and CODEOWNERS information following the repo architecture v1 specification.

## Context Analysis

First, analyze current state:

```bash
# Check git status for recent changes
git status --porcelain

# List current packages
find apps packages services -maxdepth 1 -type d 2>/dev/null || echo "No packages found"

# Check for package.json files
find . -name "package.json" -not -path "*/node_modules/*" | head -10

# Check for pyproject.toml files
find . -name "pyproject.toml" | head -5
```

## Generate Repository Map

### 1. Scan Package Structure

Analyze each package directory:

```bash
# Apps
for app in apps/*/; do
  if [ -d "$app" ]; then
    echo "Found app: $app"
    [ -f "${app}package.json" ] && echo "Has package.json"
    [ -f "${app}pyproject.toml" ] && echo "Has pyproject.toml"
  fi
done

# Services
for service in services/*/; do
  if [ -d "$service" ]; then
    echo "Found service: $service"
    [ -f "${service}package.json" ] && echo "Has package.json"
    [ -f "${service}pyproject.toml" ] && echo "Has pyproject.toml"
  fi
done

# Packages
for pkg in packages/*/; do
  if [ -d "$pkg" ]; then
    echo "Found package: $pkg"
    [ -f "${pkg}package.json" ] && echo "Has package.json"
  fi
done
```

### 2. Extract Package Information

For each package, extract:
- **Type**: app, service, lib, or tool
- **Build/Run/Test commands** from package.json scripts or pyproject.toml
- **Entry points** from main/src directories
- **Dependencies** from package.json or pyproject.toml
- **Owners** from CODEOWNERS file

### 3. Build Dependency Graph

Map dependencies between packages:
- Analyze package.json dependencies and devDependencies
- Check import statements in TypeScript/Python files
- Identify workspace references (@meaty/* imports)

### 4. Generate Repository Map JSON

Create the complete repository map structure:

```json
{
  "name": "meatyprompts",
  "languages": ["typescript", "python", "javascript"],
  "packages": {
    "apps/web": {
      "type": "app",
      "build": "pnpm build",
      "run": "pnpm dev",
      "test": "pnpm test",
      "entrypoints": ["src/app/layout.tsx", "src/app/page.tsx"],
      "dependsOn": ["packages/ui", "packages/tokens"],
      "spec": "N/A",
      "owners": ["@mp/web"]
    }
  },
  "graph": [
    ["apps/web", "packages/ui"],
    ["packages/ui", "packages/tokens"]
  ],
  "codeowners": "CODEOWNERS",
  "scripts": {
    "dev:web": "pnpm --filter './apps/web' dev",
    "dev:api": "export PYTHONPATH='$PWD/services/api' && uv run --project services/api uvicorn app.main:app --reload"
  },
  "rootDocs": ["README.md", "CONTRIBUTING.md", "ARCHITECTURE.md", "docs/"]
}
```

## Validation

Validate the generated map:

1. **Schema Compliance**: All required fields present
2. **Dependency Accuracy**: Graph edges match actual imports
3. **Command Validity**: Scripts can be executed
4. **Owner Coverage**: All packages have owners from CODEOWNERS

## Dry Run Mode

If `--dry-run` specified:
- Generate the map but don't write to file
- Show diff with current ai/repo.map.json
- Display validation results
- Output structure summary

## Error Handling

Handle common issues:
- Missing package.json files → infer from directory structure
- Circular dependencies → detect and report
- Invalid CODEOWNERS → use default patterns
- Missing entrypoints → scan for main files

## Implementation Details

The command should:

1. **Read current state** from git and filesystem
2. **Parse configuration files** (package.json, pyproject.toml, CODEOWNERS)
3. **Analyze import patterns** to build dependency graph
4. **Generate JSON structure** following the schema
5. **Validate output** against requirements
6. **Write to ai/repo.map.json** (unless dry-run)
7. **Report summary** of changes and any issues

## Usage Examples

```bash
# Full regeneration
/update-repo-map

# Dry run to preview changes
/update-repo-map --dry-run

# Validate existing map only
/update-repo-map --validate-only

# Update specific package path
/update-repo-map apps/web
```

## Integration

This command integrates with:
- CI/CD pipeline (auto-run on main merge)
- Pre-commit hooks for validation
- Other artifact update commands
- Repository indexing systems

The generated map enables AI agents to:
- Navigate the codebase efficiently
- Understand package relationships
- Find relevant owners and documentation
- Execute development commands correctly
