---
description: Update CODEOWNERS based on recent changes and ensure 100% coverage
allowed-tools: Read(./**), Write, Edit, Bash(git:*), Bash(pnpm:*), Bash(uv:*), Grep, Glob
argument-hint: "[--analyze-commits] [--dry-run] [--coverage-report] [--auto-assign]"
---

# Update CODEOWNERS

Updates the CODEOWNERS file based on recent code changes, repository structure, and team ownership patterns, ensuring 100% directory coverage as required by the repo architecture PRD.

## Context Analysis

Analyze current CODEOWNERS state and repository structure:

```bash
# Check existing CODEOWNERS file
echo "=== CODEOWNERS Analysis ==="
if [ -f "CODEOWNERS" ]; then
  echo "Current CODEOWNERS file found"
  echo "Lines in CODEOWNERS: $(wc -l < CODEOWNERS)"

  echo -e "\nCurrent ownership patterns:"
  grep -v "^#" CODEOWNERS | grep -v "^$" | head -10

  echo -e "\nTeams referenced:"
  grep -o "@[a-zA-Z0-9_/-]*" CODEOWNERS | sort | uniq
else
  echo "No CODEOWNERS file found - will create new one"
fi

# Analyze directory structure for coverage
echo -e "\n=== Directory Coverage Analysis ==="
# Find all significant directories that should have owners
significant_dirs=(
  "apps"
  "services"
  "packages"
  "infra"
  "docs"
  "tools"
  "scripts"
  ".github"
)

echo "Checking coverage for key directories:"
for dir in "${significant_dirs[@]}"; do
  if [ -d "$dir" ]; then
    echo "✓ $dir exists"
    # Check subdirectories
    find "$dir" -maxdepth 2 -type d | head -5 | sed 's/^/    /'
  else
    echo "✗ $dir not found"
  fi
done
```

## Repository Structure Analysis

### 1. Directory Mapping

```bash
# Map directory structure to determine ownership patterns
analyze_directory_structure() {
  echo "=== Directory Structure Analysis ==="

  # Create temporary file for analysis
  temp_structure=$(mktemp)

  # Find all directories that should have ownership
  find . -type d \
    -not -path "./.*" \
    -not -path "*/node_modules" \
    -not -path "*/__pycache__" \
    -not -path "*/dist" \
    -not -path "*/build" \
    -not -path "*/coverage" \
    -maxdepth 3 | sort > "$temp_structure"

  echo "Directories requiring ownership:"
  cat "$temp_structure" | head -20

  # Analyze by category
  echo -e "\nDirectory categories:"
  echo "Apps: $(grep "^./apps" "$temp_structure" | wc -l)"
  echo "Services: $(grep "^./services" "$temp_structure" | wc -l)"
  echo "Packages: $(grep "^./packages" "$temp_structure" | wc -l)"
  echo "Infrastructure: $(grep "^./infra" "$temp_structure" | wc -l)"
  echo "Documentation: $(grep "^./docs" "$temp_structure" | wc -l)"
  echo "Tools/Scripts: $(grep -E "^./(tools|scripts)" "$temp_structure" | wc -l)"

  rm "$temp_structure"
}
```

### 2. Commit History Analysis

```bash
# Analyze recent commits to understand who works on what
analyze_commit_history() {
  local months_back=${1:-6}

  echo "=== Commit History Analysis (last $months_back months) ==="

  # Get commit statistics by directory
  echo "Commit activity by directory:"

  # Analyze commits in each major directory
  for dir in apps services packages infra docs tools scripts; do
    if [ -d "$dir" ]; then
      commits=$(git log --since="$months_back months ago" --oneline --name-only | grep "^$dir/" | wc -l)
      contributors=$(git log --since="$months_back months ago" --format="%ae" -- "$dir/" | sort | uniq | wc -l)

      if [ "$commits" -gt 0 ]; then
        echo "$dir/: $commits commits, $contributors contributors"

        # Show top contributors for this directory
        echo "  Top contributors:"
        git log --since="$months_back months ago" --format="%ae" -- "$dir/" | \
          sort | uniq -c | sort -nr | head -3 | \
          while read count email; do
            name=$(git log --author="$email" --format="%an" -1 2>/dev/null || echo "$email")
            echo "    $name ($count commits)"
          done
      fi
    fi
  done
}
```

### 3. Team Structure Detection

```bash
# Detect team structure from existing patterns and git history
detect_team_structure() {
  echo "=== Team Structure Detection ==="

  # Extract teams from existing CODEOWNERS
  if [ -f "CODEOWNERS" ]; then
    existing_teams=$(grep -o "@[a-zA-Z0-9_/-]*" CODEOWNERS | sort | uniq)
    echo "Existing teams in CODEOWNERS:"
    echo "$existing_teams" | sed 's/^/  /'
  fi

  # Suggest team structure based on directory patterns
  echo -e "\nSuggested team structure based on repository:"

  # Core team patterns
  echo "Core teams needed:"
  [ -d "apps/web" ] && echo "  @mp/web - Web application team"
  [ -d "apps/mobile" ] && echo "  @mp/mobile - Mobile application team"
  [ -d "services/api" ] && echo "  @mp/backend - Backend/API team"
  [ -d "packages/ui" ] && echo "  @mp/design-system - Design system team"
  [ -d "infra" ] && echo "  @mp/devops - DevOps/Infrastructure team"
  [ -d "docs" ] && echo "  @mp/devrel - Developer relations/Documentation team"

  # Always needed
  echo "  @mp/core - Core maintainers (fallback ownership)"
  echo "  @mp/security - Security reviews for sensitive areas"
}
```

## CODEOWNERS Generation

### 1. Generate Base CODEOWNERS Structure

```bash
# Generate comprehensive CODEOWNERS file
generate_codeowners() {
  local dry_run=${1:-false}
  local output_file="CODEOWNERS"

  if [ "$dry_run" = "true" ]; then
    output_file="/tmp/CODEOWNERS.preview"
  fi

  echo "=== Generating CODEOWNERS File ==="

  cat > "$output_file" << 'EOF'
# CODEOWNERS - Code Ownership and Review Rules
# https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
#
# Global fallback - core team reviews everything by default
*                                   @mp/core

# Root configuration files
/.github/                           @mp/core @mp/devops
/.*                                 @mp/core
/package.json                       @mp/core
/pnpm-workspace.yaml               @mp/core
/pyproject.toml                    @mp/core
/README.md                         @mp/core @mp/devrel
/CONTRIBUTING.md                   @mp/devrel
/SECURITY.md                       @mp/security
/LICENSE                           @mp/core

EOF

  # Add application-specific ownership
  if [ -d "apps" ]; then
    echo "# Applications" >> "$output_file"

    if [ -d "apps/web" ]; then
      cat >> "$output_file" << 'EOF'
/apps/web/                          @mp/web
/apps/web/src/components/           @mp/web @mp/design-system
/apps/web/src/hooks/                @mp/web
/apps/web/src/lib/                  @mp/web @mp/backend
/apps/web/package.json              @mp/web @mp/core

EOF
    fi

    if [ -d "apps/mobile" ]; then
      cat >> "$output_file" << 'EOF'
/apps/mobile/                       @mp/mobile
/apps/mobile/src/components/        @mp/mobile @mp/design-system
/apps/mobile/package.json           @mp/mobile @mp/core

EOF
    fi
  fi

  # Add services ownership
  if [ -d "services" ]; then
    echo "# Services" >> "$output_file"

    if [ -d "services/api" ]; then
      cat >> "$output_file" << 'EOF'
/services/api/                      @mp/backend
/services/api/app/models/           @mp/backend @mp/core
/services/api/app/schemas/          @mp/backend @mp/web
/services/api/alembic/              @mp/backend @mp/devops
/services/api/pyproject.toml        @mp/backend @mp/core

EOF
    fi
  fi

  # Add packages ownership
  if [ -d "packages" ]; then
    echo "# Packages" >> "$output_file"

    if [ -d "packages/ui" ]; then
      cat >> "$output_file" << 'EOF'
/packages/ui/                       @mp/design-system
/packages/ui/src/components/        @mp/design-system @mp/web @mp/mobile
/packages/ui/package.json           @mp/design-system @mp/core

EOF
    fi

    if [ -d "packages/tokens" ]; then
      cat >> "$output_file" << 'EOF'
/packages/tokens/                   @mp/design-system
/packages/tokens/package.json       @mp/design-system @mp/core

EOF
    fi
  fi

  # Add infrastructure ownership
  if [ -d "infra" ]; then
    echo "# Infrastructure" >> "$output_file"
    cat >> "$output_file" << 'EOF'
/infra/                             @mp/devops
/infra/terraform/                   @mp/devops @mp/security
/infra/k8s/                         @mp/devops
/infra/docker/                      @mp/devops

EOF
  fi

  # Add documentation ownership
  if [ -d "docs" ]; then
    echo "# Documentation" >> "$output_file"
    cat >> "$output_file" << 'EOF'
/docs/                              @mp/devrel
/docs/api/                          @mp/backend @mp/devrel
/docs/architecture/                 @mp/core @mp/devrel
/docs/adrs/                         @mp/core

EOF
  fi

  # Add tools and scripts
  if [ -d "tools" ] || [ -d "scripts" ]; then
    echo "# Tools and Scripts" >> "$output_file"

    [ -d "tools" ] && echo "/tools/                             @mp/core @mp/devops" >> "$output_file"
    [ -d "scripts" ] && echo "/scripts/                           @mp/core @mp/devops" >> "$output_file"
    echo >> "$output_file"
  fi

  # Add AI artifacts ownership
  if [ -d "ai" ]; then
    echo "# AI Artifacts" >> "$output_file"
    cat >> "$output_file" << 'EOF'
/ai/                                @mp/core @mp/devrel
/ai/repo.map.json                   @mp/core
/ai/symbols.graph.json              @mp/core
/ai/hints.md                        @mp/devrel

EOF
  fi

  # Add special files and security-sensitive areas
  cat >> "$output_file" << 'EOF'
# Special files requiring security review
*.env.example                       @mp/security @mp/devops
**/secrets.yml                      @mp/security
**/security.yml                     @mp/security
/SECURITY.md                        @mp/security
/.github/workflows/                 @mp/devops @mp/security
/contracts/                         @mp/backend @mp/core

# Database and migrations
**/migrations/                      @mp/backend @mp/core
**/alembic/                         @mp/backend @mp/core
*schema*.sql                        @mp/backend @mp/core

# Configuration files
**/docker-compose*.yml              @mp/devops
**/Dockerfile*                      @mp/devops
**/nginx.conf                       @mp/devops
**/supervisord.conf                 @mp/devops
EOF

  if [ "$dry_run" = "true" ]; then
    echo "✅ CODEOWNERS preview generated: $output_file"
    echo "Preview (first 20 lines):"
    head -20 "$output_file"
  else
    echo "✅ CODEOWNERS file generated: $output_file"
  fi
}
```

### 2. Coverage Analysis

```bash
# Analyze CODEOWNERS coverage
analyze_coverage() {
  local codeowners_file="${1:-CODEOWNERS}"

  echo "=== CODEOWNERS Coverage Analysis ==="

  if [ ! -f "$codeowners_file" ]; then
    echo "❌ CODEOWNERS file not found: $codeowners_file"
    return 1
  fi

  # Get all directories that should be covered
  significant_paths=$(find . -type f -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" | \
    grep -v node_modules | grep -v __pycache__ | grep -v dist | grep -v build | \
    head -50 | sort)

  echo "Checking coverage for key files..."

  # Check coverage for each significant path
  covered_count=0
  total_count=0
  uncovered_files=()

  for file in $significant_paths; do
    total_count=$((total_count + 1))

    # Use GitHub's CODEOWNERS pattern matching logic (simplified)
    if check_file_coverage "$file" "$codeowners_file"; then
      covered_count=$((covered_count + 1))
    else
      uncovered_files+=("$file")
    fi
  done

  # Calculate coverage percentage
  coverage_percent=$((covered_count * 100 / total_count))

  echo "Coverage Statistics:"
  echo "  Total files checked: $total_count"
  echo "  Covered files: $covered_count"
  echo "  Coverage: $coverage_percent%"

  if [ ${#uncovered_files[@]} -gt 0 ]; then
    echo -e "\n⚠ Uncovered files (first 10):"
    printf '%s\n' "${uncovered_files[@]}" | head -10 | sed 's/^/    /'

    if [ ${#uncovered_files[@]} -gt 10 ]; then
      echo "    ... and $((${#uncovered_files[@]} - 10)) more"
    fi
  fi

  # Check for 100% coverage requirement
  if [ "$coverage_percent" -eq 100 ]; then
    echo "✅ 100% coverage achieved!"
  else
    echo "⚠ Coverage below 100% - consider adding more specific patterns"
  fi
}

# Helper function to check if a file is covered by CODEOWNERS
check_file_coverage() {
  local file="$1"
  local codeowners_file="$2"

  # Simple pattern matching (GitHub's actual logic is more complex)
  # This is a simplified version for demonstration

  # Check if any pattern in CODEOWNERS matches the file
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue

    # Extract pattern (first field)
    pattern=$(echo "$line" | awk '{print $1}')

    # Simple glob-like matching
    if [[ "$file" == $pattern ]] || [[ "$file" == ${pattern#/} ]]; then
      return 0
    fi

    # Handle wildcard patterns
    if [[ "$pattern" == *"*" ]]; then
      # Convert glob pattern to regex (simplified)
      regex_pattern=$(echo "$pattern" | sed 's/\*/.*/' | sed 's/\//\\\//g')
      if echo "$file" | grep -q "^$regex_pattern"; then
        return 0
      fi
    fi

    # Handle directory patterns
    if [[ "$pattern" == */ ]]; then
      dir_pattern=${pattern%/}
      if [[ "$file" == "$dir_pattern"* ]] || [[ "$file" == "${dir_pattern#/}"* ]]; then
        return 0
      fi
    fi

  done < "$codeowners_file"

  return 1
}
```

### 3. Auto-assignment Based on Git History

```bash
# Automatically assign owners based on git commit history
auto_assign_owners() {
  local months_back=${1:-6}
  local min_commits=${2:-5}

  echo "=== Auto-assignment Based on Git History ==="
  echo "Analyzing last $months_back months, minimum $min_commits commits"

  # Create temporary file for suggestions
  temp_suggestions=$(mktemp)

  # Analyze major directories
  for dir in apps services packages infra docs tools scripts; do
    if [ -d "$dir" ]; then
      echo -e "\nAnalyzing $dir/:"

      # Get contributors with significant activity
      contributors=$(git log --since="$months_back months ago" --format="%ae" -- "$dir/" | \
        sort | uniq -c | sort -nr | \
        awk -v min="$min_commits" '$1 >= min {print $2}')

      if [ -n "$contributors" ]; then
        echo "Frequent contributors to $dir/:"
        for email in $contributors; do
          commits=$(git log --since="$months_back months ago" --format="%ae" -- "$dir/" | grep -c "$email")
          name=$(git log --author="$email" --format="%an" -1 2>/dev/null || echo "$email")
          echo "  $name <$email>: $commits commits"
        done

        # Suggest CODEOWNERS entry
        echo "/$dir/                             # Consider assigning frequent contributors" >> "$temp_suggestions"
      else
        echo "  No frequent contributors found (minimum $min_commits commits)"
      fi
    fi
  done

  echo -e "\n✅ Auto-assignment suggestions saved to: $temp_suggestions"
  echo "Review and integrate these suggestions into CODEOWNERS:"
  cat "$temp_suggestions"

  rm "$temp_suggestions"
}
```

## Team Management Integration

### 1. GitHub Team Validation

```bash
# Validate that referenced teams exist (if using GitHub CLI)
validate_github_teams() {
  local codeowners_file="${1:-CODEOWNERS}"

  echo "=== GitHub Team Validation ==="

  if ! command -v gh >/dev/null 2>&1; then
    echo "ℹ GitHub CLI not available - skipping team validation"
    echo "  Install: gh auth login"
    return 0
  fi

  # Extract all teams from CODEOWNERS
  teams=$(grep -o "@[a-zA-Z0-9_/-]*" "$codeowners_file" | sort | uniq)

  echo "Validating teams:"
  for team in $teams; do
    # Remove @ prefix for GitHub API
    team_name=${team#@}

    if [[ "$team_name" == *"/"* ]]; then
      org=$(echo "$team_name" | cut -d/ -f1)
      team_slug=$(echo "$team_name" | cut -d/ -f2)

      # Check if team exists using GitHub CLI
      if gh api "orgs/$org/teams/$team_slug" >/dev/null 2>&1; then
        echo "  ✅ $team exists"
      else
        echo "  ❌ $team not found or not accessible"
      fi
    else
      echo "  ℹ $team - assuming individual user"
    fi
  done
}
```

### 2. Team Suggestions

```bash
# Suggest team structure improvements
suggest_team_improvements() {
  echo "=== Team Structure Suggestions ==="

  # Analyze current ownership patterns
  if [ -f "CODEOWNERS" ]; then
    echo "Current team distribution:"
    grep -o "@[a-zA-Z0-9_/-]*" CODEOWNERS | sort | uniq -c | sort -nr

    echo -e "\nSuggestions for improvement:"

    # Check for over-broad ownership
    fallback_count=$(grep -c "@mp/core" CODEOWNERS || echo "0")
    if [ "$fallback_count" -gt 10 ]; then
      echo "⚠ @mp/core is used extensively ($fallback_count times)"
      echo "  Consider creating more specific teams for better ownership distribution"
    fi

    # Check for missing specialized teams
    if grep -q "security" CODEOWNERS && ! grep -q "@mp/security" CODEOWNERS; then
      echo "ℹ Security-related files found but no @mp/security team"
      echo "  Consider creating a security team for sensitive files"
    fi

    if [ -d "docs" ] && ! grep -q "@mp/devrel" CODEOWNERS; then
      echo "ℹ Documentation directory exists but no @mp/devrel team"
      echo "  Consider creating a developer relations team for docs"
    fi
  fi
}
```

## Integration and Automation

### 1. CI/CD Integration

```bash
# Create workflow for CODEOWNERS validation
create_codeowners_workflow() {
  cat > .github/workflows/validate-codeowners.yml << 'EOF'
name: Validate CODEOWNERS

on:
  pull_request:
    paths:
      - 'CODEOWNERS'
      - '**/*.ts'
      - '**/*.tsx'
      - '**/*.py'
      - '**/*.js'
      - '**/*.jsx'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate CODEOWNERS syntax
        run: |
          # Basic syntax validation
          if [ -f "CODEOWNERS" ]; then
            echo "✅ CODEOWNERS file exists"

            # Check for basic syntax issues
            if grep -q "^[^#].*[[:space:]]$" CODEOWNERS; then
              echo "⚠ Lines with trailing whitespace found"
            fi

            # Check for valid team/user format
            invalid_owners=$(grep -E "^[^#]" CODEOWNERS | grep -v -E "@[a-zA-Z0-9_/-]+" | grep -v "^$" || true)
            if [ -n "$invalid_owners" ]; then
              echo "❌ Invalid owner format found:"
              echo "$invalid_owners"
              exit 1
            fi

            echo "✅ CODEOWNERS syntax validation passed"
          else
            echo "❌ CODEOWNERS file not found"
            exit 1
          fi

      - name: Check coverage
        run: |
          /update-codeowners --coverage-report
EOF

  echo "✅ CODEOWNERS validation workflow created"
}
```

### 2. Periodic Updates

```bash
# Setup periodic CODEOWNERS updates
setup_periodic_updates() {
  cat > .github/workflows/update-codeowners.yml << 'EOF'
name: Update CODEOWNERS

on:
  schedule:
    # Run monthly on the 1st at 00:00 UTC
    - cron: '0 0 1 * *'
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Update CODEOWNERS
        run: |
          /update-codeowners --analyze-commits --auto-assign

      - name: Create Pull Request
        uses: peter-evans/create-pull-request@v5
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          commit-message: "chore: update CODEOWNERS based on recent activity"
          title: "Update CODEOWNERS file"
          body: |
            Automated update of CODEOWNERS file based on recent commit activity.

            This PR was created automatically to ensure code ownership stays current.

            Please review the changes and merge if appropriate.
          branch: update-codeowners
EOF

  echo "✅ Periodic CODEOWNERS update workflow created"
}
```

## Usage Examples

```bash
# Update CODEOWNERS with current repository structure
/update-codeowners

# Analyze commit history and auto-assign owners
/update-codeowners --analyze-commits --auto-assign

# Preview changes without writing file
/update-codeowners --dry-run

# Generate coverage report
/update-codeowners --coverage-report

# Update based on last 12 months of activity
/update-codeowners --analyze-commits --months=12
```

## Quality Assurance

### 1. CODEOWNERS Validation

```bash
# Comprehensive CODEOWNERS validation
validate_codeowners_quality() {
  local codeowners_file="${1:-CODEOWNERS}"

  echo "=== CODEOWNERS Quality Validation ==="

  # Check file exists and is readable
  if [ ! -f "$codeowners_file" ]; then
    echo "❌ CODEOWNERS file not found"
    return 1
  fi

  echo "✅ CODEOWNERS file exists"

  # Check for common issues
  echo "Checking for common issues..."

  # Issue 1: Trailing whitespace
  if grep -q "[[:space:]]$" "$codeowners_file"; then
    echo "⚠ Lines with trailing whitespace found"
  else
    echo "✅ No trailing whitespace"
  fi

  # Issue 2: Invalid patterns
  invalid_patterns=$(grep -E "^[^#]" "$codeowners_file" | grep -v -E "^[^[:space:]]+[[:space:]]+@" | grep -v "^$" || true)
  if [ -n "$invalid_patterns" ]; then
    echo "⚠ Potentially invalid patterns found:"
    echo "$invalid_patterns" | sed 's/^/    /'
  else
    echo "✅ All patterns appear valid"
  fi

  # Issue 3: Duplicate patterns
  patterns=$(grep -E "^[^#]" "$codeowners_file" | awk '{print $1}' | grep -v "^$")
  duplicates=$(echo "$patterns" | sort | uniq -d)
  if [ -n "$duplicates" ]; then
    echo "⚠ Duplicate patterns found:"
    echo "$duplicates" | sed 's/^/    /'
  else
    echo "✅ No duplicate patterns"
  fi

  # Issue 4: Missing global fallback
  if ! grep -q "^\*[[:space:]]" "$codeowners_file"; then
    echo "⚠ No global fallback pattern (*) found"
    echo "  Consider adding: * @mp/core"
  else
    echo "✅ Global fallback pattern present"
  fi

  # Statistics
  total_patterns=$(grep -E "^[^#]" "$codeowners_file" | grep -v "^$" | wc -l)
  unique_teams=$(grep -o "@[a-zA-Z0-9_/-]*" "$codeowners_file" | sort | uniq | wc -l)

  echo -e "\nStatistics:"
  echo "  Total patterns: $total_patterns"
  echo "  Unique teams/users: $unique_teams"
  echo "  File size: $(wc -c < "$codeowners_file") bytes"
}
```

The update-codeowners command ensures:

- **100% coverage**: All files have designated owners
- **Current ownership**: Reflects actual contributor patterns
- **Team structure**: Proper organization ownership hierarchy
- **Quality validation**: Syntax and pattern correctness
- **Automation**: CI/CD integration and periodic updates
- **GitHub integration**: Team validation and proper formatting
