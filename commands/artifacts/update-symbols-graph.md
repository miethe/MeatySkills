---
description: Generate ai/symbols.graph.json with function/class summaries (≤280 chars)
allowed-tools: Read(./**), Write, Bash(git:*), Bash(node:*), Bash(python:*), Grep, Glob
argument-hint: "[--dry-run] [--language=ts|py|js] [path-pattern]"
---

# Update Symbols Graph

Generates `ai/symbols.graph.json` by analyzing TypeScript, Python, and JavaScript source files to extract function, class, method, and interface definitions with concise summaries.

## Context Analysis

Analyze MeatyPrompts codebase for symbol extraction:

```bash
# SAFETY: Validate we're in the MeatyPrompts project
if [[ ! -f "pnpm-workspace.yaml" ]] || [[ ! -d "services/api" ]]; then
  echo "ERROR: Not in MeatyPrompts project directory" >&2
  exit 1
fi

# Check for recent MeatyPrompts code changes only
git diff --name-only HEAD~1 HEAD | \
  grep -E '\.(ts|tsx|py|js|jsx)$' | \
  grep -E '^(apps|services|packages)/' || echo "No recent code changes in project directories"

# Count MeatyPrompts source files by language (exclude third-party)
echo "MeatyPrompts TypeScript files: $(find apps services packages -name '*.ts' -o -name '*.tsx' 2>/dev/null | grep -v node_modules | grep -v dist | wc -l)"
echo "MeatyPrompts Python files: $(find services -name '*.py' 2>/dev/null | grep -v __pycache__ | wc -l)"
echo "MeatyPrompts JavaScript files: $(find apps packages -name '*.js' -o -name '*.jsx' 2>/dev/null | grep -v node_modules | grep -v dist | wc -l)"

# List MeatyPrompts source directories only
echo "Project structure:"
find apps services packages -name "src" -type d 2>/dev/null | sort
```

## Symbol Extraction Strategy

### TypeScript/JavaScript Analysis

Extract symbols using AST parsing or regex patterns:

1. **Functions**
   - Regular functions: `function functionName(...)`
   - Arrow functions: `const functionName = (...) =>`
   - Method functions: `methodName(...) {`

2. **Classes**
   - Class declarations: `class ClassName`
   - Abstract classes: `abstract class ClassName`

3. **Interfaces & Types**
   - Interface declarations: `interface InterfaceName`
   - Type aliases: `type TypeName =`

4. **Methods**
   - Class methods: inside class declarations
   - Object methods: in object literals

### Python Analysis

Extract symbols from Python files:

1. **Functions**
   - Function definitions: `def function_name(...)`
   - Async functions: `async def function_name(...)`

2. **Classes**
   - Class definitions: `class ClassName:`
   - Dataclass definitions: `@dataclass class ClassName:`

3. **Methods**
   - Instance methods: `def method_name(self, ...)`
   - Class methods: `@classmethod def method_name(...)`
   - Static methods: `@staticmethod def method_name(...)`

## Symbol Summary Generation

For each extracted symbol, generate a ≤280 character summary:

### Summary Rules
1. **Function summaries**: Describe purpose, key parameters, return value
2. **Class summaries**: Explain responsibility, main properties/methods
3. **Interface summaries**: Define contract or data shape
4. **Method summaries**: Describe action within class context

### Summary Examples
```json
{
  "kind": "function",
  "name": "createPrompt",
  "line": 45,
  "summary": "Creates a new prompt with title, description, tags. Validates input, saves to database, returns PromptDTO or throws ValidationError"
}
```

## MeatyPrompts Project Boundaries

**CRITICAL**: This command ONLY analyzes MeatyPrompts project source code files. It must exclude third-party code, generated files, and non-source files.

### Inclusion Rules (ONLY these files)
- **Directories**: `apps/`, `services/`, `packages/` (MeatyPrompts project structure)
- **Extensions**: `.ts`, `.tsx`, `.py`, `.js`, `.jsx` (source code only)
- **Location**: Files within the main project directories that are part of the MeatyPrompts codebase

### Exclusion Rules (NEVER analyze these)
- **Third-party**: `node_modules/`, `__pycache__/`, `.venv/`, `venv/`
- **Generated**: `dist/`, `build/`, `.next/`, `target/`, `coverage/`
- **Version control**: `.git/`, `.svn/`
- **Config/docs**: `*.md`, `*.json`, `*.yml`, `*.yaml`, `*.toml`, `*.ini`
- **Tests fixtures**: `__fixtures__/`, `fixtures/`, `mocks/`
- **IDE files**: `.vscode/`, `.idea/`, `*.swp`, `*~`
- **Temporary**: `tmp/`, `temp/`, `.cache/`
- **Logs**: `*.log`, `logs/`

## Implementation Process

### 1. File Discovery with Safety Validation

```bash
# STEP 1: Validate we're in MeatyPrompts project root
if [[ ! -f "pnpm-workspace.yaml" ]] || [[ ! -d "services/api" ]] || [[ ! -d "packages/ui" ]]; then
  echo "ERROR: Not in MeatyPrompts project root directory" >&2
  exit 1
fi

# STEP 2: Find ONLY MeatyPrompts project source files with explicit filtering
find apps services packages \
  -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.js" -o -name "*.jsx" \
  2>/dev/null | \
  grep -v node_modules | \
  grep -v __pycache__ | \
  grep -v dist | \
  grep -v build | \
  grep -v .next | \
  grep -v target | \
  grep -v coverage | \
  grep -v .venv | \
  grep -v venv | \
  grep -v __fixtures__ | \
  grep -v fixtures | \
  grep -v mocks | \
  grep -v .cache | \
  grep -v tmp | \
  grep -v temp | \
  grep -v logs | \
  grep -E '^(apps|services|packages)/' | \
  sort

# STEP 3: Validate file count is reasonable (safety check)
FILE_COUNT=$(find apps services packages -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | wc -l)
if [[ $FILE_COUNT -gt 10000 ]]; then
  echo "WARNING: Found $FILE_COUNT files, this may include non-project files" >&2
  echo "Aborting for safety. Please check directory filters." >&2
  exit 1
fi

echo "Analyzing $FILE_COUNT MeatyPrompts project source files..."
```

### 2. Symbol Extraction Per File (with Project Validation)

For each file, perform safety checks then extract symbols:

```bash
# Function to validate file is part of MeatyPrompts project
validate_project_file() {
  local file="$1"

  # Must be in project directories
  if [[ ! "$file" =~ ^(apps|services|packages)/ ]]; then
    echo "SKIP: $file - outside project directories" >&2
    return 1
  fi

  # Must not be in excluded directories
  if [[ "$file" =~ (node_modules|__pycache__|dist|build|\.next|target|coverage|\.venv|venv|__fixtures__|fixtures|mocks|\.cache|tmp|temp|logs) ]]; then
    echo "SKIP: $file - in excluded directory" >&2
    return 1
  fi

  # Must be actual source code file
  if [[ ! "$file" =~ \.(ts|tsx|py|js|jsx)$ ]]; then
    echo "SKIP: $file - not a source file" >&2
    return 1
  fi

  # Must exist and be readable
  if [[ ! -r "$file" ]]; then
    echo "SKIP: $file - not readable" >&2
    return 1
  fi

  return 0
}
```

For each validated project file:
1. **Validate file** belongs to MeatyPrompts project (not third-party)
2. **Parse syntax** to identify symbol definitions
3. **Extract context** (docstrings, comments, surrounding code)
4. **Generate summary** following the 280-character limit
5. **Record location** (file path and line number)

### 3. Build Symbols Graph Structure

Generate JSON following the schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "modules": [
    {
      "path": "apps/web/src/components/PromptCard.tsx",
      "symbols": [
        {
          "kind": "interface",
          "name": "PromptCardProps",
          "line": 12,
          "summary": "Props for PromptCard component including prompt data, editing state, and event handlers for CRUD operations"
        },
        {
          "kind": "function",
          "name": "PromptCard",
          "line": 24,
          "summary": "React component that renders prompt card with title, description, tags, actions. Supports edit/delete modes with optimistic updates"
        }
      ]
    }
  ]
}
```

## Advanced Features

### Incremental Updates
- Track file modification times
- Only re-analyze changed files
- Preserve summaries for unchanged symbols
- Merge results with existing graph

### Context-Aware Summaries
- Use surrounding comments and docstrings
- Infer purpose from function/method names
- Consider parameter names and types
- Look at usage patterns in same file

### Summary Quality Checks
- Ensure summaries are ≤280 characters
- Avoid generic descriptions ("This function...")
- Include key information (parameters, return value, purpose)
- Use clear, technical language

## Validation & Quality Control

### Schema Validation
1. **Structure compliance**: Matches symbols graph JSON schema
2. **Required fields**: All symbols have kind, name, line, summary
3. **Character limits**: All summaries ≤280 characters
4. **Line numbers**: Valid and point to actual symbol definitions

### Quality Metrics
- **Symbol coverage**: Percentage of functions/classes with summaries
- **Summary length distribution**: Ensure good use of character budget
- **Duplicate detection**: Identify duplicate symbols across modules
- **Missing symbols**: Functions/classes without summaries

## Error Handling

### Common Issues
- **Parse errors**: Skip malformed files, log warnings
- **Missing line numbers**: Use approximate line from regex match
- **Long summaries**: Truncate to 280 chars with "..." indicator
- **Encoding issues**: Handle UTF-8 files properly

### Recovery Strategies
- **Partial failures**: Continue processing other files
- **Syntax errors**: Use regex fallback when AST parsing fails
- **Memory limits**: Process files in batches for large codebases

## Usage Examples

```bash
# Full MeatyPrompts symbol graph generation
/update-symbols-graph

# Dry run to preview output (validates project structure first)
/update-symbols-graph --dry-run

# Only analyze TypeScript files in MeatyPrompts project
/update-symbols-graph --language=ts

# Update specific MeatyPrompts directory
/update-symbols-graph apps/web/src/components

# Focus on changed MeatyPrompts files only (excludes third-party)
/update-symbols-graph $(git diff --name-only HEAD~1 HEAD | \
  grep -E '\.(ts|tsx|py)$' | \
  grep -E '^(apps|services|packages)/' | \
  grep -v node_modules | \
  grep -v dist)

# Validate current file filtering (debug mode)
find apps services packages -name "*.ts" -o -name "*.tsx" -o -name "*.py" | \
  head -20 | \
  while read file; do
    if validate_project_file "$file"; then
      echo "ANALYZE: $file"
    fi
  done
```

## Integration & Performance

### CI/CD Integration
- Run after code changes on main branch
- Include in pre-commit validation (fast mode)
- Generate as build artifact for documentation

### Performance Optimization
- **Parallel processing**: Analyze files concurrently
- **Caching**: Store parsed ASTs for reuse
- **Incremental mode**: Only process changed files
- **Memory management**: Process in batches for large repos

### AI Agent Benefits
The generated symbols graph enables AI agents to:
- **Find functions quickly** by name or purpose
- **Understand code structure** without reading full files
- **Generate accurate code references** with line numbers
- **Navigate complex codebases** efficiently
- **Suggest relevant functions** for modifications

## Security & Safety Guardrails

### Project Boundary Enforcement

This command implements strict filtering to ensure it ONLY processes MeatyPrompts project code:

1. **Directory Validation**: Must execute from MeatyPrompts root (validates `pnpm-workspace.yaml` exists)
2. **Path Filtering**: Only analyzes files in `apps/`, `services/`, `packages/` directories
3. **Extension Filtering**: Only processes `.ts`, `.tsx`, `.py`, `.js`, `.jsx` files
4. **Exclusion Patterns**: Explicitly excludes all third-party, generated, and non-source files
5. **File Count Validation**: Aborts if file count exceeds safety threshold (10,000 files)
6. **Readability Checks**: Validates each file is readable before processing

### What This Command Will NOT Do

- ❌ Analyze `node_modules` or any third-party packages
- ❌ Process generated files in `dist/`, `build/`, `.next/` directories
- ❌ Read configuration files, documentation, or test fixtures
- ❌ Scan outside the MeatyPrompts project structure
- ❌ Process files without proper validation

### Validation Commands for Safety

```bash
# Verify project structure before running
ls pnpm-workspace.yaml services/api packages/ui apps/web >/dev/null 2>&1 && echo "✅ MeatyPrompts project detected" || echo "❌ Not in MeatyPrompts root"

# Preview files that would be analyzed (first 10)
find apps services packages -name "*.ts" -o -name "*.tsx" -o -name "*.py" 2>/dev/null | \
  grep -v node_modules | grep -v dist | head -10

# Count project files by type
echo "Would analyze:"
echo "  TS/TSX: $(find apps services packages -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | wc -l)"
echo "  Python: $(find services -name "*.py" 2>/dev/null | grep -v __pycache__ | wc -l)"
echo "  JS/JSX: $(find apps packages -name "*.js" -o -name "*.jsx" 2>/dev/null | grep -v node_modules | grep -v dist | wc -l)"
```
