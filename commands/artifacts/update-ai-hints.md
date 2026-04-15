---
description: Update ai/hints.md with latest patterns, conventions, and architectural guidance
allowed-tools: Read(./**), Write, Edit, Bash(git:*), Grep, Glob
argument-hint: "[--from-changes] [--section=patterns|commands|architecture] [--dry-run]"
---

# Update AI Hints

Updates `ai/hints.md` with the latest patterns, conventions, file structures, and commands discovered from recent code changes and documentation updates.

## Context Analysis

Analyze what has changed since last update:

```bash
# Check recent changes that might affect AI hints
git log --since="1 month ago" --oneline --name-only | grep -E '\.(ts|tsx|py|js|jsx|md)$' | sort | uniq

# Check for new patterns in recent commits
git diff HEAD~10 HEAD --name-only | grep -E 'src/|app/|services/' | head -20

# Look for new commands or scripts
git diff HEAD~10 HEAD --name-only | grep -E 'package\.json$|pyproject\.toml$|\.claude/'
```

## Content Update Strategy

### 1. Project Structure Updates

Scan for new directories or significant reorganization:

```bash
# Check current directory structure
find apps services packages infra docs -type d -maxdepth 3 2>/dev/null | sort

# Compare with structure documented in hints
grep -A 20 "## Project Structure" ai/hints.md || echo "No existing structure section"

# Identify new packages/apps/services
find apps -maxdepth 1 -type d | tail -n +2
find services -maxdepth 1 -type d | tail -n +2
find packages -maxdepth 1 -type d | tail -n +2
```

### 2. File Path Convention Analysis

Look for new patterns in recent code:

```bash
# Analyze new file organization patterns
echo "=== New Backend Files ==="
find services/api -name "*.py" -newer ai/hints.md 2>/dev/null | head -10

echo "=== New Frontend Files ==="
find apps/web/src -name "*.tsx" -newer ai/hints.md 2>/dev/null | head -10

echo "=== New UI Components ==="
find packages/ui/src -name "*.tsx" -newer ai/hints.md 2>/dev/null | head -10
```

### 3. Command and Script Discovery

Extract new commands from package.json and other config files:

```bash
# Check for new npm scripts
echo "=== Web App Scripts ==="
jq -r '.scripts | keys[]' apps/web/package.json 2>/dev/null | grep -v start | head -10

echo "=== API/Backend Commands ==="
grep -A 5 "scripts.*=" services/api/pyproject.toml 2>/dev/null || echo "No pyproject scripts found"

# Check for new Claude commands
find .claude/commands -name "*.md" -newer ai/hints.md 2>/dev/null | head -10
```

### 4. Architecture Pattern Updates

Look for new architectural patterns in the code:

```bash
# Check for new service patterns
echo "=== Service Layer Patterns ==="
find services/api/app/services -name "*.py" | head -5 | xargs grep -l "async def" 2>/dev/null

# Check for new repository patterns
echo "=== Repository Patterns ==="
find services/api/app/repositories -name "*.py" | head -5 | xargs grep -l "class.*Repository" 2>/dev/null

# Check for new frontend patterns
echo "=== Frontend Hook Patterns ==="
find apps/web/src/hooks -name "*.ts" | head -5 | xargs grep -l "export.*use" 2>/dev/null
```

## Content Generation

### 1. Update Project Structure Section

Based on current directory analysis:

```markdown
## Project Structure

MeatyPrompts follows a strict layered monorepo architecture:

- **Apps**: `apps/web` (Next.js), `apps/mobile` (Expo/RN)
- **Services**: `services/api` (FastAPI + SQLAlchemy)
- **Packages**: `packages/ui` (shared components), `packages/tokens` (design tokens)
- **Infrastructure**: `infra/terraform` (IaC), `infra/k8s` (Kubernetes configs)
- **Documentation**: `docs/` (Diátaxis structure)
- **Tools**: `tools/` (build scripts, generators)
- **Scripts**: `scripts/` (automation, utilities)
```

### 2. Refresh File Path Conventions

Update patterns based on current codebase:

```markdown
### Backend (FastAPI)
- **Schemas/DTOs**: `services/api/app/schemas/`
- **Repositories**: `services/api/app/repositories/` (data access layer)
- **Services**: `services/api/app/services/` (business logic)
- **Routes**: `services/api/app/api/v1/endpoints/` (HTTP handlers)
- **Models**: `services/api/app/models/` (SQLAlchemy models)
- **Tests**: `services/api/app/tests/` (unit/integration tests)
- **Migrations**: `services/api/alembic/versions/` (database migrations)

### Frontend (Next.js App Router)
- **App Pages**: `apps/web/src/app/` (App Router pages)
- **Components**: `apps/web/src/components/` (app-specific)
- **Hooks**: `apps/web/src/hooks/` (custom React hooks)
- **Utils**: `apps/web/src/lib/` (utilities, API clients)
- **Types**: `apps/web/src/types/` (TypeScript definitions)
- **Tests**: `apps/web/src/__tests__/` (Jest/React Testing Library)
```

### 3. Update Commands Section

Refresh with current package.json scripts and common commands:

```markdown
### Development
- **Web Dev**: `pnpm --filter "./apps/web" dev`
- **API Dev**: `export PYTHONPATH="$PWD/services/api" && uv run --project services/api uvicorn app.main:app --reload`
- **Mobile**: `pnpm --filter "./apps/mobile" start`
- **UI Storybook**: `pnpm --filter "./packages/ui" storybook`

### Testing
- **All Tests**: `pnpm -r test && uv run --project services/api pytest`
- **Web Tests**: `pnpm --filter "./apps/web" test`
- **API Tests**: `uv run --project services/api pytest app/tests`
- **UI Tests**: `pnpm --filter "./packages/ui" test`
- **E2E Tests**: `pnpm --filter "./apps/web" test:e2e`

### Build & Quality
- **Type Check**: `pnpm -r typecheck`
- **Lint**: `pnpm -r lint`
- **Build**: `pnpm -r build`
- **Format**: `pnpm -r format`
```

### 4. Architecture Rules Update

Refresh with current patterns and any new rules:

```markdown
## Architecture Rules

1. **Layered Backend**: router → service → repository → database
2. **UI Imports**: Apps import UI only from `@miethe/ui`, never directly from Radix
3. **Error Handling**: Use `ErrorResponse` envelope everywhere
4. **Pagination**: Always cursor-based pagination with `{ items, pageInfo }`
5. **Auth**: Single `AuthProvider` pattern, no duplicate user fetching
6. **Observability**: OpenTelemetry spans + structured JSON logs
7. **State Management**: React Query for server state, Zustand for client state
8. **Testing**: Unit tests for logic, integration for APIs, E2E for user flows
```

### 5. Common Patterns Section

Update with latest patterns found in the codebase:

```markdown
## Common Patterns

### API Endpoint Structure
\`\`\`python
# Router (validation + HTTP)
@router.post("/prompts", response_model=PromptResponse)
async def create_prompt(data: CreatePromptRequest, current_user: User = Depends(get_current_user)):
    return await prompt_service.create_prompt(data, current_user.id)

# Service (business logic)
async def create_prompt(data: CreatePromptRequest, user_id: str) -> PromptDTO:
    # Business logic here
    return await prompt_repository.create(prompt_data)

# Repository (data access)
async def create(prompt: PromptCreate) -> PromptModel:
    # Database operations here
\`\`\`

### Frontend Component Structure
\`\`\`tsx
// Shared component in packages/ui
export function PromptCard(props: PromptCardProps) {
  return <Card>...</Card>
}

// App-specific usage
import { PromptCard } from '@miethe/ui'
\`\`\`
```

## Update Process

### 1. Analyze Current Hints

Read existing `ai/hints.md` and identify sections to update:

```bash
# Check current sections
grep "^##" ai/hints.md | cat -n

# Look for outdated information
grep -n "TODO\|FIXME\|outdated" ai/hints.md || echo "No obvious outdated content"
```

### 2. Incremental Updates

For `--from-changes` mode:
1. **Analyze recent commits** for new patterns
2. **Update only affected sections** (structure, commands, patterns)
3. **Preserve existing content** that's still accurate
4. **Add new discoveries** without removing old information

### 3. Full Refresh

For complete update:
1. **Scan entire codebase** for current patterns
2. **Rebuild all sections** from current state
3. **Validate commands** actually work
4. **Cross-reference** with documentation

## Validation

### Command Verification

Test that documented commands actually work:

```bash
# Test development commands
echo "Testing web dev command..."
timeout 5 pnpm --filter "./apps/web" dev 2>&1 | head -3

# Test API command
echo "Testing API command..."
timeout 5 bash -c 'export PYTHONPATH="$PWD/services/api" && uv run --project services/api uvicorn app.main:app --reload' 2>&1 | head -3

# Test build commands
echo "Testing build commands..."
timeout 30 pnpm --filter "./packages/ui" build 2>&1 | tail -3
```

### Pattern Validation

Verify documented patterns exist in codebase:

```bash
# Check for service pattern
grep -r "async def.*service" services/api/app/services/ | head -3

# Check for repository pattern
grep -r "class.*Repository" services/api/app/repositories/ | head -3

# Check for component pattern
grep -r "export function" packages/ui/src/components/ | head -3
```

## Usage Examples

```bash
# Full update of all sections
/update-ai-hints

# Update only based on recent changes
/update-ai-hints --from-changes

# Update specific section only
/update-ai-hints --section=commands

# Preview changes without writing
/update-ai-hints --dry-run

# Update architecture rules only
/update-ai-hints --section=architecture
```

## Integration

### Automated Updates
- **Post-deployment**: Run after major releases
- **Weekly maintenance**: Scheduled updates to catch drift
- **PR integration**: Suggest updates when new patterns detected

### Quality Assurance
- **Command validation**: Ensure all documented commands work
- **Pattern verification**: Check patterns exist in current code
- **Documentation sync**: Cross-reference with main docs

The updated AI hints enable better:
- **Navigation**: Accurate file path conventions
- **Development**: Working commands and scripts
- **Architecture**: Current patterns and rules
- **Onboarding**: Up-to-date project structure
