---
name: symbols-chunk
description: "Split symbols graph into optimized domain-specific chunks with separated test files for efficient agent consumption"
tools: [Read, Write, Bash]
---

# Optimized Symbol Chunking

Split the monolithic symbols.graph.json into optimized domain-specific chunks with test file separation for efficient agent consumption.

## Three-Tier Strategy

**Primary Development Files** (Main agent consumption):
- `ai/symbols-ui.json`: Components, hooks, UI types, pages (NO tests)
- `ai/symbols-api.json`: Services, routers, repositories, DTOs (NO tests)
- `ai/symbols-shared.json`: Utilities, types, constants, configs (NO tests)

**Secondary Test Files** (On-demand loading):
- `ai/symbols-ui-tests.json`: All UI-related test files
- `ai/symbols-api-tests.json`: All API-related test files
- `ai/symbols-shared-tests.json`: All shared utility test files

**Reference File**: `ai/symbols.graph.json` (Complete codebase)

## Implementation

```bash
# Create optimized domain-specific symbol chunks with test separation
node -e "
const fs = require('fs');
const symbols = JSON.parse(fs.readFileSync('ai/symbols.graph.json', 'utf8'));

// Helper function to identify test files
const isTestFile = (path) => {
  return path.includes('__tests__') ||
         path.includes('.test.') ||
         path.includes('.spec.') ||
         path.includes('.stories.') ||
         path.includes('/test/') ||
         path.includes('/tests/');
};

// Helper function to identify domain
const getModuleDomain = (module) => {
  const path = module.path;

  // UI Domain
  if (path.includes('/components/') ||
      path.includes('/hooks/') ||
      path.includes('/pages/') ||
      path.includes('/app/') ||
      path.includes('packages/ui/') ||
      path.match(/\.(tsx|jsx)$/) ||
      module.symbols.some(s => s.kind === 'component' || s.kind === 'hook')) {
    return 'ui';
  }

  // API Domain
  if (path.includes('/api/') ||
      path.includes('/services/') ||
      path.includes('/lib/api/') ||
      path.includes('/repositories/') ||
      path.includes('/routers/') ||
      path.includes('/schemas/') ||
      module.symbols.some(s => s.name.includes('Service') || s.name.includes('Repository'))) {
    return 'api';
  }

  // Default to shared
  return 'shared';
};

// Separate modules by domain and test status
const modulesByDomain = {
  ui: { main: [], tests: [] },
  api: { main: [], tests: [] },
  shared: { main: [], tests: [] }
};

symbols.modules.forEach(module => {
  const domain = getModuleDomain(module);
  const isTest = isTestFile(module.path);

  if (isTest) {
    modulesByDomain[domain].tests.push(module);
  } else {
    modulesByDomain[domain].main.push(module);
  }
});

// Write chunked files
const writeChunk = (modules, filename, domain, type) => {
  const chunk = {
    ...symbols,
    sourceDirectory: symbols.sourceDirectory,
    domain: domain.toUpperCase(),
    type: type.toUpperCase(),
    chunkStrategy: 'optimized-separation',
    generatedAt: new Date().toISOString(),
    totalFiles: modules.length,
    totalSymbols: modules.reduce((sum, m) => sum + m.symbols.length, 0),
    modules
  };

  fs.writeFileSync(filename, JSON.stringify(chunk, null, 2));
  console.log(\`✅ \${domain.toUpperCase()}-\${type.toUpperCase()}: \${chunk.totalSymbols} symbols from \${chunk.totalFiles} files\`);
  return chunk.totalSymbols;
};

// Write main development files
let totalMainSymbols = 0;
totalMainSymbols += writeChunk(modulesByDomain.ui.main, 'ai/symbols-ui.json', 'ui', 'main');
totalMainSymbols += writeChunk(modulesByDomain.api.main, 'ai/symbols-api.json', 'api', 'main');
totalMainSymbols += writeChunk(modulesByDomain.shared.main, 'ai/symbols-shared.json', 'shared', 'main');

// Write test files
let totalTestSymbols = 0;
totalTestSymbols += writeChunk(modulesByDomain.ui.tests, 'ai/symbols-ui-tests.json', 'ui', 'tests');
totalTestSymbols += writeChunk(modulesByDomain.api.tests, 'ai/symbols-api-tests.json', 'api', 'tests');
totalTestSymbols += writeChunk(modulesByDomain.shared.tests, 'ai/symbols-shared-tests.json', 'shared', 'tests');

console.log('');
console.log('📊 Optimized Symbol Chunks Created:');
console.log(\`   Main Development: \${totalMainSymbols} symbols\`);
console.log(\`   Test Files: \${totalTestSymbols} symbols\`);
console.log(\`   Total: \${totalMainSymbols + totalTestSymbols} symbols\`);
console.log('');
console.log('🚀 Token efficiency improved by separating test files!');
"
```

## Verification

```bash
# Check all chunk sizes
echo "📊 Symbol File Sizes:"
ls -lh ai/symbols-*.json | awk '{print $5, $9}' | sort

# Verify no symbol loss across all chunks
echo ""
echo "🔍 Symbol Count Verification:"
original_count=$(jq '.totalSymbols' ai/symbols.graph.json)
main_count=$(($(jq '.totalSymbols' ai/symbols-ui.json) + $(jq '.totalSymbols' ai/symbols-api.json) + $(jq '.totalSymbols' ai/symbols-shared.json)))
test_count=$(($(jq '.totalSymbols' ai/symbols-ui-tests.json) + $(jq '.totalSymbols' ai/symbols-api-tests.json) + $(jq '.totalSymbols' ai/symbols-shared-tests.json)))
total_chunked=$((main_count + test_count))

echo "Original symbols: $original_count"
echo "Main development: $main_count"
echo "Test files: $test_count"
echo "Total chunked: $total_chunked"

if [ $original_count -eq $total_chunked ]; then
  echo "✅ Symbol count verification passed!"
else
  echo "❌ Symbol count mismatch detected!"
fi

# Show improvement metrics
echo ""
echo "🚀 Performance Improvements:"
main_lines=$(wc -l ai/symbols-ui.json ai/symbols-api.json ai/symbols-shared.json | tail -1 | awk '{print $1}')
original_lines=$(wc -l ai/symbols.graph.json | awk '{print $1}')
improvement=$((100 - (main_lines * 100 / original_lines)))
echo "Main development files: $main_lines lines (${improvement}% reduction)"
echo "Token efficiency gained by separating test files!"
```

## Usage Examples

```bash
# Quick development context (most common)
cat ai/symbols-ui.json | head -50

# Load test context when debugging
cat ai/symbols-ui-tests.json | head -20

# Comprehensive search across all files
grep -l "ComponentName" ai/symbols-*.json
```
