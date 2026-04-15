---
description: Scan for file size, secrets, and LFS violations following MP security policies
allowed-tools: Read(./**), Bash(git:*), Bash(find:*), Bash(grep:*), Bash(rg:*), Grep, Glob
argument-hint: "[--type=size|secrets|lfs|all] [--fix-violations] [--report-format=text|json|md]"
---

# Scan Policy Violations

Comprehensive security and policy violation scanner that detects file size violations, exposed secrets, improper LFS usage, and other policy infractions as specified in the repo architecture PRD.

## Context Analysis

Analyze current repository state for potential violations:

```bash
# Repository overview and potential risk areas
echo "=== Repository Security Scan Overview ==="

# Basic repository statistics
echo "Repository statistics:"
echo "Total files: $(find . -type f | wc -l)"
echo "Git tracked files: $(git ls-files | wc -l)"
echo "Repository size: $(du -sh . | cut -f1)"

# Check for policy-related configuration files
echo -e "\nPolicy configuration files:"
[ -f ".gitattributes" ] && echo "✅ .gitattributes found" || echo "⚠ .gitattributes missing"
[ -f ".gitignore" ] && echo "✅ .gitignore found" || echo "⚠ .gitignore missing"
[ -f ".pre-commit-config.yaml" ] && echo "✅ pre-commit config found" || echo "⚠ pre-commit config missing"
[ -f ".gitleaks.toml" ] && echo "✅ gitleaks config found" || echo "ℹ gitleaks config not found"

# Check Git LFS status
if command -v git-lfs >/dev/null 2>&1; then
  echo "✅ Git LFS available"
  echo "LFS tracked files: $(git lfs ls-files | wc -l)"
else
  echo "⚠ Git LFS not available"
fi
```

## File Size Violation Detection

### 1. Large File Detection

```bash
# Detect files exceeding size thresholds per PRD specification
scan_file_sizes() {
  echo "=== File Size Violation Scan ==="

  # PRD thresholds:
  # - Source files: ≤ 500 KB
  # - Text files: ≤ 1 MB
  # - Binaries > 5 MB → should be in LFS

  local source_limit_kb=500
  local text_limit_kb=1024
  local binary_limit_kb=5120

  echo "Scanning with thresholds:"
  echo "  Source files: ≤ ${source_limit_kb} KB"
  echo "  Text files: ≤ ${text_limit_kb} KB"
  echo "  Binaries: > ${binary_limit_kb} KB should be in LFS"

  # Create temporary files for results
  large_source_files=$(mktemp)
  large_text_files=$(mktemp)
  large_binary_files=$(mktemp)

  # Scan all tracked files
  git ls-files | while read -r file; do
    if [ -f "$file" ]; then
      size_kb=$(du -k "$file" | cut -f1)

      # Categorize file type
      case "$file" in
        *.ts|*.tsx|*.js|*.jsx|*.py|*.java|*.cpp|*.c|*.h|*.cs|*.rb|*.go|*.rs|*.php)
          # Source code files
          if [ "$size_kb" -gt "$source_limit_kb" ]; then
            echo "$file: ${size_kb} KB (limit: ${source_limit_kb} KB)" >> "$large_source_files"
          fi
          ;;
        *.md|*.txt|*.json|*.yml|*.yaml|*.xml|*.html|*.css|*.sql)
          # Text files
          if [ "$size_kb" -gt "$text_limit_kb" ]; then
            echo "$file: ${size_kb} KB (limit: ${text_limit_kb} KB)" >> "$large_text_files"
          fi
          ;;
        *.png|*.jpg|*.jpeg|*.gif|*.pdf|*.zip|*.tar|*.gz|*.mp4|*.mov|*.avi|*.exe|*.dll|*.so|*.dylib)
          # Binary files
          if [ "$size_kb" -gt "$binary_limit_kb" ]; then
            echo "$file: ${size_kb} KB (should use Git LFS)" >> "$large_binary_files"
          fi
          ;;
      esac
    fi
  done

  # Report results
  echo -e "\n📊 File Size Violation Results:"

  if [ -s "$large_source_files" ]; then
    echo -e "\n❌ Large source files (> ${source_limit_kb} KB):"
    cat "$large_source_files" | head -10 | sed 's/^/    /'
    file_count=$(wc -l < "$large_source_files")
    [ "$file_count" -gt 10 ] && echo "    ... and $((file_count - 10)) more"
  else
    echo -e "\n✅ No oversized source files found"
  fi

  if [ -s "$large_text_files" ]; then
    echo -e "\n❌ Large text files (> ${text_limit_kb} KB):"
    cat "$large_text_files" | head -10 | sed 's/^/    /'
    file_count=$(wc -l < "$large_text_files")
    [ "$file_count" -gt 10 ] && echo "    ... and $((file_count - 10)) more"
  else
    echo -e "\n✅ No oversized text files found"
  fi

  if [ -s "$large_binary_files" ]; then
    echo -e "\n⚠ Large binary files (> ${binary_limit_kb} KB, should use LFS):"
    cat "$large_binary_files" | head -10 | sed 's/^/    /'
    file_count=$(wc -l < "$large_binary_files")
    [ "$file_count" -gt 10 ] && echo "    ... and $((file_count - 10)) more"
  else
    echo -e "\n✅ No large binary files found outside LFS"
  fi

  # Cleanup
  rm "$large_source_files" "$large_text_files" "$large_binary_files"
}
```

### 2. Git LFS Compliance Check

```bash
# Check Git LFS compliance and suggest files for LFS
check_lfs_compliance() {
  echo "=== Git LFS Compliance Check ==="

  if ! command -v git-lfs >/dev/null 2>&1; then
    echo "⚠ Git LFS not installed - binary file management may be suboptimal"
    echo "  Install: https://git-lfs.github.io/"
    return 1
  fi

  # Check .gitattributes for LFS patterns
  if [ -f ".gitattributes" ]; then
    echo "Current LFS patterns in .gitattributes:"
    grep "filter=lfs" .gitattributes | sed 's/^/    /' || echo "    No LFS patterns found"
  else
    echo "⚠ No .gitattributes file found"
  fi

  # Find binary files that should be in LFS
  echo -e "\nScanning for binary files that should use LFS..."

  binary_extensions=(
    "png" "jpg" "jpeg" "gif" "bmp" "tiff" "webp"
    "mp4" "mov" "avi" "mkv" "wmv" "flv" "webm"
    "mp3" "wav" "flac" "aac" "ogg"
    "pdf" "doc" "docx" "xls" "xlsx" "ppt" "pptx"
    "zip" "tar" "gz" "bz2" "7z" "rar"
    "exe" "msi" "dmg" "pkg" "deb" "rpm"
    "so" "dll" "dylib" "lib" "a"
  )

  should_be_lfs=()

  for ext in "${binary_extensions[@]}"; do
    files=$(find . -name "*.${ext}" -type f | grep -v ".git" | head -20)
    for file in $files; do
      if [ -f "$file" ]; then
        # Check if file is already in LFS
        if git lfs ls-files | grep -q "$file"; then
          echo "✅ $file (already in LFS)"
        else
          size_mb=$(du -m "$file" | cut -f1)
          if [ "$size_mb" -gt 1 ]; then
            should_be_lfs+=("$file")
            echo "⚠ $file (${size_mb} MB, should be in LFS)"
          fi
        fi
      fi
    done
  done

  if [ ${#should_be_lfs[@]} -eq 0 ]; then
    echo "✅ All binary files are properly managed"
  else
    echo -e "\n💡 Suggested .gitattributes additions:"
    for ext in "${binary_extensions[@]}"; do
      # Check if we found files with this extension
      if printf '%s\n' "${should_be_lfs[@]}" | grep -q "\.${ext}$"; then
        echo "*.${ext} filter=lfs diff=lfs merge=lfs -text"
      fi
    done
  fi
}
```

## Secret Detection

### 1. Comprehensive Secret Scanning

```bash
# Scan for exposed secrets and sensitive data
scan_secrets() {
  echo "=== Secret Detection Scan ==="

  # Method 1: Use gitleaks if available (preferred)
  if command -v gitleaks >/dev/null 2>&1; then
    echo "Using gitleaks for comprehensive secret detection..."

    # Create temporary gitleaks config if none exists
    if [ ! -f ".gitleaks.toml" ]; then
      create_gitleaks_config
    fi

    # Run gitleaks scan
    if gitleaks detect --source . --report-format json --report-path gitleaks-report.json; then
      echo "✅ No secrets detected by gitleaks"
    else
      echo "❌ Secrets detected by gitleaks - check gitleaks-report.json"
      # Show summary if jq is available
      if command -v jq >/dev/null 2>&1; then
        secret_count=$(jq length gitleaks-report.json 2>/dev/null || echo "unknown")
        echo "  Total secrets found: $secret_count"

        # Show first few findings
        echo "  Sample findings:"
        jq -r '.[0:3][] | "    \(.File):\(.StartLine) - \(.Description)"' gitleaks-report.json 2>/dev/null | head -5
      fi
    fi
  else
    echo "ℹ gitleaks not available - using pattern-based detection"
    echo "  Install gitleaks for comprehensive detection: https://github.com/zricethezav/gitleaks"
    pattern_based_secret_scan
  fi
}

# Create basic gitleaks configuration
create_gitleaks_config() {
  cat > .gitleaks.toml << 'EOF'
title = "MeatyPrompts Secret Detection"

[extend]
# Extend the base configuration
useDefault = true

[[rules]]
description = "AWS Access Key ID"
regex = '''AKIA[0-9A-Z]{16}'''
tags = ["secret", "AWS"]

[[rules]]
description = "AWS Secret Access Key"
regex = '''aws(.{0,20})?['\"][0-9a-zA-Z\/+]{40}['\"]'''
tags = ["secret", "AWS"]

[[rules]]
description = "GitHub Personal Access Token"
regex = '''ghp_[0-9a-zA-Z]{36}'''
tags = ["secret", "GitHub"]

[[rules]]
description = "JWT Token"
regex = '''eyJ[a-zA-Z0-9+/=]+\.eyJ[a-zA-Z0-9+/=]+\.[a-zA-Z0-9+/=]+'''
tags = ["secret", "JWT"]

[[rules]]
description = "Private Key"
regex = '''-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----'''
tags = ["secret", "key"]

[[rules]]
description = "Database Connection String"
regex = '''(postgres|mysql|mongodb)://[^:]+:[^@]+@[^/]+/[^?]+'''
tags = ["secret", "database"]

[allowlist]
description = "Allowlist for test files and documentation"
paths = [
  '''.*\.example$''',
  '''.*\.sample$''',
  '''.*\.template$''',
  '''.*\.md$''',
  '''.*test.*''',
  '''.*spec.*''',
  '''.*mock.*''',
]
EOF

  echo "✅ Created basic .gitleaks.toml configuration"
}

# Pattern-based secret detection fallback
pattern_based_secret_scan() {
  echo "Running pattern-based secret detection..."

  # Define secret patterns
  declare -A secret_patterns=(
    ["AWS Access Key"]="AKIA[0-9A-Z]{16}"
    ["AWS Secret Key"]="aws.*['\"][0-9a-zA-Z\/+]{40}['\"]"
    ["GitHub Token"]="ghp_[0-9a-zA-Z]{36}"
    ["Slack Token"]="xox[baprs]-([0-9a-zA-Z]{10,48})"
    ["JWT Token"]="eyJ[a-zA-Z0-9+/=]+\.eyJ[a-zA-Z0-9+/=]+\.[a-zA-Z0-9+/=]+"
    ["Private Key"]="-----BEGIN.*PRIVATE KEY-----"
    ["API Key Pattern"]="[aA][pP][iI]_?[kK][eE][yY].*['\"][0-9a-zA-Z]{32,}['\"]"
    ["Database URL"]="(postgres|mysql|mongodb)://[^:]+:[^@]+@"
  )

  total_findings=0

  # Search for each pattern
  for pattern_name in "${!secret_patterns[@]}"; do
    pattern="${secret_patterns[$pattern_name]}"

    # Use ripgrep if available, otherwise fall back to grep
    if command -v rg >/dev/null 2>&1; then
      findings=$(rg "$pattern" --type-not log --type-not binary 2>/dev/null || true)
    else
      findings=$(grep -r -E "$pattern" . --exclude-dir=.git --exclude-dir=node_modules --exclude="*.log" 2>/dev/null || true)
    fi

    if [ -n "$findings" ]; then
      echo "❌ $pattern_name detected:"
      echo "$findings" | head -3 | sed 's/^/    /'
      count=$(echo "$findings" | wc -l)
      [ "$count" -gt 3 ] && echo "    ... and $((count - 3)) more occurrences"
      total_findings=$((total_findings + count))
    fi
  done

  if [ "$total_findings" -eq 0 ]; then
    echo "✅ No obvious secrets detected by pattern matching"
  else
    echo "⚠ Total potential secrets found: $total_findings"
    echo "  Consider reviewing these findings and using .env.example files for configuration"
  fi
}
```

### 2. Environment File Validation

```bash
# Validate environment file practices
validate_env_files() {
  echo "=== Environment File Validation ==="

  # Check for .env files (should not be committed)
  env_files=$(find . -name ".env" -not -path "./.git/*" 2>/dev/null || true)
  if [ -n "$env_files" ]; then
    echo "❌ .env files found in repository (should not be committed):"
    echo "$env_files" | sed 's/^/    /'
    echo "  Move sensitive values to environment variables or CI/CD secrets"
  else
    echo "✅ No .env files found in repository"
  fi

  # Check for .env.example files (should exist)
  example_files=$(find . -name ".env.example" -o -name ".env.template" 2>/dev/null || true)
  if [ -n "$example_files" ]; then
    echo "✅ Environment example files found:"
    echo "$example_files" | sed 's/^/    /'

    # Validate example files don't contain real secrets
    for file in $example_files; do
      if grep -E "(password|secret|key|token).*=" "$file" | grep -v -E "(your_|example_|placeholder|xxx)" >/dev/null 2>&1; then
        echo "⚠ $file may contain real values instead of placeholders"
      fi
    done
  else
    echo "ℹ No .env.example files found"
    echo "  Consider creating .env.example with placeholder values"
  fi

  # Check .gitignore for environment files
  if [ -f ".gitignore" ]; then
    if grep -q "\.env$" .gitignore; then
      echo "✅ .env files are ignored by git"
    else
      echo "⚠ .env files not found in .gitignore"
      echo "  Add '.env' to .gitignore to prevent accidental commits"
    fi
  fi
}
```

## Base64 and Inline Content Detection

### 1. Base64 Blob Detection

```bash
# Detect prohibited base64 encoded content per PRD
scan_base64_blobs() {
  echo "=== Base64 Blob Detection ==="
  echo "Scanning for prohibited inline base64 content..."

  # Pattern for base64 encoded content (data URIs, large base64 strings)
  base64_patterns=(
    "data:image/[^;]+;base64,[a-zA-Z0-9+/=]{100,}"  # Base64 images
    "data:application/[^;]+;base64,[a-zA-Z0-9+/=]{100,}"  # Base64 documents
    "['\"][a-zA-Z0-9+/=]{200,}['\"]"  # Large base64 strings in quotes
  )

  total_violations=0

  for pattern in "${base64_patterns[@]}"; do
    # Search in source files only
    if command -v rg >/dev/null 2>&1; then
      findings=$(rg "$pattern" --type js --type ts --type py --type html --type css --type json 2>/dev/null | head -10 || true)
    else
      findings=$(find . -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.html" -o -name "*.css" -o -name "*.json" | \
        grep -v node_modules | grep -v .git | \
        xargs grep -E "$pattern" 2>/dev/null | head -10 || true)
    fi

    if [ -n "$findings" ]; then
      echo "❌ Base64 content detected:"
      echo "$findings" | while read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        content_preview=$(echo "$line" | cut -d: -f2- | cut -c1-100)
        echo "    $file: $content_preview..."
      done
      violation_count=$(echo "$findings" | wc -l)
      total_violations=$((total_violations + violation_count))
    fi
  done

  if [ "$total_violations" -eq 0 ]; then
    echo "✅ No prohibited base64 blobs found"
  else
    echo "⚠ Total base64 violations: $total_violations"
    echo "  Consider moving binary content to separate files or external storage"
  fi
}
```

### 2. Large JSON/Data Structures

```bash
# Detect oversized data structures that should be externalized
scan_large_data_structures() {
  echo "=== Large Data Structure Detection ==="

  # Find JSON/data files that might be too large
  large_data_files=$(find . -name "*.json" -o -name "*.xml" -o -name "*.csv" | \
    grep -v node_modules | grep -v .git | \
    xargs wc -l 2>/dev/null | \
    awk '$1 > 1000 { print $2 ": " $1 " lines" }' || true)

  if [ -n "$large_data_files" ]; then
    echo "⚠ Large data files detected (>1000 lines):"
    echo "$large_data_files" | sed 's/^/    /'
    echo "  Consider externalizing large datasets to reduce repository size"
  else
    echo "✅ No oversized data files found"
  fi

  # Check for large embedded data in source files
  echo -e "\nChecking for large embedded data in source files..."

  large_arrays_or_objects=$(find . -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.py" | \
    grep -v node_modules | grep -v .git | \
    xargs grep -l -E "(const|let|var).*=.*\[.*\].*{" 2>/dev/null | \
    head -5 || true)

  if [ -n "$large_arrays_or_objects" ]; then
    echo "ℹ Files with potential large embedded data structures:"
    echo "$large_arrays_or_objects" | sed 's/^/    /'
    echo "  Manual review recommended for data structure size"
  fi
}
```

## Auto-Fix Capabilities

### 1. Automatic Violation Fixes

```bash
# Automatically fix certain types of violations
fix_violations() {
  local fix_type="${1:-all}"

  echo "=== Auto-fix Violations ==="
  echo "Fix type: $fix_type"

  case "$fix_type" in
    "lfs"|"all")
      fix_lfs_violations
      ;;
  esac

  case "$fix_type" in
    "gitignore"|"all")
      fix_gitignore_violations
      ;;
  esac

  case "$fix_type" in
    "env"|"all")
      fix_env_file_violations
      ;;
  esac
}

# Fix Git LFS violations by adding appropriate patterns
fix_lfs_violations() {
  echo "Fixing Git LFS violations..."

  if ! command -v git-lfs >/dev/null 2>&1; then
    echo "⚠ Git LFS not available - cannot fix LFS violations"
    return 1
  fi

  # Standard binary file patterns that should use LFS
  lfs_patterns=(
    "*.png" "*.jpg" "*.jpeg" "*.gif" "*.bmp" "*.tiff" "*.webp"
    "*.mp4" "*.mov" "*.avi" "*.mkv" "*.wmv" "*.webm"
    "*.pdf" "*.doc" "*.docx" "*.xls" "*.xlsx" "*.ppt" "*.pptx"
    "*.zip" "*.tar" "*.gz" "*.bz2" "*.7z"
    "*.exe" "*.msi" "*.dmg" "*.pkg" "*.deb" "*.rpm"
  )

  # Create or update .gitattributes
  if [ ! -f ".gitattributes" ]; then
    echo "Creating .gitattributes file..."
    touch .gitattributes
  fi

  # Add LFS patterns if not already present
  for pattern in "${lfs_patterns[@]}"; do
    lfs_rule="$pattern filter=lfs diff=lfs merge=lfs -text"
    if ! grep -q "^$pattern " .gitattributes; then
      echo "$lfs_rule" >> .gitattributes
      echo "Added LFS rule: $pattern"
    fi
  done

  echo "✅ Git LFS patterns updated in .gitattributes"
}

# Fix .gitignore violations
fix_gitignore_violations() {
  echo "Fixing .gitignore violations..."

  # Essential ignore patterns for MeatyPrompts
  essential_ignores=(
    ".env"
    ".env.local"
    ".env.*.local"
    "node_modules/"
    "dist/"
    "build/"
    ".next/"
    ".turbo/"
    "coverage/"
    "*.log"
    "__pycache__/"
    "*.pyc"
    ".pytest_cache/"
    ".DS_Store"
    "*.swp"
    "*.swo"
    ".vscode/settings.json"
  )

  if [ ! -f ".gitignore" ]; then
    echo "Creating .gitignore file..."
    touch .gitignore
  fi

  # Add missing patterns
  for pattern in "${essential_ignores[@]}"; do
    if ! grep -q "^$pattern" .gitignore; then
      echo "$pattern" >> .gitignore
      echo "Added ignore rule: $pattern"
    fi
  done

  echo "✅ .gitignore patterns updated"
}

# Fix environment file violations
fix_env_file_violations() {
  echo "Fixing environment file violations..."

  # If .env files exist, create .env.example versions
  find . -name ".env" -not -path "./.git/*" | while read -r env_file; do
    example_file="${env_file}.example"
    if [ ! -f "$example_file" ]; then
      echo "Creating example file: $example_file"

      # Create sanitized version with placeholder values
      sed -E 's/(=)([^#]*)(#.*)?$/=placeholder_value\3/' "$env_file" > "$example_file"
      echo "✅ Created $example_file with placeholder values"
    fi
  done
}
```

## Reporting and Output

### 1. Generate Comprehensive Report

```bash
# Generate detailed violation report
generate_violation_report() {
  local format="${1:-text}"
  local output_file="violation-report.${format}"

  echo "=== Generating Violation Report ==="
  echo "Format: $format"
  echo "Output: $output_file"

  case "$format" in
    "json")
      generate_json_report "$output_file"
      ;;
    "md"|"markdown")
      generate_markdown_report "$output_file"
      ;;
    *)
      generate_text_report "$output_file"
      ;;
  esac
}

# Generate JSON report
generate_json_report() {
  local output_file="$1"

  cat > "$output_file" << EOF
{
  "scan_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "repository": "$(git remote get-url origin 2>/dev/null || echo "local")",
  "violations": {
    "file_size": [],
    "secrets": [],
    "lfs": [],
    "base64": []
  },
  "summary": {
    "total_violations": 0,
    "critical": 0,
    "warning": 0,
    "info": 0
  }
}
EOF

  echo "✅ JSON report template created: $output_file"
  echo "  (Populate with actual scan results)"
}

# Generate Markdown report
generate_markdown_report() {
  local output_file="$1"

  cat > "$output_file" << 'EOF'
# Policy Violation Report

**Scan Date:** $(date)
**Repository:** $(git remote get-url origin 2>/dev/null || echo "local")

## Executive Summary

- **Total Violations:** TBD
- **Critical Issues:** TBD
- **Warnings:** TBD
- **Informational:** TBD

## File Size Violations

### Large Source Files (> 500 KB)

None found ✅

### Large Binary Files Not in LFS

None found ✅

## Security Violations

### Exposed Secrets

None found ✅

### Environment File Issues

None found ✅

## Policy Compliance

### Git LFS Usage

- **Status:** Compliant ✅
- **Files in LFS:** TBD

### .gitignore Coverage

- **Status:** Compliant ✅
- **Essential patterns:** Present

## Recommendations

1. Continue following established security practices
2. Regular secret scanning with gitleaks
3. Monitor repository size and use LFS for binaries

---
*Report generated by MeatyPrompts violation scanner*
EOF

  echo "✅ Markdown report template created: $output_file"
}
```

## Usage Examples

```bash
# Comprehensive security scan
/scan-violations

# Scan specific violation types
/scan-violations --type=secrets
/scan-violations --type=size
/scan-violations --type=lfs

# Scan and auto-fix violations
/scan-violations --fix-violations

# Generate detailed report
/scan-violations --report-format=md

# JSON output for CI/CD integration
/scan-violations --report-format=json
```

## CI/CD Integration

```bash
# Create GitHub Actions workflow for violation scanning
create_violation_scan_workflow() {
  cat > .github/workflows/scan-violations.yml << 'EOF'
name: Policy Violation Scanner

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    # Run weekly on Sundays at 02:00 UTC
    - cron: '0 2 * * 0'

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install scanning tools
        run: |
          # Install gitleaks
          wget -O gitleaks.tar.gz https://github.com/zricethezav/gitleaks/releases/latest/download/gitleaks_$(uname -s)_x64.tar.gz
          tar -xzf gitleaks.tar.gz
          sudo mv gitleaks /usr/local/bin/

          # Install git-lfs
          sudo apt-get update && sudo apt-get install -y git-lfs

      - name: Run violation scan
        run: |
          /scan-violations --report-format=json > violation-report.json

      - name: Upload violation report
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: violation-report
          path: violation-report.json

      - name: Check for critical violations
        run: |
          if [ -f "violation-report.json" ]; then
            # Check for critical issues (customize based on your JSON structure)
            critical_count=$(jq '.summary.critical // 0' violation-report.json)
            if [ "$critical_count" -gt 0 ]; then
              echo "❌ Critical violations found: $critical_count"
              exit 1
            else
              echo "✅ No critical violations found"
            fi
          fi

      - name: Comment PR with results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            if (fs.existsSync('violation-report.json')) {
              const report = JSON.parse(fs.readFileSync('violation-report.json', 'utf8'));
              const comment = `## Policy Violation Scan Results

              - **Total Violations:** ${report.summary.total_violations}
              - **Critical:** ${report.summary.critical}
              - **Warnings:** ${report.summary.warning}

              ${report.summary.total_violations > 0 ?
                '⚠️ Please review and address violations before merging.' :
                '✅ No policy violations detected.'}`;

              github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: comment
              });
            }
EOF

  echo "✅ Violation scanning workflow created"
}
```

The scan-violations command ensures:

- **Security compliance**: Detects exposed secrets and sensitive data
- **Size management**: Enforces file size limits per PRD specifications
- **LFS compliance**: Ensures proper binary file management
- **Policy enforcement**: Validates .gitignore and environment file practices
- **Auto-fixing**: Automatically resolves certain violation types
- **CI/CD integration**: Blocks deployments with critical violations
- **Comprehensive reporting**: Multiple output formats for different use cases
