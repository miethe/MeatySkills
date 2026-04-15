---
description: Batch update all AI artifacts (repo map, symbols, chunking, hints) after major changes
allowed-tools: Read(./**), Write, Edit, Bash(git:*), Bash(pnpm:*), Bash(uv:*), Bash(node:*), Grep, Glob
argument-hint: "[--force] [--dry-run] [--skip-validation] [--verbose]"
---

# Refresh All AI Artifacts

Comprehensive update of all AI artifacts in the `ai/` directory following major code changes, refactoring, or architecture updates. Orchestrates multiple artifact update commands in the correct order.

## Context Analysis

Analyze the scope of changes requiring artifact updates:

```bash
# Check what has changed since last AI artifact update
echo "=== Recent Changes Analysis ==="
last_update=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" ai/repo.map.json 2>/dev/null || echo "Never")
echo "Last AI artifact update: $last_update"

# Count changes by category
echo "Changes since last update:"
git log --since="$last_update" --oneline --name-only | grep -E '\.(ts|tsx|py|js|jsx)$' | wc -l | xargs echo "Source files changed:"
git log --since="$last_update" --oneline --name-only | grep -E 'package\.json$|pyproject\.toml$' | wc -l | xargs echo "Package configs changed:"
git log --since="$last_update" --oneline --name-only | grep -E '^(apps|services|packages)/' | wc -l | xargs echo "Architecture files changed:"

# Check for significant structural changes
git diff HEAD~20 HEAD --name-only | grep -E '^(apps|services|packages)/.*/(src|app)/' | head -10
```

## Pre-Update Validation

Ensure the environment is ready for artifact generation:

```bash
# Verify required tools are available
echo "=== Environment Check ==="
which node >/dev/null 2>&1 && echo "✓ Node.js available" || echo "✗ Node.js missing"
which pnpm >/dev/null 2>&1 && echo "✓ pnpm available" || echo "✗ pnpm missing"
which uv >/dev/null 2>&1 && echo "✓ uv available" || echo "✗ uv missing"

# Check workspace integrity
echo "=== Workspace Check ==="
[ -f pnpm-workspace.yaml ] && echo "✓ PNPM workspace configured" || echo "✗ PNPM workspace missing"
[ -d services/api ] && echo "✓ API service found" || echo "✗ API service missing"
[ -d packages/ui ] && echo "✓ UI package found" || echo "✗ UI package missing"

# Verify current artifacts exist and are readable
echo "=== Current Artifacts ==="
[ -f ai/repo.map.json ] && echo "✓ Repository map exists" || echo "✗ Repository map missing"
[ -f ai/symbols.graph.json ] && echo "✓ Symbols graph exists" || echo "✗ Symbols graph missing"
[ -f ai/chunking.config.json ] && echo "✓ Chunking config exists" || echo "✗ Chunking config missing"
[ -f ai/hints.md ] && echo "✓ AI hints exist" || echo "✗ AI hints missing"
```

## Artifact Update Orchestration

Execute updates in dependency order to ensure consistency:

### 1. Repository Map Update

First update the repository structure map as other artifacts depend on it:

```bash
echo "=== 1/4: Updating Repository Map ==="
/update-repo-map $([ "$DRY_RUN" = "true" ] && echo "--dry-run") $([ "$VERBOSE" = "true" ] && echo "--verbose")

if [ $? -ne 0 ]; then
  echo "❌ Repository map update failed"
  exit 1
fi
echo "✅ Repository map updated"
```

### 2. Symbols Graph Generation

Generate the symbols graph from current source code:

```bash
echo "=== 2/4: Updating Symbols Graph ==="
/update-symbols-graph $([ "$DRY_RUN" = "true" ] && echo "--dry-run") $([ "$VERBOSE" = "true" ] && echo "--verbose")

if [ $? -ne 0 ]; then
  echo "❌ Symbols graph update failed"
  exit 1
fi
echo "✅ Symbols graph updated"
```

### 3. Chunking Configuration Validation

Validate and tune chunking parameters based on current codebase:

```bash
echo "=== 3/4: Validating Chunking Configuration ==="
/validate-chunking --tune $([ "$VERBOSE" = "true" ] && echo "--stats")

if [ $? -ne 0 ]; then
  echo "❌ Chunking validation failed"
  exit 1
fi
echo "✅ Chunking configuration validated"
```

### 4. AI Hints Update

Update the AI hints with latest patterns and conventions:

```bash
echo "=== 4/4: Updating AI Hints ==="
/update-ai-hints --from-changes $([ "$DRY_RUN" = "true" ] && echo "--dry-run")

if [ $? -ne 0 ]; then
  echo "❌ AI hints update failed"
  exit 1
fi
echo "✅ AI hints updated"
```

## Post-Update Validation

Verify all artifacts are consistent and valid:

### Schema Validation

```bash
echo "=== Post-Update Validation ==="

# Validate JSON artifacts against schemas
echo "Validating repository map schema..."
if command -v ajv-cli >/dev/null 2>&1; then
  # Use ajv-cli if available for proper validation
  npx ajv-cli validate -s ai/repo.map.schema.json -d ai/repo.map.json 2>/dev/null && echo "✓ Repository map valid" || echo "✗ Repository map invalid"
else
  # Basic JSON syntax validation
  python3 -m json.tool ai/repo.map.json >/dev/null && echo "✓ Repository map JSON valid" || echo "✗ Repository map JSON invalid"
fi

echo "Validating symbols graph schema..."
python3 -m json.tool ai/symbols.graph.json >/dev/null && echo "✓ Symbols graph JSON valid" || echo "✗ Symbols graph JSON invalid"

echo "Validating chunking config schema..."
python3 -m json.tool ai/chunking.config.json >/dev/null && echo "✓ Chunking config JSON valid" || echo "✗ Chunking config JSON invalid"
```

### Cross-Artifact Consistency

```bash
# Check that package names in repo map match actual directories
echo "Checking repo map consistency..."
packages_in_map=$(jq -r '.packages | keys[]' ai/repo.map.json)
for pkg in $packages_in_map; do
  if [ ! -d "$pkg" ]; then
    echo "⚠ Package in map but not found: $pkg"
  fi
done

# Check that symbols graph references existing files
echo "Checking symbols graph file references..."
files_in_symbols=$(jq -r '.modules[].path' ai/symbols.graph.json | head -5)
for file in $files_in_symbols; do
  if [ ! -f "$file" ]; then
    echo "⚠ File in symbols graph but not found: $file"
  fi
done
```

### Quality Metrics

Generate quality metrics for the updated artifacts:

```bash
echo "=== Quality Metrics ==="

# Repository map metrics
packages_count=$(jq '.packages | length' ai/repo.map.json)
dependencies_count=$(jq '.graph | length' ai/repo.map.json)
echo "Repository map: $packages_count packages, $dependencies_count dependencies"

# Symbols graph metrics
modules_count=$(jq '.modules | length' ai/symbols.graph.json)
symbols_count=$(jq '[.modules[].symbols | length] | add' ai/symbols.graph.json)
echo "Symbols graph: $modules_count modules, $symbols_count symbols"

# Chunking config metrics
min_chunk=$(jq '.lineChunkMin' ai/chunking.config.json)
max_chunk=$(jq '.lineChunkMax' ai/chunking.config.json)
allowed_ext_count=$(jq '.allowExtensions | length' ai/chunking.config.json)
echo "Chunking config: $min_chunk-$max_chunk lines, $allowed_ext_count file types"

# AI hints metrics
hints_lines=$(wc -l < ai/hints.md)
hints_sections=$(grep "^##" ai/hints.md | wc -l)
echo "AI hints: $hints_lines lines, $hints_sections sections"
```

## Error Recovery

Handle common failure scenarios:

### Partial Failure Recovery

```bash
# If one artifact update fails, continue with others and report at end
failed_updates=()

update_artifact() {
  local name=$1
  local command=$2

  echo "Updating $name..."
  if ! eval "$command"; then
    echo "❌ Failed to update $name"
    failed_updates+=("$name")
    return 1
  else
    echo "✅ Successfully updated $name"
    return 0
  fi
}

# Continue even if individual updates fail
set +e
update_artifact "repo-map" "/update-repo-map"
update_artifact "symbols-graph" "/update-symbols-graph"
update_artifact "chunking-config" "/validate-chunking --tune"
update_artifact "ai-hints" "/update-ai-hints --from-changes"
set -e

# Report summary
if [ ${#failed_updates[@]} -eq 0 ]; then
  echo "🎉 All AI artifacts updated successfully"
else
  echo "⚠ Some updates failed: ${failed_updates[*]}"
  echo "Manual intervention may be required"
fi
```

### Rollback on Critical Failure

```bash
# Backup current artifacts before starting
backup_artifacts() {
  backup_dir=".ai-backup-$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$backup_dir"
  cp ai/*.json ai/*.md "$backup_dir/" 2>/dev/null || true
  echo "Artifacts backed up to: $backup_dir"
}

# Restore artifacts if critical failure occurs
restore_artifacts() {
  if [ -n "$backup_dir" ] && [ -d "$backup_dir" ]; then
    echo "Restoring artifacts from backup..."
    cp "$backup_dir"/* ai/ 2>/dev/null || true
    echo "Artifacts restored"
  fi
}
```

## Integration Modes

### Force Mode (`--force`)

Bypass validation checks and update all artifacts regardless of current state:

```bash
if [ "$FORCE" = "true" ]; then
  echo "🔥 Force mode enabled - bypassing validation checks"
  # Skip pre-update validation
  # Force regeneration even if files are newer than sources
fi
```

### Verbose Mode (`--verbose`)

Provide detailed progress information:

```bash
if [ "$VERBOSE" = "true" ]; then
  echo "📝 Verbose mode enabled"
  # Add detailed logging to each step
  # Show file counts, processing times, etc.
  # Display intermediate results
fi
```

### Skip Validation Mode (`--skip-validation`)

Skip post-update validation for faster execution:

```bash
if [ "$SKIP_VALIDATION" = "true" ]; then
  echo "⚡ Skipping post-update validation for speed"
  # Skip schema validation
  # Skip consistency checks
  # Skip quality metrics
fi
```

## Usage Examples

```bash
# Full refresh of all AI artifacts
/refresh-ai-artifacts

# Dry run to see what would be updated
/refresh-ai-artifacts --dry-run

# Force update even if no changes detected
/refresh-ai-artifacts --force

# Verbose output with detailed progress
/refresh-ai-artifacts --verbose

# Fast update without validation
/refresh-ai-artifacts --skip-validation

# Combined options
/refresh-ai-artifacts --force --verbose
```

## Automation Integration

### CI/CD Pipeline Integration

```yaml
# Add to GitHub Actions workflow
- name: Refresh AI Artifacts
  run: /refresh-ai-artifacts --skip-validation

- name: Commit updated artifacts
  run: |
    git add ai/
    git commit -m "chore(ai): refresh artifacts after code changes" || exit 0
```

### Pre-commit Hook

```bash
#!/bin/sh
# .git/hooks/pre-commit
if git diff --cached --name-only | grep -E '\.(ts|tsx|py|js|jsx)$' >/dev/null; then
  echo "Source files changed, refreshing AI artifacts..."
  /refresh-ai-artifacts --skip-validation
  git add ai/
fi
```

### Scheduled Maintenance

```bash
# Weekly cron job for artifact maintenance
0 2 * * 1 cd /path/to/meatyprompts && /refresh-ai-artifacts --force >/dev/null 2>&1
```

The refresh command ensures all AI artifacts stay synchronized with the evolving codebase, enabling:

- **Consistent navigation**: Repository map matches current structure
- **Accurate symbol lookup**: Symbols graph reflects current code
- **Optimal processing**: Chunking config tuned for current file sizes
- **Current patterns**: AI hints document latest conventions
- **Automated maintenance**: Regular updates prevent drift
