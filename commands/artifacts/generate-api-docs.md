---
description: Update API reference documentation from OpenAPI specs following Diátaxis structure
allowed-tools: Read(./**), Write, Edit, Bash(git:*), Bash(node:*), Bash(uv:*), Bash(curl:*), Grep, Glob
argument-hint: "[--spec-file=path] [--output-dir=path] [--format=html|md] [--validate-first]"
---

# Generate API Documentation

Generates comprehensive API reference documentation from OpenAPI/AsyncAPI specifications, following the Diátaxis documentation structure and integrating with the MeatyPrompts docs system.

## Context Analysis

Analyze current API specifications and documentation state:

```bash
# Check for API specification files
echo "=== API Specifications Found ==="
find . -name "*.yml" -o -name "*.yaml" -o -name "*.json" | grep -E "(openapi|swagger|api)" | head -10

# Check current API documentation
echo -e "\n=== Current API Documentation ==="
find docs -name "*api*" -o -name "*reference*" 2>/dev/null | head -10

# Check for live API endpoints to validate against
echo -e "\n=== API Endpoint Validation ==="
if [ -f "services/api/app/main.py" ]; then
  echo "FastAPI service found"
  # Check if API is running
  curl -s http://localhost:8000/docs 2>/dev/null && echo "✓ API docs accessible" || echo "✗ API not running locally"
  curl -s http://localhost:8000/openapi.json 2>/dev/null && echo "✓ OpenAPI spec accessible" || echo "✗ OpenAPI spec not accessible"
fi
```

## OpenAPI Specification Analysis

### 1. Locate and Validate Specifications

```bash
# Find all API specification files
find_api_specs() {
  echo "Searching for API specifications..."

  # Common locations for API specs
  spec_files=(
    "spec/openapi.yml"
    "spec/openapi.yaml"
    "spec/api.yml"
    "services/api/openapi.json"
    "docs/api/openapi.yml"
  )

  found_specs=()
  for spec in "${spec_files[@]}"; do
    if [ -f "$spec" ]; then
      echo "✓ Found: $spec"
      found_specs+=("$spec")
    fi
  done

  # Also search dynamically
  find . -name "openapi.*" -o -name "swagger.*" -o -name "*api.yml" -o -name "*api.yaml" | grep -v node_modules

  if [ ${#found_specs[@]} -eq 0 ]; then
    echo "⚠ No API specifications found"
    echo "Checking if we can generate from running API..."
  fi
}
```

### 2. Validate Specification Quality

```bash
# Validate OpenAPI specifications
validate_openapi_spec() {
  local spec_file=$1

  echo "Validating OpenAPI spec: $spec_file"

  # Check if redocly CLI is available for validation
  if command -v redocly >/dev/null 2>&1; then
    echo "Using Redocly CLI for validation..."
    redocly lint "$spec_file" && echo "✓ Spec is valid" || echo "✗ Spec has issues"
  elif command -v swagger-codegen >/dev/null 2>&1; then
    echo "Using swagger-codegen for validation..."
    swagger-codegen validate -i "$spec_file" && echo "✓ Spec is valid" || echo "✗ Spec has issues"
  else
    echo "Using basic JSON/YAML validation..."
    if [[ "$spec_file" == *.json ]]; then
      python3 -m json.tool "$spec_file" >/dev/null && echo "✓ Valid JSON" || echo "✗ Invalid JSON"
    else
      python3 -c "import yaml; yaml.safe_load(open('$spec_file'))" && echo "✓ Valid YAML" || echo "✗ Invalid YAML"
    fi
  fi
}
```

### 3. Extract API Metadata

```bash
# Extract key information from OpenAPI spec
extract_api_info() {
  local spec_file=$1

  if [[ "$spec_file" == *.json ]]; then
    title=$(jq -r '.info.title // "API Documentation"' "$spec_file")
    version=$(jq -r '.info.version // "1.0.0"' "$spec_file")
    description=$(jq -r '.info.description // ""' "$spec_file")
    base_path=$(jq -r '.servers[0].url // ""' "$spec_file")
  else
    # YAML parsing with Python
    python3 << EOF
import yaml
with open('$spec_file') as f:
    spec = yaml.safe_load(f)
    print(f"Title: {spec.get('info', {}).get('title', 'API Documentation')}")
    print(f"Version: {spec.get('info', {}).get('version', '1.0.0')}")
    print(f"Description: {spec.get('info', {}).get('description', '')}")
    servers = spec.get('servers', [])
    if servers:
        print(f"Base URL: {servers[0].get('url', '')}")
EOF
  fi
}
```

## Documentation Generation Strategies

### 1. Using Redoc/ReDoc

```bash
# Generate beautiful HTML documentation with ReDoc
generate_redoc_docs() {
  local spec_file=$1
  local output_dir=${2:-"docs/reference/api"}

  mkdir -p "$output_dir"

  if command -v redoc-cli >/dev/null 2>&1; then
    echo "Generating ReDoc documentation..."
    redoc-cli build "$spec_file" --output "$output_dir/index.html" --title "MeatyPrompts API Reference"
    echo "✅ ReDoc documentation generated at $output_dir/index.html"
  else
    echo "Installing redoc-cli..."
    npm install -g redoc-cli
    redoc-cli build "$spec_file" --output "$output_dir/index.html" --title "MeatyPrompts API Reference"
  fi
}
```

### 2. Using Swagger UI

```bash
# Generate interactive Swagger UI documentation
generate_swagger_docs() {
  local spec_file=$1
  local output_dir=${2:-"docs/reference/api"}

  mkdir -p "$output_dir"

  # Download Swagger UI dist files
  if [ ! -d "$output_dir/swagger-ui" ]; then
    echo "Downloading Swagger UI..."
    curl -L https://github.com/swagger-api/swagger-ui/archive/master.zip -o swagger-ui.zip
    unzip swagger-ui.zip "swagger-ui-master/dist/*" -d temp/
    mv temp/swagger-ui-master/dist "$output_dir/swagger-ui"
    rm -rf temp swagger-ui.zip
  fi

  # Create custom HTML file pointing to our spec
  cat > "$output_dir/swagger-ui/index.html" << EOF
<!DOCTYPE html>
<html>
<head>
  <title>MeatyPrompts API Reference</title>
  <link rel="stylesheet" type="text/css" href="./swagger-ui-bundle.css" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin:0; background: #fafafa; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="./swagger-ui-bundle.js"></script>
  <script src="./swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '../../../$spec_file',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout"
      });
    }
  </script>
</body>
</html>
EOF

  echo "✅ Swagger UI documentation generated at $output_dir/swagger-ui/index.html"
}
```

### 3. Markdown Generation

```bash
# Generate Markdown documentation for integration with docs site
generate_markdown_docs() {
  local spec_file=$1
  local output_dir=${2:-"docs/reference/api"}

  mkdir -p "$output_dir"

  # Use widdershins or similar tool to convert OpenAPI to Markdown
  if command -v widdershins >/dev/null 2>&1; then
    echo "Generating Markdown documentation with Widdershins..."
    widdershins "$spec_file" -o "$output_dir/api-reference.md" --language_tabs 'javascript:JavaScript' 'python:Python' 'shell:cURL'
    echo "✅ Markdown documentation generated at $output_dir/api-reference.md"
  else
    echo "Installing widdershins..."
    npm install -g widdershins
    widdershins "$spec_file" -o "$output_dir/api-reference.md" --language_tabs 'javascript:JavaScript' 'python:Python' 'shell:cURL'
  fi
}
```

## Diátaxis Integration

### 1. Create Reference Documentation Structure

```bash
# Create Diátaxis-compliant reference structure
create_reference_structure() {
  local output_dir=$1

  mkdir -p "$output_dir"/{authentication,endpoints,schemas,examples}

  # Create index page following Diátaxis reference pattern
  cat > "$output_dir/README.md" << 'EOF'
# API Reference

Complete technical reference for the MeatyPrompts API.

## Quick Reference

- **Base URL**: `https://api.meatyprompts.com`
- **API Version**: `v1`
- **Authentication**: Bearer token (JWT)
- **Format**: JSON
- **Rate Limiting**: 1000 requests/hour

## Reference Sections

### [Authentication](./authentication/)
- [JWT Tokens](./authentication/jwt-tokens.md)
- [API Keys](./authentication/api-keys.md)
- [Rate Limiting](./authentication/rate-limiting.md)

### [Endpoints](./endpoints/)
- [Prompts API](./endpoints/prompts.md)
- [Users API](./endpoints/users.md)
- [Categories API](./endpoints/categories.md)

### [Schemas](./schemas/)
- [Request Models](./schemas/requests.md)
- [Response Models](./schemas/responses.md)
- [Error Formats](./schemas/errors.md)

### [Examples](./examples/)
- [Common Use Cases](./examples/common-patterns.md)
- [SDK Examples](./examples/sdk-usage.md)
- [cURL Examples](./examples/curl-examples.md)

## Interactive Documentation

- **Swagger UI**: [Interactive API Explorer](./swagger-ui/)
- **ReDoc**: [Beautiful API Documentation](./redoc/)

## Status & Health

- **Health Check**: `GET /health`
- **Status Page**: [status.meatyprompts.com](https://status.meatyprompts.com)
EOF
}
```

### 2. Generate Endpoint Documentation

```bash
# Generate detailed endpoint documentation
generate_endpoint_docs() {
  local spec_file=$1
  local output_dir=$2

  # Extract endpoints and generate individual pages
  python3 << EOF
import yaml
import json
import os

# Load the OpenAPI spec
with open('$spec_file') as f:
    if '$spec_file'.endswith('.json'):
        spec = json.load(f)
    else:
        spec = yaml.safe_load(f)

# Create endpoint documentation
endpoints_dir = '$output_dir/endpoints'
os.makedirs(endpoints_dir, exist_ok=True)

paths = spec.get('paths', {})
for path, methods in paths.items():
    for method, details in methods.items():
        if method in ['get', 'post', 'put', 'patch', 'delete']:
            # Create documentation for each endpoint
            summary = details.get('summary', 'API Endpoint')
            description = details.get('description', '')

            # Sanitize filename
            filename = f"{method.upper()}_{path.replace('/', '_').replace('{', '').replace('}', '')}.md"
            filename = filename.replace('__', '_').strip('_')

            with open(f"{endpoints_dir}/{filename}", 'w') as f:
                f.write(f"# {method.upper()} {path}\n\n")
                f.write(f"{summary}\n\n")
                if description:
                    f.write(f"{description}\n\n")

                # Add parameters section if present
                params = details.get('parameters', [])
                if params:
                    f.write("## Parameters\n\n")
                    for param in params:
                        name = param.get('name', '')
                        required = 'Required' if param.get('required', False) else 'Optional'
                        param_type = param.get('schema', {}).get('type', 'string')
                        param_desc = param.get('description', '')
                        f.write(f"- **{name}** ({param_type}, {required}): {param_desc}\n")
                    f.write("\n")

                # Add request body section if present
                if 'requestBody' in details:
                    f.write("## Request Body\n\n")
                    content = details['requestBody'].get('content', {})
                    if 'application/json' in content:
                        f.write("Content-Type: `application/json`\n\n")
                    f.write("\n")

                # Add responses section
                responses = details.get('responses', {})
                if responses:
                    f.write("## Responses\n\n")
                    for code, response in responses.items():
                        desc = response.get('description', '')
                        f.write(f"### {code}\n{desc}\n\n")

print("✅ Endpoint documentation generated")
EOF
}
```

## Live API Integration

### 1. Generate from Running API

```bash
# Generate documentation from live API
generate_from_live_api() {
  local api_url=${1:-"http://localhost:8000"}
  local output_dir=$2

  echo "Attempting to fetch OpenAPI spec from live API..."

  # Common OpenAPI spec endpoints
  spec_endpoints=(
    "$api_url/openapi.json"
    "$api_url/api/openapi.json"
    "$api_url/docs/openapi.json"
    "$api_url/swagger.json"
  )

  for endpoint in "${spec_endpoints[@]}"; do
    if curl -s "$endpoint" -o temp_spec.json; then
      if python3 -m json.tool temp_spec.json >/dev/null 2>&1; then
        echo "✅ Retrieved valid OpenAPI spec from $endpoint"
        cp temp_spec.json "$output_dir/openapi.json"
        rm temp_spec.json
        return 0
      fi
    fi
  done

  echo "❌ Could not retrieve OpenAPI spec from live API"
  rm -f temp_spec.json
  return 1
}
```

### 2. Validate Against Live API

```bash
# Test generated documentation against live API
validate_against_live_api() {
  local api_url=${1:-"http://localhost:8000"}
  local spec_file=$2

  echo "Validating documentation against live API..."

  # Test a few key endpoints
  echo "Testing health endpoint..."
  curl -s "$api_url/health" >/dev/null && echo "✓ Health endpoint accessible" || echo "✗ Health endpoint failed"

  echo "Testing API documentation endpoint..."
  curl -s "$api_url/docs" >/dev/null && echo "✓ API docs accessible" || echo "✗ API docs failed"

  # Could add more sophisticated testing here
  # - Compare live schema with documented schema
  # - Test authentication endpoints
  # - Validate example requests/responses
}
```

## Quality Assurance

### 1. Documentation Quality Checks

```bash
# Validate generated documentation quality
validate_documentation_quality() {
  local docs_dir=$1

  echo "=== Documentation Quality Check ==="

  # Check for required files
  required_files=(
    "README.md"
    "endpoints/"
    "schemas/"
    "examples/"
  )

  for file in "${required_files[@]}"; do
    if [ -e "$docs_dir/$file" ]; then
      echo "✓ $file exists"
    else
      echo "✗ $file missing"
    fi
  done

  # Check for empty or placeholder content
  find "$docs_dir" -name "*.md" -exec grep -l "TODO\|FIXME\|{}" {} \; | while read file; do
    echo "⚠ $file contains placeholder content"
  done

  # Check for broken internal links
  echo "Checking for broken internal links..."
  find "$docs_dir" -name "*.md" -exec grep -l "\](./" {} \; | while read file; do
    grep -o "\](\./[^)]*)" "$file" | sed 's/](\.\///' | sed 's/)$//' | while read link; do
      target="$docs_dir/$link"
      if [ ! -f "$target" ]; then
        echo "⚠ Broken link in $file: $link"
      fi
    done
  done
}
```

### 2. Accessibility and SEO

```bash
# Ensure documentation follows accessibility guidelines
optimize_documentation() {
  local docs_dir=$1

  # Add proper headings structure
  find "$docs_dir" -name "*.md" | while read file; do
    # Check heading structure (should start with h1, no skipping levels)
    python3 << EOF
import re

with open('$file') as f:
    content = f.read()

headings = re.findall(r'^(#{1,6}) ', content, re.MULTILINE)
if headings:
    levels = [len(h) for h in headings]
    if levels[0] != 1:
        print(f"⚠ $file: First heading should be h1")

    for i in range(1, len(levels)):
        if levels[i] > levels[i-1] + 1:
            print(f"⚠ $file: Heading level skipped (h{levels[i-1]} to h{levels[i]})")
EOF
  done
}
```

## Usage Examples

```bash
# Generate docs from default spec location
/generate-api-docs

# Generate from specific OpenAPI file
/generate-api-docs --spec-file=spec/openapi.yml

# Generate HTML format with custom output location
/generate-api-docs --format=html --output-dir=docs/api-reference

# Validate spec before generating docs
/generate-api-docs --validate-first --spec-file=services/api/openapi.json

# Generate from live API
/generate-api-docs --spec-file=http://localhost:8000/openapi.json
```

## Integration with Docs System

### 1. Link with Main Documentation

```bash
# Update main docs navigation to include API reference
update_docs_navigation() {
  local docs_dir=$1

  # Add API reference to main docs index
  if [ -f "docs/README.md" ]; then
    if ! grep -q "API Reference" docs/README.md; then
      cat >> docs/README.md << 'EOF'

## API Reference

- [API Documentation](./reference/api/) - Complete API reference
- [Interactive Explorer](./reference/api/swagger-ui/) - Try the API
- [Authentication Guide](./reference/api/authentication/) - How to authenticate
EOF
      echo "✅ Added API reference to main docs navigation"
    fi
  fi
}
```

### 2. CI/CD Integration

```bash
# Integrate with CI/CD pipeline
setup_ci_integration() {
  cat > .github/workflows/api-docs.yml << 'EOF'
name: Generate API Documentation

on:
  push:
    paths:
      - 'spec/**'
      - 'services/api/**'
    branches: [main]
  pull_request:
    paths:
      - 'spec/**'
      - 'services/api/**'

jobs:
  generate-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Generate API Documentation
        run: /generate-api-docs --validate-first

      - name: Commit updated docs
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add docs/reference/api/
          git diff --staged --quiet || git commit -m "docs: update API reference"
          git push
EOF
}
```

The generate-api-docs command ensures:

- **Up-to-date API docs**: Always reflect current API specification
- **Multiple formats**: HTML, Markdown, and interactive documentation
- **Diátaxis compliance**: Proper reference documentation structure
- **Quality assurance**: Validation and consistency checks
- **CI/CD integration**: Automated updates on specification changes
