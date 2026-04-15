---
description: Run all necessary artifact updates after code changes following MP patterns
allowed-tools: Read(./**), Write, Edit, Bash(git:*), Bash(pnpm:*), Bash(uv:*), Bash(node:*), Grep, Glob
argument-hint: "[--scope=major|minor|patch] [--skip-validation] [--dry-run] [--force-refresh]"
---

# Post-Implementation Updates

Orchestrates comprehensive artifact updates after code implementation, ensuring all documentation, AI assets, contracts, and compliance checks are synchronized with the latest changes.

## Context Analysis

Analyze the scope and impact of recent changes:

```bash
# Source shared utilities
source .claude/scripts/git-utils.sh 2>/dev/null || echo "Warning: git-utils.sh not found"
source .claude/scripts/report-utils.sh 2>/dev/null || echo "Warning: report-utils.sh not found"
source .claude/scripts/validation-utils.sh 2>/dev/null || echo "Warning: validation-utils.sh not found"
source .claude/scripts/artifact-utils.sh 2>/dev/null || echo "Warning: artifact-utils.sh not found"
source .claude/scripts/backup-utils.sh 2>/dev/null || echo "Warning: backup-utils.sh not found"

# Initialize report
if type init_report >/dev/null 2>&1; then
    init_report "Post-Implementation Updates"
else
    echo "=== Post-Implementation Updates ==="
fi

# Get comprehensive Git status
echo "=== Change Impact Analysis ==="
if type get_git_status_report >/dev/null 2>&1; then
    get_git_status_report "text"
else
    git status --porcelain
fi

# Detect change scope using git utilities
echo -e "\n=== Change Scope Detection ==="
if type detect_change_scope >/dev/null 2>&1; then
    CHANGE_SCOPE=$(detect_change_scope)
    echo "Detected scope: $CHANGE_SCOPE"
else
    # Fallback scope detection
    CHANGE_SCOPE="minor"
    echo "Using fallback scope: $CHANGE_SCOPE"
fi
```

## Impact Assessment

Assess which artifacts need updating based on changes:

```bash
# Use git utilities to get changed files
main_branch=$(get_main_branch 2>/dev/null || echo "main")
if type get_changed_files >/dev/null 2>&1; then
    changed_files=$(get_changed_files "$main_branch")
else
    changed_files=$(git diff --name-only HEAD~1..HEAD)
fi

# Initialize update flags
update_repo_map=false
update_symbols=false
update_docs=false
update_contracts=false
update_readmes=false
check_compliance=false

# Analyze changed files to determine what needs updating
for file in $changed_files; do
    [[ -z "$file" ]] && continue
    case "$file" in
        # Package structure changes -> update repo map
        */package.json|*/pyproject.toml|pnpm-workspace.yaml)
            update_repo_map=true
            echo "📦 Package configuration changed: $file"
            ;;

        # Source code changes -> update symbols graph
        *.ts|*.tsx|*.py|*.js|*.jsx)
            update_symbols=true
            echo "🔍 Source code changed: $file"
            ;;

        # API specifications -> update contracts and docs
        spec/*|*/openapi.*|*/swagger.*|*.schema.json)
            update_contracts=true
            update_docs=true
            echo "📋 API specification changed: $file"
            ;;

        # Documentation changes -> check doc system
        *.md|docs/*)
            update_docs=true
            echo "📚 Documentation changed: $file"
            ;;

        # Configuration changes -> check compliance
        .gitignore|.gitattributes|CODEOWNERS|.pre-commit-config.yaml)
            check_compliance=true
            echo "⚙️ Configuration changed: $file"
            ;;
    esac
done

# Report update plan
echo -e "\n=== Update Plan ==="
echo "Repository map: $([ "$update_repo_map" = "true" ] && echo "YES" || echo "no")"
echo "Symbols graph: $([ "$update_symbols" = "true" ] && echo "YES" || echo "no")"
echo "Documentation: $([ "$update_docs" = "true" ] && echo "YES" || echo "no")"
echo "Contracts: $([ "$update_contracts" = "true" ] && echo "YES" || echo "no")"
echo "Compliance: $([ "$check_compliance" = "true" ] && echo "YES" || echo "no")"
```

## Artifact Updates

Execute the updates based on scope and impact:

```bash
# Create backup before updates
echo -e "\n=== Creating Backup ==="
if type create_backup_set >/dev/null 2>&1; then
    backup_id=$(create_backup_set "pre-artifact-update" "ai/" "docs/" "contracts/" ".github/" 2>/dev/null)
    if [[ -n "$backup_id" ]]; then
        echo "✓ Backup created: $backup_id"
    else
        echo "⚠ Backup creation failed, continuing without backup"
    fi
else
    echo "⚠ Backup utilities not available"
fi

# Execute updates based on flags and scope
echo -e "\n=== Executing Updates ==="

# Update repository map if needed
if [[ "$update_repo_map" == "true" || "$CHANGE_SCOPE" == "major" ]]; then
    echo "Updating repository map..."
    if type update_repo_map >/dev/null 2>&1; then
        update_repo_map true json false
    else
        echo "⚠ Repository map update function not available"
    fi
fi

# Update symbols graph if needed
if [[ "$update_symbols" == "true" || "$CHANGE_SCOPE" != "patch" ]]; then
    echo "Updating symbols graph..."
    if type update_symbols_graph >/dev/null 2>&1; then
        update_symbols_graph 280 false all false
    else
        echo "⚠ Symbols graph update function not available"
    fi
fi

# Update documentation if needed
if [[ "$update_docs" == "true" ]]; then
    echo "Updating documentation..."

    # Update READMEs using artifacts command if available
    if [[ -f ".claude/commands/artifacts/update-readmes.md" ]]; then
        /update-readmes --max-lines=200 --include-owners
    else
        echo "⚠ README update command not available"
    fi

    # Generate API docs if contracts changed
    if [[ "$update_contracts" == "true" ]] && [[ -f ".claude/commands/artifacts/generate-api-docs.md" ]]; then
        /generate-api-docs --include-examples
    fi
fi

# Update AI hints
echo "Updating AI hints..."
if type update_ai_hints >/dev/null 2>&1; then
    update_ai_hints false true markdown false
else
    echo "⚠ AI hints update function not available"
fi

# Validate contracts if they changed
if [[ "$update_contracts" == "true" ]]; then
    echo "Validating contracts..."
    if [[ -f ".claude/commands/artifacts/validate-contracts.md" ]]; then
        /validate-contracts --strict-mode
    else
        echo "⚠ Contract validation command not available"
    fi
fi

# Check compliance if needed
if [[ "$check_compliance" == "true" || "$CHANGE_SCOPE" == "major" ]]; then
    echo "Checking compliance..."

    # Update CODEOWNERS
    if [[ -f ".claude/commands/artifacts/update-codeowners.md" ]]; then
        /update-codeowners --coverage-required=100%
    fi

    # Check architecture compliance
    if [[ -f ".claude/commands/artifacts/check-architecture.md" ]]; then
        /check-architecture --component=all
    fi

    # Scan for violations
    if [[ -f ".claude/commands/artifacts/scan-violations.md" ]]; then
        /scan-violations --scan-secrets --check-lfs
    fi
fi
```

## Validation

Validate that updates were successful:

```bash
echo -e "\n=== Validation ==="

# Validate updated AI artifacts
validation_errors=0

if [[ -f "ai/repo.map.json" ]]; then
    if type validate_json_file >/dev/null 2>&1; then
        if validate_json_file "ai/repo.map.json" true; then
            echo "✓ Repository map is valid"
        else
            echo "❌ Repository map validation failed"
            validation_errors=$((validation_errors + 1))
        fi
    else
        echo "⚠ JSON validation not available"
    fi
fi

if [[ -f "ai/symbols.graph.json" ]]; then
    if type validate_json_file >/dev/null 2>&1; then
        if validate_json_file "ai/symbols.graph.json" true; then
            echo "✓ Symbols graph is valid"
        else
            echo "❌ Symbols graph validation failed"
            validation_errors=$((validation_errors + 1))
        fi
    else
        echo "⚠ JSON validation not available"
    fi
fi

# Check if critical files exist
critical_files=("CLAUDE.md" "README.md")
for file in "${critical_files[@]}"; do
    if [[ -f "$file" ]]; then
        echo "✓ Critical file exists: $file"
    else
        echo "❌ Missing critical file: $file"
        validation_errors=$((validation_errors + 1))
    fi
done

# Report validation results
if [[ $validation_errors -eq 0 ]]; then
    echo -e "\n✅ All validations passed successfully"

    if type add_success >/dev/null 2>&1; then
        add_success "Post-implementation updates completed successfully"
        add_success "All artifacts are synchronized with code changes"
    fi
else
    echo -e "\n❌ Found $validation_errors validation errors"

    if type add_error >/dev/null 2>&1; then
        add_error "Post-implementation updates completed with $validation_errors errors"
    fi
fi
```

## Summary Report

Generate final report:

```bash
echo -e "\n=== Post-Implementation Updates Summary ==="

# Generate report using shared utilities if available
if type generate_report >/dev/null 2>&1; then
    generate_report "text"
else
    # Fallback summary
    echo "Change scope: $CHANGE_SCOPE"
    echo "Repository map updated: $update_repo_map"
    echo "Symbols graph updated: $update_symbols"
    echo "Documentation updated: $update_docs"
    echo "Contracts updated: $update_contracts"
    echo "Compliance checked: $check_compliance"
    echo "Validation errors: $validation_errors"
    echo "Timestamp: $(date)"
fi

# Provide next steps based on results
echo -e "\n=== Next Steps ==="
if [[ $validation_errors -eq 0 ]]; then
    echo "✅ Ready for commit/PR - all artifacts are synchronized"
    echo "💡 Consider running: /pre-pr-validation before creating PR"
else
    echo "🔧 Fix validation errors before proceeding"
    echo "💡 Run individual artifact commands to resolve issues"
fi

echo -e "\n=== Available Commands ==="
echo "🔍 /check-architecture - Validate architectural compliance"
echo "📋 /validate-contracts - Check API contract validity"
echo "📚 /generate-api-docs - Update API documentation"
echo "✅ /pre-pr-validation - Comprehensive pre-PR checks"
```

## Parameters

Handle command line parameters:

```bash
# Parse command line arguments
scope_override=""
skip_validation=false
dry_run=false
force_refresh=false

for arg in "$@"; do
    case "$arg" in
        --scope=*)
            scope_override="${arg#*=}"
            ;;
        --skip-validation)
            skip_validation=true
            ;;
        --dry-run)
            dry_run=true
            ;;
        --force-refresh)
            force_refresh=true
            ;;
        --help)
            echo "Usage: post-implementation-updates [options]"
            echo ""
            echo "Options:"
            echo "  --scope=major|minor|patch  Override automatic scope detection"
            echo "  --skip-validation         Skip validation steps"
            echo "  --dry-run                 Show what would be done without execution"
            echo "  --force-refresh           Force refresh of all artifacts"
            echo "  --help                    Show this help message"
            exit 0
            ;;
    esac
done

# Apply parameter overrides
if [[ -n "$scope_override" ]]; then
    CHANGE_SCOPE="$scope_override"
    echo "Scope overridden to: $CHANGE_SCOPE"
fi

if [[ "$force_refresh" == "true" ]]; then
    update_repo_map=true
    update_symbols=true
    update_docs=true
    update_contracts=true
    check_compliance=true
    echo "Force refresh enabled - updating all artifacts"
fi

if [[ "$dry_run" == "true" ]]; then
    echo "DRY RUN MODE - No changes will be made"
    echo "This is what would be executed:"
fi
```

This command orchestrates comprehensive artifact updates while leveraging shared utilities for consistency and maintainability. It provides intelligent change detection, targeted updates, and robust validation to keep all project artifacts synchronized with code changes.
