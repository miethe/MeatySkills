---
description: Generate/update directory READMEs based on code changes following MP patterns
allowed-tools: Read(./**), Write, Edit, Bash(git:*), Bash(pnpm:*), Bash(uv:*), Grep, Glob
argument-hint: "[--target-dir=path] [--dry-run] [--template-only] [--force]"
---

# Update Directory READMEs

Generates or updates README.md files for directories based on current code structure, following the MeatyPrompts ≤200 line template with owners and commands.

## Context Analysis

Analyze current directory structure and README coverage:

```bash
# Check current README coverage
echo "=== README Coverage Analysis ==="
find apps services packages infra docs tools scripts -type d -maxdepth 2 2>/dev/null | while read dir; do
  if [ -f "$dir/README.md" ]; then
    lines=$(wc -l < "$dir/README.md")
    echo "✓ $dir (${lines} lines)"
  else
    echo "✗ $dir (missing)"
  fi
done

# Identify directories needing attention
echo -e "\n=== Directories Missing READMEs ==="
find apps services packages infra docs tools scripts -type d -maxdepth 2 2>/dev/null | while read dir; do
  [ ! -f "$dir/README.md" ] && echo "$dir"
done

# Check for oversized READMEs (>200 lines per spec)
echo -e "\n=== Oversized READMEs (>200 lines) ==="
find . -name "README.md" -exec wc -l {} + | awk '$1 > 200 { print $1 " lines: " $2 }'
```

## README Template Generation

### Standard Template Structure

Following the PRD specification for ≤200 line READMEs:

```markdown
# {directory-name}

Purpose: {1-2 sentences describing the directory's role and contents}.

Owners: {@team-name from CODEOWNERS}

## Commands

### Development
- **Start**: `{command to run/develop}`
- **Build**: `{command to build}`
- **Test**: `{command to test}`

### Production
- **Deploy**: `{deployment command}`
- **Monitor**: `{monitoring/logs command}`

## Architecture

{Brief description of internal structure and key files}

## Links

- **Spec/Contracts**: {links to relevant specs}
- **Documentation**: {links to detailed docs}
- **Examples**: {links to usage examples}

## Dependencies

{Key dependencies and their purposes}

## Common Tasks

- **{Task 1}**: `{command or brief instructions}`
- **{Task 2}**: `{command or brief instructions}`
```

### Directory-Specific Templates

#### Apps Directory Template

```markdown
# {app-name}

Purpose: {Description of the application - web app, mobile app, etc.}

Owners: @mp/{team-name}

## Commands

### Development
- **Start Dev**: `pnpm --filter "./{app-path}" dev`
- **Build**: `pnpm --filter "./{app-path}" build`
- **Test**: `pnpm --filter "./{app-path}" test`
- **Type Check**: `pnpm --filter "./{app-path}" typecheck`
- **Lint**: `pnpm --filter "./{app-path}" lint`

### Production
- **Start**: `pnpm --filter "./{app-path}" start`
- **Deploy**: {deployment command}

## Architecture

```
src/
├── app/          # Next.js App Router pages
├── components/   # App-specific components
├── hooks/        # Custom React hooks
├── lib/          # Utilities and API clients
└── types/        # TypeScript definitions
```

## Links

- **Live App**: {production URL}
- **Storybook**: {storybook URL if applicable}
- **API Docs**: {API documentation}

## Key Dependencies

- **Framework**: {React, Next.js, Expo, etc.}
- **UI Library**: @miethe/ui
- **Styling**: {Tailwind, styled-components, etc.}
- **State**: {React Query, Zustand, etc.}
```

#### Services Directory Template

```markdown
# {service-name}

Purpose: {Description of the service - API, background worker, etc.}

Owners: @mp/{team-name}

## Commands

### Development
- **Start**: `export PYTHONPATH="$PWD/{service-path}" && uv run --project {service-path} uvicorn app.main:app --reload`
- **Test**: `uv run --project {service-path} pytest`
- **Type Check**: `uv run --project {service-path} mypy app`
- **Lint**: `uv run --project {service-path} ruff check`

### Database
- **Migrate**: `uv run --project {service-path} alembic upgrade head`
- **New Migration**: `uv run --project {service-path} alembic revision --autogenerate -m "description"`

### Production
- **Start**: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- **Health**: `curl http://localhost:8000/health`

## Architecture

```
app/
├── api/          # API routes and endpoints
├── models/       # SQLAlchemy models
├── schemas/      # Pydantic DTOs
├── services/     # Business logic layer
├── repositories/ # Data access layer
└── tests/        # Unit and integration tests
```

## Links

- **API Docs**: {swagger/openapi URL}
- **Database Schema**: {schema docs}
- **Monitoring**: {monitoring dashboard}

## Key Dependencies

- **Framework**: FastAPI
- **Database**: SQLAlchemy + PostgreSQL
- **Migrations**: Alembic
- **Testing**: pytest
```

#### Packages Directory Template

```markdown
# {package-name}

Purpose: {Description of the package - shared components, utilities, etc.}

Owners: @mp/{team-name}

## Commands

### Development
- **Start**: `pnpm --filter "./{package-path}" {dev-command}`
- **Build**: `pnpm --filter "./{package-path}" build`
- **Test**: `pnpm --filter "./{package-path}" test`
- **Storybook**: `pnpm --filter "./{package-path}" storybook`

### Publishing
- **Build**: `pnpm --filter "./{package-path}" build`
- **Publish**: {publish command if applicable}

## Architecture

```
src/
├── components/   # Reusable components
├── hooks/        # Custom hooks
├── utils/        # Utility functions
└── types/        # TypeScript definitions
```

## Links

- **Storybook**: {storybook URL}
- **NPM**: {npm package URL if published}
- **Documentation**: {detailed docs}

## Usage Example

```typescript
import { ComponentName } from '@meaty/{package-name}'

function App() {
  return <ComponentName {...props} />
}
```

## Key Dependencies

- **React**: {version}
- **TypeScript**: {version}
- **Build Tool**: {Vite, Rollup, etc.}
```

## Directory Analysis and Content Generation

### 1. Extract Directory Information

For each target directory:

```bash
# Analyze directory structure
analyze_directory() {
  local dir=$1

  echo "Analyzing: $dir"

  # Check for package.json or pyproject.toml
  if [ -f "$dir/package.json" ]; then
    echo "Type: Node.js package"
    package_name=$(jq -r '.name // "unknown"' "$dir/package.json")
    scripts=$(jq -r '.scripts | keys[]' "$dir/package.json" | head -10)
  elif [ -f "$dir/pyproject.toml" ]; then
    echo "Type: Python package"
    package_name=$(grep -m1 'name = ' "$dir/pyproject.toml" | sed 's/.*= "//' | sed 's/".*//')
  else
    echo "Type: Generic directory"
    package_name=$(basename "$dir")
  fi

  # Count key file types
  ts_files=$(find "$dir" -name "*.ts" -o -name "*.tsx" | wc -l)
  py_files=$(find "$dir" -name "*.py" | wc -l)
  js_files=$(find "$dir" -name "*.js" -o -name "*.jsx" | wc -l)

  echo "Files: $ts_files TS, $py_files Python, $js_files JS"
}
```

### 2. Extract Ownership Information

```bash
# Find owners from CODEOWNERS file
get_directory_owners() {
  local dir=$1

  if [ -f "CODEOWNERS" ]; then
    # Look for exact match first, then parent directory matches
    owners=$(grep "^$dir" CODEOWNERS | awk '{print $NF}' | head -1)
    if [ -z "$owners" ]; then
      # Try parent directory patterns
      owners=$(grep "^$(dirname $dir)" CODEOWNERS | awk '{print $NF}' | head -1)
    fi
    if [ -z "$owners" ]; then
      owners="@mp/core"  # Default fallback
    fi
  else
    owners="@mp/core"
  fi

  echo "$owners"
}
```

### 3. Generate Commands Based on Package Type

```bash
# Generate appropriate commands for directory type
generate_commands() {
  local dir=$1
  local package_type=$2

  case $package_type in
    "next-app")
      echo "- **Dev**: \`pnpm --filter \"./$(basename $dir)\" dev\`"
      echo "- **Build**: \`pnpm --filter \"./$(basename $dir)\" build\`"
      echo "- **Test**: \`pnpm --filter \"./$(basename $dir)\" test\`"
      ;;
    "fastapi-service")
      echo "- **Dev**: \`export PYTHONPATH=\"\$PWD/$dir\" && uv run --project $dir uvicorn app.main:app --reload\`"
      echo "- **Test**: \`uv run --project $dir pytest\`"
      echo "- **Migrate**: \`uv run --project $dir alembic upgrade head\`"
      ;;
    "ui-package")
      echo "- **Storybook**: \`pnpm --filter \"./$(basename $dir)\" storybook\`"
      echo "- **Build**: \`pnpm --filter \"./$(basename $dir)\" build\`"
      echo "- **Test**: \`pnpm --filter \"./$(basename $dir)\" test\`"
      ;;
    *)
      echo "- **Build**: \`{appropriate build command}\`"
      echo "- **Test**: \`{appropriate test command}\`"
      ;;
  esac
}
```

### 4. README Generation Process

```bash
# Generate README for a directory
generate_readme() {
  local dir=$1
  local dry_run=${2:-false}

  # Determine package type and gather info
  if [[ "$dir" == apps/* && -f "$dir/next.config.js" ]]; then
    package_type="next-app"
  elif [[ "$dir" == services/* && -f "$dir/app/main.py" ]]; then
    package_type="fastapi-service"
  elif [[ "$dir" == packages/ui ]]; then
    package_type="ui-package"
  else
    package_type="generic"
  fi

  # Extract information
  purpose=$(extract_purpose "$dir" "$package_type")
  owners=$(get_directory_owners "$dir")
  commands=$(generate_commands "$dir" "$package_type")
  architecture=$(analyze_architecture "$dir")

  # Generate README content
  readme_content="# $(basename $dir)

Purpose: $purpose

Owners: $owners

## Commands

$commands

## Architecture

$architecture

## Links

- **Documentation**: {relevant docs}
- **Examples**: {usage examples}

## Dependencies

{key dependencies and their purposes}
"

  # Write or display README
  if [ "$dry_run" = "true" ]; then
    echo "Would generate README for $dir:"
    echo "---"
    echo "$readme_content"
    echo "---"
  else
    echo "$readme_content" > "$dir/README.md"
    echo "✅ Generated README for $dir"
  fi
}
```

## Validation and Quality Control

### Length Validation

```bash
# Ensure READMEs stay under 200 lines
validate_readme_length() {
  local dir=$1
  local readme="$dir/README.md"

  if [ -f "$readme" ]; then
    lines=$(wc -l < "$readme")
    if [ $lines -gt 200 ]; then
      echo "⚠ $readme exceeds 200 lines ($lines lines)"
      echo "   Consider moving detailed content to docs/"
    else
      echo "✓ $readme length OK ($lines lines)"
    fi
  fi
}
```

### Content Quality Checks

```bash
# Validate README content quality
validate_readme_content() {
  local readme=$1

  # Check for required sections
  required_sections=("Purpose" "Owners" "Commands" "Architecture" "Links")
  for section in "${required_sections[@]}"; do
    if grep -q "## $section" "$readme"; then
      echo "✓ Has $section section"
    else
      echo "✗ Missing $section section"
    fi
  done

  # Check for placeholder content
  if grep -q "{" "$readme"; then
    echo "⚠ Contains placeholder content - needs manual review"
  fi

  # Check for valid owners format
  if grep -q "@mp/" "$readme"; then
    echo "✓ Has valid owner format"
  else
    echo "⚠ Owner format may be incorrect"
  fi
}
```

## Usage Examples

```bash
# Update all directory READMEs
/update-readmes

# Preview changes without writing files
/update-readmes --dry-run

# Update specific directory only
/update-readmes --target-dir=apps/web

# Force update even if README exists
/update-readmes --force

# Generate template structure only
/update-readmes --template-only
```

## Integration with Other Commands

### Coordinate with Repository Map

```bash
# Update READMEs based on repository map packages
if [ -f "ai/repo.map.json" ]; then
  packages=$(jq -r '.packages | keys[]' ai/repo.map.json)
  for pkg in $packages; do
    /update-readmes --target-dir="$pkg"
  done
fi
```

### Link with CODEOWNERS Updates

```bash
# Update READMEs when CODEOWNERS changes
if git diff HEAD~1 HEAD --name-only | grep -q "CODEOWNERS"; then
  echo "CODEOWNERS changed, updating README owners..."
  /update-readmes --force
fi
```

The update-readmes command ensures:

- **100% coverage**: Every directory has a README
- **Consistent format**: All READMEs follow the MP template
- **Current information**: Commands and ownership stay up-to-date
- **Length compliance**: READMEs stay under 200 lines
- **Quality content**: Required sections and valid information
