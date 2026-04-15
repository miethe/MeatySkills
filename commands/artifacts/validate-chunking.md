---
description: Validate and update ai/chunking.config.json against schema and usage patterns
allowed-tools: Read(./**), Write, Bash(git:*), Bash(node:*), Grep, Glob
argument-hint: "[--tune] [--stats] [--validate-only]"
---

# Validate Chunking Configuration

Validates `ai/chunking.config.json` against its schema and analyzes actual codebase characteristics to optimize chunking parameters for AI processing.

## Context Analysis

Analyze current codebase to understand chunking needs:

```bash
# Check current chunking config
cat ai/chunking.config.json 2>/dev/null || echo "No chunking config found"

# Analyze file sizes and types
echo "=== File Type Distribution ==="
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" \) \
  | grep -v node_modules | grep -v __pycache__ | grep -v dist | grep -v build \
  | xargs wc -l | tail -20

# Check for large files that need chunking
echo "=== Files > 500 lines ==="
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" \) \
  | grep -v node_modules | grep -v __pycache__ \
  | xargs wc -l | awk '$1 > 500 { print $1 " lines: " $2 }' | sort -nr
```

## Schema Validation

### 1. Validate Against JSON Schema

Check the chunking config structure:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ChunkingConfig",
  "type": "object",
  "required": ["lineChunkMin", "lineChunkMax", "overlapLines", "allowExtensions", "denyExtensions", "stopwords"],
  "properties": {
    "lineChunkMin": {"type": "integer", "minimum": 50, "maximum": 1000},
    "lineChunkMax": {"type": "integer", "minimum": 200, "maximum": 2000},
    "overlapLines": {"type": "integer", "minimum": 0, "maximum": 200},
    "allowExtensions": {"type": "array", "items": {"type": "string", "pattern": "^\\..+"}},
    "denyExtensions": {"type": "array", "items": {"type": "string", "pattern": "^\\..+"}},
    "stopwords": {"type": "array", "items": {"type": "string"}}
  }
}
```

### 2. Logical Validation Rules

Verify configuration makes sense:
- `lineChunkMin < lineChunkMax`
- `overlapLines < lineChunkMin`
- No extension appears in both allow and deny lists
- Extensions start with dot (`.ts` not `ts`)
- Stopwords are common directory names

## Codebase Analysis

### File Extension Coverage

Analyze what file types exist and should be included:

```bash
# Count files by extension
find . -type f -name "*.*" | grep -v node_modules | grep -v __pycache__ | \
  sed 's/.*\.//' | sort | uniq -c | sort -nr | head -20

# Check for missing extensions in config
echo "Extensions in codebase but not in allowExtensions:"
# Compare with current config
```

### Line Length Distribution

Analyze file sizes to optimize chunk parameters:

```bash
# Create line count histogram
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" \) \
  | grep -v node_modules | grep -v __pycache__ \
  | xargs wc -l | awk '
    $1 <= 100 { small++ }
    $1 > 100 && $1 <= 300 { medium++ }
    $1 > 300 && $1 <= 800 { large++ }
    $1 > 800 { xlarge++ }
    END {
      print "Small (≤100): " small
      print "Medium (101-300): " medium
      print "Large (301-800): " large
      print "XLarge (>800): " xlarge
    }'
```

### Directory Stopwords Effectiveness

Check if stopwords catch unwanted directories:

```bash
# Find directories that should be ignored
find . -type d -name node_modules -o -name __pycache__ -o -name dist -o -name build -o -name .next \
  | head -10

# Find files in ignored directories (should be 0 with good stopwords)
echo "Files in supposedly ignored directories:"
find . -path "*/node_modules/*" -o -path "*/__pycache__/*" -o -path "*/dist/*" -o -path "*/build/*" \
  | wc -l
```

## Parameter Tuning

### Optimal Chunk Size Calculation

Based on AI context windows and processing efficiency:

```bash
# Analyze actual file content for optimal chunking
echo "=== Chunk Size Analysis ==="

# Sample files and estimate tokens (rough estimate: ~4 chars per token)
sample_files=$(find apps services packages -name "*.ts" -o -name "*.py" | head -10)
for file in $sample_files; do
  lines=$(wc -l < "$file")
  chars=$(wc -c < "$file")
  echo "File: $file - Lines: $lines, Chars: $chars, Est. Tokens: $((chars/4))"
done
```

### Recommended Settings Based on Analysis

Generate tuned configuration:

1. **Chunk Size Optimization**
   - Min chunk: 200-300 lines (ensures meaningful context)
   - Max chunk: 600-800 lines (fits in AI context window)
   - Overlap: 40-80 lines (preserves function boundaries)

2. **Extension Filtering**
   - Include all source code extensions found
   - Exclude binaries, builds, and generated files
   - Add project-specific extensions

3. **Stopword Refinement**
   - Add project-specific build directories
   - Include common cache directories
   - Add IDE-specific folders

## Configuration Update Process

### 1. Generate Optimized Config

Create new configuration based on analysis:

```json
{
  "lineChunkMin": 250,
  "lineChunkMax": 700,
  "overlapLines": 50,
  "allowExtensions": [
    ".ts", ".tsx", ".js", ".jsx", ".py",
    ".md", ".yml", ".yaml", ".json",
    ".sql", ".toml", ".env.example"
  ],
  "denyExtensions": [
    ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".pdf", ".zip", ".tar", ".gz", ".woff", ".woff2",
    ".mp4", ".mov", ".avi"
  ],
  "stopwords": [
    "node_modules", "build", "dist", ".next", ".turbo",
    "__pycache__", ".pytest_cache", "coverage",
    ".git", ".vscode", ".idea", "vendor"
  ]
}
```

### 2. Validation Testing

Test the new configuration:

1. **Dry run chunking** with new parameters
2. **Measure coverage** of important files
3. **Check exclusion effectiveness** for unwanted files
4. **Estimate token usage** for AI processing

## Statistics Generation

When `--stats` flag is used, generate detailed statistics:

### File Coverage Stats
```json
{
  "totalFiles": 1234,
  "includedFiles": 856,
  "excludedFiles": 378,
  "coveragePercent": 69.4,
  "byExtension": {
    ".ts": {"count": 245, "avgLines": 156},
    ".py": {"count": 89, "avgLines": 201},
    ".md": {"count": 34, "avgLines": 98}
  }
}
```

### Chunking Efficiency
```json
{
  "estimatedChunks": 1247,
  "avgChunkSize": 425,
  "filesNeedingChunks": 89,
  "overlapRatio": 0.12,
  "estimatedTokens": 456789
}
```

## Usage Examples

```bash
# Validate current configuration
/validate-chunking

# Validate and show statistics
/validate-chunking --stats

# Tune configuration based on codebase analysis
/validate-chunking --tune

# Only validate, don't update
/validate-chunking --validate-only
```

## Error Handling

### Common Issues
- **Invalid JSON**: Report syntax errors with line numbers
- **Missing fields**: Identify required fields not present
- **Invalid ranges**: Check min/max constraints
- **Extension conflicts**: Detect allow/deny overlaps

### Auto-fixes
- **Add missing extensions**: Include common types found in codebase
- **Remove conflicts**: Remove extensions from deny list if in allow list
- **Optimize ranges**: Adjust chunk sizes based on file distribution
- **Update stopwords**: Add newly discovered build directories

## Integration

### CI/CD Pipeline
- Validate chunking config in pull requests
- Update configuration when new file types added
- Generate statistics for documentation

### AI Processing Integration
- Used by code analysis tools
- Feeds into embedding generation
- Optimizes context window usage
- Improves AI agent navigation efficiency

The validated chunking configuration ensures:
- **Optimal AI processing** with appropriate chunk sizes
- **Complete coverage** of relevant source files
- **Efficient exclusion** of build artifacts and dependencies
- **Balanced context** with proper overlap for continuity
