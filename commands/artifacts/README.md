# Artifact Management System

The MeatyPrompts artifact management system provides comprehensive automation for maintaining project documentation, AI assets, API contracts, and compliance validation. This system consists of 15 specialized commands and 7 shared utility scripts that work together as an integrated ecosystem.

## Overview

The artifact system automates the maintenance of:
- **AI Assets**: Repository maps, symbol graphs, hints, and chunking configurations
- **Documentation**: READMEs, API docs, Architecture Decision Records (ADRs)
- **Contracts**: OpenAPI/AsyncAPI specifications, schemas, and version management
- **Compliance**: Architecture validation, code ownership, security scanning

### Integration with MeatyPrompts

The system integrates seamlessly with the MP development workflow:
- **Post-implementation**: Automatic artifact updates after code changes
- **Pre-PR validation**: Comprehensive checks before pull request creation
- **CI/CD integration**: GitHub Actions workflows for continuous validation
- **Git-aware**: Change detection to target updates efficiently

## Commands Reference

### 🤖 AI Artifact Commands

| Command | Status | Lines | Purpose |
|---------|--------|-------|---------|
| **update-repo-map** | Pending | 177 | Regenerates repository structure map with packages and dependencies |
| **update-symbols-graph** | Pending | 222 | Generates code symbols with ≤280 char summaries |
| **validate-chunking** | Pending | 269 | Validates and tunes chunking configuration |
| **update-ai-hints** | Pending | 316 | Updates AI guidance with latest patterns |
| **refresh-ai-artifacts** | Pending | 362 | Batch updates all AI artifacts |

#### update-repo-map
- **Arguments**: `[--format=json|yaml] [--include-deps] [--dry-run]`
- **Output**: `ai/repo.map.json` - Structured repository overview
- **When to use**: After adding/removing packages or major structure changes
- **Dependencies**: file-utils.sh, json-utils.sh

#### update-symbols-graph
- **Arguments**: `[--max-summary=280] [--include-private] [--language=all|ts|py]`
- **Output**: `ai/symbols.graph.json` - Code symbol definitions and relationships
- **When to use**: After adding new classes, functions, or significant refactoring
- **Dependencies**: file-utils.sh, json-utils.sh

#### validate-chunking
- **Arguments**: `[--chunk-size=8192] [--overlap=200] [--validate-embeddings]`
- **Output**: `ai/chunking.config.json` validation report
- **When to use**: When optimizing AI context windows or token usage
- **Dependencies**: validation-utils.sh, json-utils.sh

#### update-ai-hints
- **Arguments**: `[--patterns-only] [--include-examples] [--format=markdown]`
- **Output**: `ai/hints.md` - Updated AI guidance and patterns
- **When to use**: After establishing new architectural patterns or conventions
- **Dependencies**: git-utils.sh, file-utils.sh

#### refresh-ai-artifacts
- **Arguments**: `[--force-all] [--skip-validation] [--parallel]`
- **Output**: Updates all AI artifacts in batch
- **When to use**: Major releases, architecture changes, or periodic maintenance
- **Dependencies**: All AI command utilities

### 📚 Documentation Commands

| Command | Status | Lines | Purpose |
|---------|--------|-------|---------|
| **update-readmes** | Pending | 493 | Generates ≤200 line directory READMEs with owners/commands |
| **generate-api-docs** | Pending | 597 | Creates API reference from OpenAPI specs (Diátaxis structure) |
| **create-adr** | Pending | 655 | Creates Architecture Decision Records with MP patterns |

#### update-readmes
- **Arguments**: `[--max-lines=200] [--include-owners] [--skip-generated]`
- **Output**: README.md files in directories needing documentation
- **When to use**: After adding new directories or changing project structure
- **Dependencies**: file-utils.sh, validation-utils.sh

#### generate-api-docs
- **Arguments**: `[--spec-path=api/openapi.json] [--format=diátaxis] [--include-examples]`
- **Output**: `docs/api/` directory with comprehensive API documentation
- **When to use**: After API changes, new endpoints, or schema updates
- **Dependencies**: json-utils.sh, file-utils.sh, contract-utils.sh

#### create-adr
- **Arguments**: `[--template=mp-standard] [--status=proposed] [--supersedes=ADR-###]`
- **Output**: `docs/architecture/ADRs/ADR-###-title.md`
- **When to use**: When documenting architectural decisions or design choices
- **Dependencies**: file-utils.sh, validation-utils.sh

### 📋 Contract & Schema Commands

| Command | Status | Lines | Purpose |
|---------|--------|-------|---------|
| **validate-contracts** | Pending | 683 | Validates OpenAPI/AsyncAPI specs and JSON schemas |
| **freeze-api-version** | Pending | 694 | Versions and freezes API contracts following semver |

#### validate-contracts
- **Arguments**: `[--spec-type=openapi|asyncapi|all] [--strict-mode] [--fix-errors]`
- **Output**: Validation report with errors/warnings
- **When to use**: Before releases, after API changes, or in CI/CD pipelines
- **Dependencies**: json-utils.sh, validation-utils.sh, contract-utils.sh

#### freeze-api-version
- **Arguments**: `[--version=1.2.3] [--breaking-changes] [--generate-examples]`
- **Output**: Versioned contract files in `contracts/versions/`
- **When to use**: Before releasing API changes or creating stable contract versions
- **Dependencies**: git-utils.sh, json-utils.sh, contract-utils.sh

### ✅ Compliance Commands

| Command | Status | Lines | Purpose |
|---------|--------|-------|---------|
| **update-codeowners** | Pending | 768 | Ensures 100% directory ownership coverage |
| **scan-violations** | Pending | 838 | Detects file size, secrets, LFS, and policy violations |
| **check-architecture** | Pending | 1059 | Validates MP layered architecture compliance |

#### update-codeowners
- **Arguments**: `[--coverage-required=100%] [--default-owner=@team] [--validate-teams]`
- **Output**: Updated `.github/CODEOWNERS` file
- **When to use**: After team changes, new directories, or ownership restructuring
- **Dependencies**: file-utils.sh, validation-utils.sh

#### scan-violations
- **Arguments**: `[--max-file-size=100MB] [--scan-secrets] [--check-lfs] [--policy-file=.policy.yaml]`
- **Output**: Comprehensive violation report with remediation suggestions
- **When to use**: Before commits, in CI/CD, or periodic security audits
- **Dependencies**: file-utils.sh, validation-utils.sh, git-utils.sh

#### check-architecture
- **Arguments**: `[--component=backend|frontend|all] [--strict-mode] [--fix-suggestions]`
- **Output**: Architecture compliance report with violation details
- **When to use**: After refactoring, new features, or architectural reviews
- **Dependencies**: file-utils.sh, validation-utils.sh, architecture-utils.sh

### 🔄 Orchestration Commands

| Command | Status | Lines | Purpose |
|---------|--------|-------|---------|
| **post-implementation-updates** | ✅ Updated | 933 | Orchestrates artifact updates after code changes |
| **pre-pr-validation** | ✅ Updated | 1198 | Comprehensive validation before PR creation |

#### post-implementation-updates
- **Arguments**: `[--scope=major|minor|patch] [--skip-validation] [--dry-run] [--force-refresh]`
- **Output**: Updated artifacts based on change scope analysis
- **When to use**: After completing feature implementation or significant changes
- **Dependencies**: git-utils.sh, report-utils.sh, validation-utils.sh, backup-utils.sh

#### pre-pr-validation
- **Arguments**: `[--strict-checks] [--skip-tests] [--fix-auto-fixable] [--report-format=text|json]`
- **Output**: Comprehensive validation report with pass/fail status
- **When to use**: Before creating pull requests or in PR CI checks
- **Dependencies**: git-utils.sh, report-utils.sh, validation-utils.sh, file-utils.sh

## Shared Utilities Reference

### Core Utility Scripts

| Script | Functions | Purpose |
|--------|-----------|---------|
| **git-utils.sh** | 15+ | Git operations, branch management, change detection |
| **report-utils.sh** | 20+ | Structured reporting with multiple output formats |
| **validation-utils.sh** | 25+ | Schema validation, project structure validation |
| **file-utils.sh** | 20+ | File discovery, filtering, size analysis |
| **json-utils.sh** | 15+ | JSON validation, formatting, manipulation |
| **backup-utils.sh** | 25+ | Backup/restore operations with manifests |
| **ci-utils.sh** | 30+ | CI/CD workflow generation (GitHub Actions, Docker) |

### Key Functions by Category

#### Git Operations (git-utils.sh)
```bash
# Change detection and analysis
get_changed_files()           # Get files changed since branch point
get_git_status_report()       # Comprehensive status with formatting
detect_change_scope()         # Classify changes as major/minor/patch
get_recent_commits()          # Get commit history with formatting

# Branch management
get_main_branch()            # Detect main/master branch name
branch_exists()              # Check if branch exists
create_backup_branch()       # Create backup before operations
ensure_clean_state()         # Verify working directory is clean
```

#### Reporting (report-utils.sh)
```bash
# Report initialization and management
init_report()                # Initialize structured report
add_report_section()         # Add section with status (info/warning/error)
add_success() / add_error()  # Add status messages
generate_report()            # Output in multiple formats (text/json/html)

# Progress and formatting
create_table()               # Create formatted tables
append_progress()            # Update progress indicators
```

#### Validation (validation-utils.sh)
```bash
# Project validation
validate_required_files()    # Check for essential project files
validate_package_json()      # Validate package.json structure
validate_pyproject_toml()    # Validate Python project files
check_dependencies()         # Verify dependency consistency

# Structure validation
validate_directory_structure() # Check expected directory layout
validate_file_permissions()   # Ensure correct file permissions
```

## Usage Examples

### Single Command Usage
```bash
# Update repository structure map
/check-architecture --component=backend --fix-suggestions

# Generate API documentation from OpenAPI specs
/generate-api-docs --spec-path=services/api/openapi.json --include-examples

# Validate all contracts before release
/validate-contracts --strict-mode --fix-errors
```

### Orchestrated Workflows
```bash
# Complete post-implementation workflow
/post-implementation-updates --scope=minor --dry-run
# Review changes, then run without --dry-run

# Pre-PR validation with full checks
/pre-pr-validation --strict-checks --report-format=json > validation-report.json
```

### CI/CD Integration
```yaml
# GitHub Actions workflow
- name: Validate Architecture
  run: /check-architecture --component=all

- name: Update Artifacts
  run: /post-implementation-updates --scope=patch
  if: github.event_name == 'push'
```

## Migration Status & Roadmap

### ✅ Completed (Using Shared Utils)
- **post-implementation-updates** - Uses git-utils, report-utils, validation-utils, backup-utils
- **pre-pr-validation** - Uses git-utils, report-utils, validation-utils, file-utils

### 🔄 Optimization Needed
The updated commands still contain inline functions that duplicate utility functionality:
- Remove inline `detect_change_scope()` - use git-utils functions
- Extract artifact update orchestration to `artifact-utils.sh`
- Remove duplicate validation functions

### 📋 Migration Priorities

**Phase 1 (High Impact)**:
- check-architecture.md (1059→300 lines) - Create architecture-utils.sh
- scan-violations.md (838→250 lines) - Use existing utilities + file-utils
- update-codeowners.md (768→200 lines) - Use file-utils + validation-utils

**Phase 2 (Medium Impact)**:
- freeze-api-version.md (694→250 lines) - Create contract-utils.sh
- validate-contracts.md (683→250 lines) - Use contract-utils.sh
- create-adr.md (655→200 lines) - Use file-utils + validation-utils

**Phase 3 (Polish)**:
- Remaining 7 commands (already compact, 177-493 lines)

### New Utilities Planned
1. **artifact-utils.sh** - AI artifact management functions
2. **architecture-utils.sh** - Layer validation, compliance checking
3. **contract-utils.sh** - API contract management, schema validation

## Best Practices

### Using Shared Utilities
```bash
# Always source required utilities at the top
source .claude/scripts/git-utils.sh
source .claude/scripts/report-utils.sh
source .claude/scripts/validation-utils.sh

# Initialize reporting for consistent output
init_report "Command Name"

# Use structured sections
add_report_section "Validation" "Checking project structure..." "info"

# Generate final report
generate_report "text"
```

### Error Handling
```bash
# Commands remain self-contained with fallbacks
if ! source .claude/scripts/git-utils.sh 2>/dev/null; then
    # Fallback to inline functions for essential operations
    echo "Warning: Shared utilities not available, using fallback"
    get_changed_files() { git diff --name-only HEAD~1..HEAD; }
fi
```

### Command Independence
- Commands remain **fully functional** even without shared utilities
- Graceful degradation when scripts are unavailable
- Backward compatibility maintained
- No external dependencies required

## Quick Reference

### Command Categories
- 🤖 **AI Commands**: Repository analysis and artifact generation
- 📚 **Documentation**: READMEs, API docs, ADRs
- 📋 **Contracts**: API specifications and schema management
- ✅ **Compliance**: Architecture, ownership, security validation
- 🔄 **Orchestration**: Workflow coordination and validation

### Common Arguments
- `--dry-run` - Preview changes without execution
- `--report-format=text|json|html` - Output format selection
- `--strict-mode` - Enhanced validation with stricter rules
- `--skip-validation` - Bypass validation for faster execution
- `--force-refresh` - Ignore cache and regenerate everything

### Integration Points
- **Git hooks**: Automatic artifact updates on commits
- **CI/CD**: Validation and generation in pipelines
- **IDE**: Commands accessible through Claude Code interface
- **Manual**: Direct command execution for targeted updates

This comprehensive system ensures that MeatyPrompts maintains high-quality, synchronized artifacts across all project aspects while providing developers with powerful automation tools.
