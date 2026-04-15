---
description: Version and freeze API contracts in contracts/ directory following semver
allowed-tools: Read(./**), Write, Edit, MultiEdit, Bash(git:*), Bash(curl:*), Bash(node:*), Grep, Glob
argument-hint: "<version> [--source=spec/openapi.yml] [--breaking-changes] [--dry-run]"
---

# Freeze API Version

Creates a frozen, versioned copy of API contracts in the `contracts/` directory following semantic versioning principles, ensuring backward compatibility tracking and immutable contract history.

## Context Analysis

Analyze current API state and determine versioning strategy:

```bash
# Check current API version state
echo "=== API Version Analysis ==="

# Check existing contracts directory structure
if [ -d "contracts" ]; then
  echo "Existing contract versions:"
  find contracts -name "v*" -type d | sort

  echo -e "\nContract files by version:"
  find contracts -name "*.json" -o -name "*.yml" -o -name "*.yaml" | sort

  # Determine latest version
  latest_version=$(find contracts -name "v*" -type d | sort -V | tail -1 | xargs basename 2>/dev/null || echo "none")
  echo "Latest frozen version: $latest_version"
else
  echo "No contracts directory found - this will be the first version freeze"
  latest_version="none"
fi

# Check current API specification
echo -e "\n=== Current API Specification ==="
spec_files=(
  "spec/openapi.yml"
  "spec/openapi.yaml"
  "spec/api.yml"
  "services/api/openapi.json"
)

current_spec=""
for spec in "${spec_files[@]}"; do
  if [ -f "$spec" ]; then
    echo "Found spec: $spec"
    current_spec="$spec"

    # Extract current version from spec
    if [[ "$spec" == *.json ]]; then
      current_api_version=$(jq -r '.info.version // "unknown"' "$spec" 2>/dev/null || echo "unknown")
    else
      current_api_version=$(python3 -c "
import yaml
try:
    with open('$spec') as f:
        data = yaml.safe_load(f)
    print(data.get('info', {}).get('version', 'unknown'))
except:
    print('unknown')
" 2>/dev/null)
    fi

    echo "Current API version in spec: $current_api_version"
    break
  fi
done

if [ -z "$current_spec" ]; then
  echo "⚠ No API specification found in common locations"
  echo "  Specify source with --source=path/to/spec.yml"
fi
```

## Version Validation and Strategy

### 1. Semantic Version Validation

```bash
# Validate semantic version format
validate_semver() {
  local version="$1"

  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9-]+)?(\+[a-zA-Z0-9-]+)?$ ]]; then
    echo "✅ Valid semantic version: $version"
    return 0
  else
    echo "❌ Invalid semantic version format: $version"
    echo "   Expected format: MAJOR.MINOR.PATCH (e.g., 1.2.3)"
    echo "   With optional pre-release: 1.2.3-alpha.1"
    echo "   With optional build: 1.2.3+build.123"
    return 1
  fi
}

# Compare versions to ensure proper increment
compare_versions() {
  local current_version="$1"
  local new_version="$2"

  if [ "$current_version" = "none" ]; then
    echo "ℹ First version freeze - no comparison needed"
    return 0
  fi

  # Use sort -V for version comparison
  if echo -e "$current_version\n$new_version" | sort -V | head -1 | grep -q "^$new_version$"; then
    echo "❌ New version ($new_version) is not greater than current version ($current_version)"
    echo "   Ensure the new version follows semantic versioning increment rules"
    return 1
  else
    echo "✅ Version increment is valid: $current_version → $new_version"
    return 0
  fi
}
```

### 2. Breaking Change Detection

```bash
# Analyze potential breaking changes
detect_breaking_changes() {
  local old_spec="$1"
  local new_spec="$2"
  local new_version="$3"

  echo "=== Breaking Change Analysis ==="

  if [ ! -f "$old_spec" ]; then
    echo "ℹ No previous specification found - cannot detect breaking changes"
    return 0
  fi

  # Use openapi-diff if available for detailed comparison
  if command -v openapi-diff >/dev/null 2>&1; then
    echo "Using openapi-diff for comprehensive analysis..."

    # Generate diff report
    if openapi-diff "$old_spec" "$new_spec" --format markdown > api-diff.md 2>/dev/null; then
      echo "✅ API diff report generated: api-diff.md"

      # Check for breaking changes in the diff
      if grep -qi "breaking\|removed\|deprecated" api-diff.md; then
        echo "⚠ Potential breaking changes detected in diff report"
        echo "  Review api-diff.md for details"

        # For breaking changes, ensure MAJOR version increment
        major_version=$(echo "$new_version" | cut -d. -f1)
        old_major=$(echo "$3" | cut -d. -f1)

        if [ "$major_version" = "$old_major" ]; then
          echo "⚠ Breaking changes detected but MAJOR version not incremented"
          echo "  Consider bumping to next MAJOR version for breaking changes"
        fi
      else
        echo "✅ No obvious breaking changes detected"
      fi
    else
      echo "⚠ Failed to generate API diff - manual review recommended"
    fi
  else
    echo "ℹ Install openapi-diff for detailed breaking change detection:"
    echo "  npm install -g openapi-diff"

    # Basic heuristic checks
    echo "Performing basic breaking change heuristics..."

    # Check if any paths were removed
    if command -v jq >/dev/null 2>&1 && [[ "$new_spec" == *.json ]]; then
      old_paths=$(jq -r '.paths | keys[]' "$old_spec" 2>/dev/null | sort)
      new_paths=$(jq -r '.paths | keys[]' "$new_spec" 2>/dev/null | sort)

      removed_paths=$(comm -23 <(echo "$old_paths") <(echo "$new_paths"))
      if [ -n "$removed_paths" ]; then
        echo "⚠ Removed API paths (potential breaking change):"
        echo "$removed_paths" | sed 's/^/  - /'
      fi

      added_paths=$(comm -13 <(echo "$old_paths") <(echo "$new_paths"))
      if [ -n "$added_paths" ]; then
        echo "ℹ Added API paths:"
        echo "$added_paths" | sed 's/^/  + /'
      fi
    fi
  fi
}
```

## Contract Freezing Process

### 1. Create Versioned Directory Structure

```bash
# Create contract directory structure for the new version
create_version_directory() {
  local version="$1"
  local contracts_base_dir="contracts"

  # Create version directory (e.g., v1.2.3)
  version_dir="$contracts_base_dir/v$version"
  mkdir -p "$version_dir"

  echo "Created version directory: $version_dir"

  # Create subdirectories for different contract types
  mkdir -p "$version_dir"/{openapi,schemas,examples,documentation}

  echo "Created contract subdirectories:"
  echo "  - $version_dir/openapi (API specifications)"
  echo "  - $version_dir/schemas (JSON schemas)"
  echo "  - $version_dir/examples (Example requests/responses)"
  echo "  - $version_dir/documentation (Generated docs)"

  return 0
}
```

### 2. Freeze API Specification

```bash
# Copy and freeze the API specification
freeze_api_specification() {
  local source_spec="$1"
  local version="$2"
  local version_dir="contracts/v$version"

  echo "=== Freezing API Specification ==="
  echo "Source: $source_spec"
  echo "Target: $version_dir"

  # Determine target filename based on source
  if [[ "$source_spec" == *.json ]]; then
    target_spec="$version_dir/openapi/api.json"
  else
    target_spec="$version_dir/openapi/api.yml"
  fi

  # Copy the specification
  cp "$source_spec" "$target_spec"
  echo "✅ API specification frozen: $target_spec"

  # Update version in the frozen spec to ensure consistency
  if [[ "$target_spec" == *.json ]]; then
    # Update JSON version
    temp_file=$(mktemp)
    jq ".info.version = \"$version\"" "$target_spec" > "$temp_file" && mv "$temp_file" "$target_spec"
    echo "✅ Version updated in frozen specification"
  else
    # Update YAML version
    python3 << EOF
import yaml
import sys

try:
    with open('$target_spec', 'r') as f:
        data = yaml.safe_load(f)

    if 'info' not in data:
        data['info'] = {}
    data['info']['version'] = '$version'

    with open('$target_spec', 'w') as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)

    print("✅ Version updated in frozen specification")
except Exception as e:
    print(f"⚠ Could not update version in YAML: {e}")
    sys.exit(1)
EOF
  fi
}
```

### 3. Extract and Freeze Schemas

```bash
# Extract schemas from API spec and create separate schema files
extract_and_freeze_schemas() {
  local spec_file="$1"
  local version_dir="$2"
  local schemas_dir="$version_dir/schemas"

  echo "=== Extracting and Freezing Schemas ==="

  if [[ "$spec_file" == *.json ]] && command -v jq >/dev/null 2>&1; then
    # Extract components/schemas from OpenAPI spec
    if jq -e '.components.schemas' "$spec_file" >/dev/null 2>&1; then
      echo "Extracting schema definitions..."

      # Create individual schema files for each component
      jq -r '.components.schemas | keys[]' "$spec_file" | while read schema_name; do
        schema_file="$schemas_dir/${schema_name}.schema.json"
        echo "Creating schema file: $schema_file"

        # Extract the schema and wrap it in a proper JSON Schema
        jq ".components.schemas[\"$schema_name\"] | {
          \"\$schema\": \"https://json-schema.org/draft/2020-12/schema\",
          \"\$id\": \"https://api.meatyprompts.com/schemas/v$version/$schema_name.json\",
          \"title\": \"$schema_name\",
          \"type\": .type,
          \"properties\": .properties,
          \"required\": .required,
          \"additionalProperties\": .additionalProperties
        }" "$spec_file" > "$schema_file"
      done

      echo "✅ Schema files extracted and frozen"
    else
      echo "ℹ No schema definitions found in specification"
    fi
  else
    echo "ℹ Schema extraction requires JSON format and jq"
    echo "  Convert spec to JSON or install jq for schema extraction"
  fi
}
```

### 4. Generate Examples

```bash
# Generate example requests and responses
generate_examples() {
  local spec_file="$1"
  local version_dir="$2"
  local examples_dir="$version_dir/examples"

  echo "=== Generating Contract Examples ==="

  if [[ "$spec_file" == *.json ]] && command -v jq >/dev/null 2>&1; then
    # Extract examples from the OpenAPI specification
    echo "Extracting examples from specification..."

    # Create request/response examples for each endpoint
    jq -r '.paths | to_entries[] | .key as $path | .value | to_entries[] | select(.key | test("get|post|put|delete")) | "\($path).\(.key)"' "$spec_file" | while read endpoint; do
      path=$(echo "$endpoint" | cut -d. -f1)
      method=$(echo "$endpoint" | cut -d. -f2)
      safe_filename=$(echo "${method}_${path}" | sed 's|/|_|g' | sed 's/[{}]//g').json

      echo "Creating example for: $method $path"

      # Create example structure
      cat > "$examples_dir/$safe_filename" << EOF
{
  "endpoint": "$method $path",
  "request": {
    "headers": {
      "Authorization": "Bearer <token>",
      "Content-Type": "application/json"
    },
    "body": null
  },
  "response": {
    "status": 200,
    "headers": {
      "Content-Type": "application/json"
    },
    "body": {}
  }
}
EOF
    done

    echo "✅ Example files generated"
  else
    echo "ℹ Example generation requires JSON format specification and jq"
  fi
}
```

### 5. Create Version Metadata

```bash
# Create metadata file for the frozen version
create_version_metadata() {
  local version="$1"
  local version_dir="$2"
  local source_spec="$3"
  local breaking_changes="${4:-false}"

  local metadata_file="$version_dir/VERSION.md"
  local author=$(git config user.name || echo "Unknown")
  local date=$(date +"%Y-%m-%d %H:%M:%S")
  local commit_hash=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

  cat > "$metadata_file" << EOF
# API Contract Version $version

## Version Information

- **Version**: $version
- **Frozen Date**: $date
- **Author**: $author
- **Git Commit**: $commit_hash
- **Source Specification**: $source_spec

## Version Type

- **Breaking Changes**: $([ "$breaking_changes" = "true" ] && echo "Yes" || echo "No")
- **Semantic Version Type**: $(
    if [ "$breaking_changes" = "true" ]; then
      echo "Major (breaking changes)"
    else
      echo "Minor/Patch (backward compatible)"
    fi
  )

## Contents

This version includes:

- \`openapi/api.yml\` - Complete OpenAPI 3.0 specification
- \`schemas/\` - Individual JSON Schema files for each model
- \`examples/\` - Example requests and responses
- \`documentation/\` - Generated documentation (if available)

## Compatibility

$(if [ "$breaking_changes" = "true" ]; then
cat << 'BREAKING_EOF'
⚠ **BREAKING CHANGES**: This version contains breaking changes from the previous version.
Clients using previous versions may need updates to work with this API version.

### Migration Guide

1. Review the API diff report (api-diff.md) for detailed changes
2. Update client code to handle modified endpoints
3. Test thoroughly before deploying to production
4. Consider maintaining backward compatibility where possible

BREAKING_EOF
else
cat << 'COMPATIBLE_EOF'
✅ **BACKWARD COMPATIBLE**: This version maintains backward compatibility with previous versions.
Existing clients should continue to work without modifications.

COMPATIBLE_EOF
fi)

## Usage

### Client Generation

Generate client libraries using the frozen specification:

\`\`\`bash
# Generate TypeScript client
npx @openapitools/openapi-generator-cli generate \\
  -i contracts/v$version/openapi/api.yml \\
  -g typescript-fetch \\
  -o clients/typescript-v$version

# Generate Python client
npx @openapitools/openapi-generator-cli generate \\
  -i contracts/v$version/openapi/api.yml \\
  -g python \\
  -o clients/python-v$version
\`\`\`

### API Documentation

View the frozen API documentation:
- Interactive Docs: Use ReDoc or Swagger UI with the frozen specification
- Schema Reference: Individual schema files in \`schemas/\` directory
- Examples: Request/response examples in \`examples/\` directory

## Changelog

$(if [ -f "CHANGELOG.md" ]; then
    echo "See CHANGELOG.md for detailed changes in this version."
else
    echo "Detailed changelog not available - consider maintaining CHANGELOG.md"
fi)

## Support

This API version is:
- **Supported**: $(date -d "+2 years" +"%Y-%m-%d" 2>/dev/null || echo "TBD")
- **Deprecated**: TBD
- **End of Life**: TBD

---
*This is a frozen contract version and should not be modified.*
*For changes, create a new version following semantic versioning principles.*
EOF

  echo "✅ Version metadata created: $metadata_file"
}
```

## Version Management

### 1. List Available Versions

```bash
# List all frozen contract versions
list_contract_versions() {
  echo "=== Available Contract Versions ==="

  if [ ! -d "contracts" ]; then
    echo "No contract versions found"
    return 0
  fi

  # Find all version directories
  find contracts -name "v*" -type d | sort -V | while read version_dir; do
    version=$(basename "$version_dir")

    # Read metadata if available
    if [ -f "$version_dir/VERSION.md" ]; then
      frozen_date=$(grep "Frozen Date:" "$version_dir/VERSION.md" | sed 's/.*: //')
      breaking=$(grep "Breaking Changes:" "$version_dir/VERSION.md" | sed 's/.*: //')

      echo "📦 $version (frozen: $frozen_date, breaking: $breaking)"
    else
      echo "📦 $version (metadata not available)"
    fi

    # List contents
    echo "   Contents:"
    find "$version_dir" -name "*.yml" -o -name "*.yaml" -o -name "*.json" | head -3 | sed 's/^/     - /'
    if [ $(find "$version_dir" -name "*.yml" -o -name "*.yaml" -o -name "*.json" | wc -l) -gt 3 ]; then
      echo "     - ... and more"
    fi
    echo
  done
}
```

### 2. Compare Versions

```bash
# Compare two contract versions
compare_contract_versions() {
  local version1="$1"
  local version2="$2"

  local spec1="contracts/v$version1/openapi/api.yml"
  local spec2="contracts/v$version2/openapi/api.yml"

  # Try .json if .yml doesn't exist
  [ ! -f "$spec1" ] && spec1="contracts/v$version1/openapi/api.json"
  [ ! -f "$spec2" ] && spec2="contracts/v$version2/openapi/api.json"

  echo "=== Comparing Contract Versions ==="
  echo "Version 1: $version1 ($spec1)"
  echo "Version 2: $version2 ($spec2)"

  if [ ! -f "$spec1" ] || [ ! -f "$spec2" ]; then
    echo "❌ One or both specification files not found"
    return 1
  fi

  # Use openapi-diff if available
  if command -v openapi-diff >/dev/null 2>&1; then
    echo "Generating detailed comparison..."
    openapi-diff "$spec1" "$spec2" --format markdown > "version-diff-$version1-to-$version2.md"
    echo "✅ Comparison report: version-diff-$version1-to-$version2.md"
  else
    echo "ℹ Install openapi-diff for detailed comparison:"
    echo "  npm install -g openapi-diff"

    # Basic comparison
    echo "Basic file comparison:"
    if command -v diff >/dev/null 2>&1; then
      diff -u "$spec1" "$spec2" | head -20
      echo "... (install openapi-diff for detailed API comparison)"
    fi
  fi
}
```

## Usage Examples

```bash
# Freeze current API as version 1.0.0
/freeze-api-version 1.0.0

# Freeze with custom source specification
/freeze-api-version 1.1.0 --source=services/api/openapi.json

# Freeze with breaking changes flag
/freeze-api-version 2.0.0 --breaking-changes

# Dry run to see what would be frozen
/freeze-api-version 1.0.1 --dry-run

# List all frozen versions
/freeze-api-version --list

# Compare two versions
/freeze-api-version --compare 1.0.0 1.1.0
```

## Integration with Development Workflow

### 1. Release Automation

```bash
# Integrate with release process
integrate_with_release() {
  cat > .github/workflows/freeze-api-contracts.yml << 'EOF'
name: Freeze API Contracts

on:
  release:
    types: [published]

jobs:
  freeze-contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install tools
        run: npm install -g openapi-diff

      - name: Freeze API version
        run: |
          version=${GITHUB_REF#refs/tags/v}
          /freeze-api-version "$version" --source=spec/openapi.yml

      - name: Commit frozen contracts
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add contracts/
          git commit -m "chore: freeze API contracts for $version" || exit 0
          git push
EOF

  echo "✅ Release automation workflow created"
}
```

### 2. Client Generation

```bash
# Generate client libraries from frozen contracts
generate_clients_for_version() {
  local version="$1"
  local spec_file="contracts/v$version/openapi/api.yml"

  [ ! -f "$spec_file" ] && spec_file="contracts/v$version/openapi/api.json"

  if [ ! -f "$spec_file" ]; then
    echo "❌ Specification not found for version $version"
    return 1
  fi

  echo "=== Generating Client Libraries for v$version ==="

  # Create clients directory
  mkdir -p "clients/v$version"

  # Generate TypeScript client
  if command -v openapi-generator >/dev/null 2>&1; then
    echo "Generating TypeScript client..."
    openapi-generator generate \
      -i "$spec_file" \
      -g typescript-fetch \
      -o "clients/v$version/typescript" \
      --additional-properties=typescriptThreePlus=true,supportsES6=true
    echo "✅ TypeScript client generated"

    echo "Generating Python client..."
    openapi-generator generate \
      -i "$spec_file" \
      -g python \
      -o "clients/v$version/python" \
      --additional-properties=packageName=meatyprompts_client
    echo "✅ Python client generated"
  else
    echo "ℹ Install OpenAPI Generator for client generation:"
    echo "  npm install -g @openapitools/openapi-generator-cli"
  fi
}
```

The freeze-api-version command ensures:

- **Immutable contracts**: Frozen versions cannot be accidentally modified
- **Semantic versioning**: Proper version increment validation
- **Breaking change tracking**: Detects and documents API compatibility
- **Complete artifacts**: Specifications, schemas, examples, and documentation
- **Client generation**: Ready for automated client library generation
- **Version management**: Easy comparison and listing of contract versions
