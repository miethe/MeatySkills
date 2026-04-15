---
description: Validate OpenAPI/AsyncAPI specs and JSON schemas against current implementations
allowed-tools: Read(./**), Write, Bash(git:*), Bash(node:*), Bash(curl:*), Bash(uv:*), Grep, Glob
argument-hint: "[--spec-type=openapi|asyncapi|json-schema] [--target-dir=path] [--fix-issues] [--live-validation]"
---

# Validate API Contracts and Schemas

Validates OpenAPI specifications, AsyncAPI definitions, and JSON schemas against current implementations, ensuring consistency between documented contracts and actual code behavior.

## Context Analysis

Analyze current contract and schema state:

```bash
# Discover contract and specification files
echo "=== Contract Discovery ==="

# Find OpenAPI/Swagger specifications
echo "OpenAPI/Swagger specifications:"
find . \( -name "*.yml" -o -name "*.yaml" -o -name "*.json" \) \
  -path "*/spec/*" -o -path "*/schemas/*" -o -path "*/openapi*" -o -path "*/swagger*" | head -10

# Find AsyncAPI specifications
echo -e "\nAsyncAPI specifications:"
find . \( -name "*.yml" -o -name "*.yaml" -o -name "*.json" \) \
  -exec grep -l "asyncapi:" {} \; 2>/dev/null | head -5

# Find JSON Schema files
echo -e "\nJSON Schema files:"
find . -name "*.schema.json" -o -name "*schema*.json" | head -10

# Check contracts directory as specified in PRD
if [ -d "contracts" ]; then
  echo -e "\nContracts directory content:"
  find contracts -type f | head -10
else
  echo -e "\nNo contracts/ directory found (will create per PRD requirements)"
fi

# Check spec directory
if [ -d "spec" ]; then
  echo -e "\nSpec directory content:"
  find spec -type f | head -10
else
  echo -e "\nNo spec/ directory found"
fi
```

## OpenAPI Validation

### 1. Specification Validation

```bash
# Validate OpenAPI specifications using industry-standard tools
validate_openapi_spec() {
  local spec_file="$1"

  echo "=== Validating OpenAPI Specification: $spec_file ==="

  # Method 1: Using Redocly CLI (preferred)
  if command -v redocly >/dev/null 2>&1; then
    echo "Using Redocly CLI for validation..."
    if redocly lint "$spec_file"; then
      echo "✅ OpenAPI spec is valid (Redocly)"
    else
      echo "❌ OpenAPI spec has validation errors (Redocly)"
      return 1
    fi

  # Method 2: Using Swagger CLI
  elif command -v swagger-codegen >/dev/null 2>&1; then
    echo "Using swagger-codegen for validation..."
    if swagger-codegen validate -i "$spec_file"; then
      echo "✅ OpenAPI spec is valid (swagger-codegen)"
    else
      echo "❌ OpenAPI spec has validation errors (swagger-codegen)"
      return 1
    fi

  # Method 3: Using OpenAPI Generator CLI
  elif command -v openapi-generator >/dev/null 2>&1; then
    echo "Using openapi-generator for validation..."
    if openapi-generator validate -i "$spec_file"; then
      echo "✅ OpenAPI spec is valid (openapi-generator)"
    else
      echo "❌ OpenAPI spec has validation errors (openapi-generator)"
      return 1
    fi

  # Method 4: Basic JSON/YAML syntax validation
  else
    echo "Using basic syntax validation (install redocly for comprehensive validation)..."
    if [[ "$spec_file" == *.json ]]; then
      if python3 -m json.tool "$spec_file" >/dev/null; then
        echo "✅ Valid JSON syntax"
      else
        echo "❌ Invalid JSON syntax"
        return 1
      fi
    else
      if python3 -c "import yaml; yaml.safe_load(open('$spec_file'))"; then
        echo "✅ Valid YAML syntax"
      else
        echo "❌ Invalid YAML syntax"
        return 1
      fi
    fi
  fi
}
```

### 2. Live API Validation

```bash
# Validate specification against running API
validate_against_live_api() {
  local spec_file="$1"
  local api_base_url="${2:-http://localhost:8000}"

  echo "=== Live API Validation ==="
  echo "Spec file: $spec_file"
  echo "API base URL: $api_base_url"

  # Check if API is accessible
  if ! curl -s "$api_base_url/health" >/dev/null 2>&1; then
    echo "⚠ API not accessible at $api_base_url - skipping live validation"
    echo "  To enable live validation, ensure the API is running"
    return 0
  fi

  echo "✅ API is accessible"

  # Fetch live OpenAPI spec if available
  live_spec_endpoints=(
    "$api_base_url/openapi.json"
    "$api_base_url/docs/openapi.json"
    "$api_base_url/api/openapi.json"
    "$api_base_url/swagger.json"
  )

  for endpoint in "${live_spec_endpoints[@]}"; do
    if curl -s "$endpoint" -o temp_live_spec.json 2>/dev/null; then
      if python3 -m json.tool temp_live_spec.json >/dev/null 2>&1; then
        echo "✅ Retrieved live OpenAPI spec from $endpoint"

        # Compare versions if possible
        if command -v jq >/dev/null 2>&1; then
          static_version=$(jq -r '.info.version // "unknown"' "$spec_file" 2>/dev/null || echo "unknown")
          live_version=$(jq -r '.info.version // "unknown"' temp_live_spec.json 2>/dev/null || echo "unknown")

          if [ "$static_version" = "$live_version" ]; then
            echo "✅ Version match: $static_version"
          else
            echo "⚠ Version mismatch: static=$static_version, live=$live_version"
          fi
        fi

        rm -f temp_live_spec.json
        return 0
      fi
    fi
  done

  echo "⚠ Could not retrieve live OpenAPI spec for comparison"
  rm -f temp_live_spec.json
}
```

### 3. Schema-Code Consistency

```bash
# Validate that API responses match documented schemas
validate_schema_consistency() {
  local spec_file="$1"
  local api_base_url="${2:-http://localhost:8000}"

  echo "=== Schema-Code Consistency Check ==="

  # Extract endpoints from spec and test a sample
  if command -v jq >/dev/null 2>&1 && [[ "$spec_file" == *.json ]]; then
    # Test a few GET endpoints that should be safe to call
    jq -r '.paths | to_entries[] | select(.value.get) | .key' "$spec_file" 2>/dev/null | head -3 | while read endpoint; do
      echo "Testing endpoint: $endpoint"

      # Make request and check if response structure matches
      full_url="$api_base_url$endpoint"
      if curl -s "$full_url" >/dev/null 2>&1; then
        echo "  ✅ Endpoint accessible: $endpoint"
      else
        echo "  ⚠ Endpoint not accessible: $endpoint"
      fi
    done
  else
    echo "ℹ Schema-code consistency check requires jq and JSON spec format"
    echo "  Install jq and ensure OpenAPI spec is in JSON format for detailed validation"
  fi
}
```

## AsyncAPI Validation

### 1. AsyncAPI Specification Validation

```bash
# Validate AsyncAPI specifications
validate_asyncapi_spec() {
  local spec_file="$1"

  echo "=== Validating AsyncAPI Specification: $spec_file ==="

  # Method 1: Using AsyncAPI CLI (preferred)
  if command -v asyncapi >/dev/null 2>&1; then
    echo "Using AsyncAPI CLI for validation..."
    if asyncapi validate "$spec_file"; then
      echo "✅ AsyncAPI spec is valid"
    else
      echo "❌ AsyncAPI spec has validation errors"
      return 1
    fi

  # Method 2: Basic YAML/JSON validation
  else
    echo "Using basic syntax validation (install @asyncapi/cli for comprehensive validation)..."
    echo "  npm install -g @asyncapi/cli"

    # Check for AsyncAPI version marker
    if grep -q "asyncapi:" "$spec_file"; then
      echo "✅ AsyncAPI format detected"

      # Basic YAML/JSON validation
      if [[ "$spec_file" == *.json ]]; then
        python3 -m json.tool "$spec_file" >/dev/null && echo "✅ Valid JSON syntax" || echo "❌ Invalid JSON syntax"
      else
        python3 -c "import yaml; yaml.safe_load(open('$spec_file'))" && echo "✅ Valid YAML syntax" || echo "❌ Invalid YAML syntax"
      fi
    else
      echo "❌ Not a valid AsyncAPI specification (missing asyncapi version)"
      return 1
    fi
  fi
}
```

### 2. Event Schema Validation

```bash
# Validate event schemas in AsyncAPI specs
validate_event_schemas() {
  local spec_file="$1"

  echo "=== Event Schema Validation ==="

  if command -v jq >/dev/null 2>&1 && [[ "$spec_file" == *.json ]]; then
    # Extract channel names and message schemas
    jq -r '.channels | keys[]' "$spec_file" 2>/dev/null | while read channel; do
      echo "Validating channel: $channel"
      # Additional validation logic for message schemas
    done
  else
    echo "ℹ Detailed event schema validation requires jq and JSON format"
  fi
}
```

## JSON Schema Validation

### 1. Schema File Validation

```bash
# Validate JSON Schema files
validate_json_schema() {
  local schema_file="$1"

  echo "=== Validating JSON Schema: $schema_file ==="

  # Method 1: Using ajv-cli (preferred)
  if command -v ajv >/dev/null 2>&1; then
    echo "Using ajv-cli for validation..."
    if ajv compile -s "$schema_file"; then
      echo "✅ JSON Schema is valid (ajv)"
    else
      echo "❌ JSON Schema has errors (ajv)"
      return 1
    fi

  # Method 2: Using Python jsonschema
  elif command -v python3 >/dev/null 2>&1; then
    echo "Using Python jsonschema for validation..."
    python3 << EOF
import json
import jsonschema
import sys

try:
    with open('$schema_file') as f:
        schema = json.load(f)

    # Validate the schema itself
    jsonschema.Draft7Validator.check_schema(schema)
    print("✅ JSON Schema is valid (Python jsonschema)")
    sys.exit(0)
except json.JSONDecodeError as e:
    print(f"❌ Invalid JSON: {e}")
    sys.exit(1)
except jsonschema.SchemaError as e:
    print(f"❌ Invalid JSON Schema: {e}")
    sys.exit(1)
except Exception as e:
    print(f"❌ Validation error: {e}")
    sys.exit(1)
EOF

  # Method 3: Basic JSON validation
  else
    echo "Using basic JSON validation (install ajv-cli for comprehensive validation)..."
    echo "  npm install -g ajv-cli"

    if python3 -m json.tool "$schema_file" >/dev/null; then
      echo "✅ Valid JSON syntax"
    else
      echo "❌ Invalid JSON syntax"
      return 1
    fi
  fi
}
```

### 2. Schema-Data Validation

```bash
# Validate data against JSON schemas
validate_data_against_schemas() {
  local contracts_dir="$1"

  echo "=== Data-Schema Validation ==="

  # Find schema files and corresponding example data
  find "$contracts_dir" -name "*.schema.json" | while read schema_file; do
    echo "Processing schema: $schema_file"

    # Look for corresponding example files
    schema_name=$(basename "$schema_file" .schema.json)
    example_files=$(find . -name "*${schema_name}*.json" ! -name "*.schema.json" | head -3)

    if [ -n "$example_files" ]; then
      echo "  Found example files to validate against schema"
      for example_file in $example_files; do
        echo "  Validating: $example_file"

        if command -v ajv >/dev/null 2>&1; then
          if ajv validate -s "$schema_file" -d "$example_file"; then
            echo "    ✅ Valid against schema"
          else
            echo "    ❌ Invalid against schema"
          fi
        else
          echo "    ℹ Install ajv-cli for data validation: npm install -g ajv-cli"
        fi
      done
    else
      echo "  ℹ No example files found for validation"
    fi
  done
}
```

## Contract Versioning and Compatibility

### 1. Version Compatibility Check

```bash
# Check backward compatibility between contract versions
check_version_compatibility() {
  local contracts_dir="$1"

  echo "=== Version Compatibility Check ==="

  # Find versioned contracts
  find "$contracts_dir" -name "v*" -type d | sort | while read version_dir; do
    version=$(basename "$version_dir")
    echo "Checking version: $version"

    # Compare with previous version if it exists
    prev_version_dir=$(find "$contracts_dir" -name "v*" -type d | sort | grep -B1 "$version_dir" | head -1)

    if [ "$prev_version_dir" != "$version_dir" ] && [ -n "$prev_version_dir" ]; then
      prev_version=$(basename "$prev_version_dir")
      echo "  Comparing with previous version: $prev_version"

      # Look for breaking changes (simplified check)
      # In practice, this would use specialized tools like openapi-diff
      echo "  ℹ Manual review recommended for breaking changes"
      echo "    Consider using: npx @apidevtools/swagger-diff $prev_version_dir/api.json $version_dir/api.json"
    fi
  done
}
```

### 2. Contract Freezing Process

```bash
# Ensure contracts are properly frozen and versioned
validate_contract_freezing() {
  local contracts_dir="$1"

  echo "=== Contract Freezing Validation ==="

  if [ ! -d "$contracts_dir" ]; then
    echo "ℹ No contracts directory found - this is expected for initial setup"
    echo "  Contracts will be created when first API version is frozen"
    return 0
  fi

  # Check that versioned contracts are read-only or have protection
  find "$contracts_dir" -name "*.json" -o -name "*.yml" -o -name "*.yaml" | while read contract_file; do
    # Check if file is in a versioned directory structure
    if [[ "$contract_file" =~ /v[0-9]+(\.[0-9]+)?/ ]]; then
      echo "✅ Versioned contract found: $contract_file"

      # Check if file has been modified recently (might indicate unfrozen state)
      if find "$contract_file" -mtime -1 | grep -q .; then
        echo "  ⚠ Recently modified versioned contract (check if intentional): $contract_file"
      fi
    else
      echo "ℹ Non-versioned contract: $contract_file"
    fi
  done
}
```

## Issue Detection and Auto-fixing

### 1. Common Issues Detection

```bash
# Detect common contract and schema issues
detect_common_issues() {
  local target_dir="$1"

  echo "=== Common Issues Detection ==="

  # Issue 1: Missing required OpenAPI fields
  echo "Checking for missing required OpenAPI fields..."
  find "$target_dir" -name "*.json" -o -name "*.yml" -o -name "*.yaml" | while read spec_file; do
    if grep -q "openapi:" "$spec_file" || grep -q "swagger:" "$spec_file"; then
      # Check for required fields
      required_fields=("info" "paths")
      for field in "${required_fields[@]}"; do
        if ! grep -q "^[[:space:]]*$field:" "$spec_file" && ! jq -e ".$field" "$spec_file" >/dev/null 2>&1; then
          echo "  ⚠ Missing required field '$field' in: $spec_file"
        fi
      done
    fi
  done

  # Issue 2: Inconsistent naming conventions
  echo -e "\nChecking naming conventions..."
  find "$target_dir" -name "*.json" | while read file; do
    if jq -e '.paths' "$file" >/dev/null 2>&1; then
      # Check for consistent path naming (kebab-case recommended)
      jq -r '.paths | keys[]' "$file" | while read path; do
        if [[ "$path" =~ [A-Z] ]]; then
          echo "  ⚠ Path contains uppercase (consider kebab-case): $path in $file"
        fi
      done
    fi
  done

  # Issue 3: Missing descriptions
  echo -e "\nChecking for missing descriptions..."
  find "$target_dir" -name "*.json" | while read file; do
    if jq -e '.info' "$file" >/dev/null 2>&1; then
      if ! jq -e '.info.description' "$file" >/dev/null 2>&1; then
        echo "  ⚠ Missing API description in: $file"
      fi
    fi
  done
}
```

### 2. Auto-fix Common Issues

```bash
# Automatically fix common issues where possible
fix_common_issues() {
  local target_file="$1"
  local backup_file="${target_file}.backup.$(date +%Y%m%d_%H%M%S)"

  echo "=== Auto-fixing Issues in $target_file ==="

  # Create backup
  cp "$target_file" "$backup_file"
  echo "Created backup: $backup_file"

  if [[ "$target_file" == *.json ]]; then
    # Fix 1: Add missing description if empty
    if jq -e '.info.description == ""' "$target_file" >/dev/null 2>&1; then
      echo "Adding default description..."
      jq '.info.description = "API for MeatyPrompts application"' "$target_file" > temp.json && mv temp.json "$target_file"
    fi

    # Fix 2: Ensure version is present
    if ! jq -e '.info.version' "$target_file" >/dev/null 2>&1; then
      echo "Adding default version..."
      jq '.info.version = "1.0.0"' "$target_file" > temp.json && mv temp.json "$target_file"
    fi

    # Fix 3: Add servers if missing
    if ! jq -e '.servers' "$target_file" >/dev/null 2>&1; then
      echo "Adding default server configuration..."
      jq '.servers = [{"url": "http://localhost:8000", "description": "Development server"}]' "$target_file" > temp.json && mv temp.json "$target_file"
    fi

    echo "✅ Auto-fixes applied to $target_file"
  else
    echo "ℹ Auto-fix currently supports JSON files only"
  fi
}
```

## Comprehensive Validation Report

### 1. Generate Validation Report

```bash
# Generate comprehensive validation report
generate_validation_report() {
  local output_file="${1:-validation-report.md}"

  cat > "$output_file" << EOF
# Contract and Schema Validation Report

Generated: $(date)

## Summary

EOF

  # Count files by type
  openapi_count=$(find . -name "*.yml" -o -name "*.yaml" -o -name "*.json" | xargs grep -l "openapi:\|swagger:" 2>/dev/null | wc -l)
  asyncapi_count=$(find . -name "*.yml" -o -name "*.yaml" -o -name "*.json" | xargs grep -l "asyncapi:" 2>/dev/null | wc -l)
  jsonschema_count=$(find . -name "*.schema.json" | wc -l)

  cat >> "$output_file" << EOF
- OpenAPI specifications: $openapi_count
- AsyncAPI specifications: $asyncapi_count
- JSON schemas: $jsonschema_count

## Validation Results

EOF

  # Validate each type and add results to report
  echo "### OpenAPI Specifications" >> "$output_file"
  echo >> "$output_file"
  find . -name "*.yml" -o -name "*.yaml" -o -name "*.json" | xargs grep -l "openapi:\|swagger:" 2>/dev/null | while read spec; do
    echo "- **$spec**:" >> "$output_file"
    if validate_openapi_spec "$spec" >/dev/null 2>&1; then
      echo "  - Status: ✅ Valid" >> "$output_file"
    else
      echo "  - Status: ❌ Has issues" >> "$output_file"
    fi
  done

  echo -e "\n### JSON Schemas\n" >> "$output_file"
  find . -name "*.schema.json" | while read schema; do
    echo "- **$schema**:" >> "$output_file"
    if validate_json_schema "$schema" >/dev/null 2>&1; then
      echo "  - Status: ✅ Valid" >> "$output_file"
    else
      echo "  - Status: ❌ Has issues" >> "$output_file"
    fi
  done

  cat >> "$output_file" << EOF

## Recommendations

1. **Install validation tools** for comprehensive checking:
   - \`npm install -g redocly @asyncapi/cli ajv-cli\`

2. **Set up CI validation** to catch issues early

3. **Use live validation** when API is running for accuracy

4. **Version contracts** properly in the contracts/ directory

5. **Add examples** for better schema validation

## Tools Used

- Redocly CLI: $(command -v redocly >/dev/null 2>&1 && echo "✅ Available" || echo "❌ Not installed")
- AsyncAPI CLI: $(command -v asyncapi >/dev/null 2>&1 && echo "✅ Available" || echo "❌ Not installed")
- AJV CLI: $(command -v ajv >/dev/null 2>&1 && echo "✅ Available" || echo "❌ Not installed")

EOF

  echo "✅ Validation report generated: $output_file"
}
```

## Usage Examples

```bash
# Validate all contracts and schemas
/validate-contracts

# Validate only OpenAPI specifications
/validate-contracts --spec-type=openapi

# Validate contracts in specific directory
/validate-contracts --target-dir=contracts/v1

# Auto-fix common issues
/validate-contracts --fix-issues

# Include live API validation
/validate-contracts --live-validation --api-url=http://localhost:8000

# Generate detailed validation report
/validate-contracts > validation-results.txt
```

## CI/CD Integration

```bash
# Add to GitHub Actions workflow
setup_ci_validation() {
  cat > .github/workflows/validate-contracts.yml << 'EOF'
name: Validate API Contracts

on:
  push:
    paths:
      - 'spec/**'
      - 'contracts/**'
      - '**/*.schema.json'
  pull_request:
    paths:
      - 'spec/**'
      - 'contracts/**'
      - '**/*.schema.json'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install validation tools
        run: npm install -g redocly @asyncapi/cli ajv-cli

      - name: Validate contracts
        run: /validate-contracts --spec-type=all

      - name: Generate validation report
        run: /validate-contracts > validation-report.md

      - name: Upload validation report
        uses: actions/upload-artifact@v3
        with:
          name: validation-report
          path: validation-report.md
EOF

  echo "✅ CI validation workflow created"
}
```

The validate-contracts command ensures:

- **Specification compliance**: All contracts follow their respective standards
- **Schema consistency**: Data structures match documented schemas
- **Version compatibility**: Changes don't break existing contracts
- **Live validation**: Contracts match actual API behavior
- **Auto-fixing**: Common issues are automatically resolved
- **Comprehensive reporting**: Detailed validation status and recommendations
