---
name: symbols-query
description: "Query symbols efficiently by name, kind, or domain context"
tools: [Read, Write, Bash]
---

# Symbol Query System

Efficiently query and filter symbols without loading the entire graph.

## Usage Patterns

```bash
# Find specific symbols
/symbols:query --name="PromptCard"
/symbols:query --kind="component" --domain="ui"
/symbols:query --path="contexts" --summary

# Context-aware queries
/symbols:query --ui-components
/symbols:query --api-functions
/symbols:query --hooks --recent
```

## Query Implementation

```javascript
// Smart symbol query with context awareness
function querySymbols(options = {}) {
  const { name, kind, path, domain, summary = false, limit = 20 } = options;

  // Determine which chunk(s) to load
  const domains = determineDomains(options);
  const results = [];

  for (const domainName of domains) {
    const symbols = loadSymbolChunk(domainName);
    const filtered = symbols.modules
      .filter(module => !path || module.path.includes(path))
      .flatMap(module =>
        module.symbols
          .filter(symbol => {
            if (name && !symbol.name.toLowerCase().includes(name.toLowerCase())) return false;
            if (kind && symbol.kind !== kind) return false;
            return true;
          })
          .map(symbol => ({
            ...symbol,
            file: module.path,
            domain: domainName
          }))
      );

    results.push(...filtered);
  }

  // Sort by relevance and limit
  return results
    .sort((a, b) => calculateRelevance(b, options) - calculateRelevance(a, options))
    .slice(0, limit)
    .map(symbol => summary ? createSummary(symbol) : symbol);
}

function determineDomains(options) {
  if (options.domain) return [options.domain];
  if (options['ui-components'] || options.kind === 'component') return ['UI'];
  if (options['api-functions'] || options.path?.includes('api')) return ['API'];
  if (options.hooks) return ['UI'];

  // Default: search shared first, then others
  return ['SHARED', 'UI', 'API'];
}
```

## Context-Aware Shortcuts

```bash
# Create shortcut queries for common patterns
alias symbols-components="/symbols:query --kind=component --domain=ui --limit=10"
alias symbols-hooks="/symbols:query --kind=hook --domain=ui --summary"
alias symbols-api="/symbols:query --domain=api --kind=function --summary"
alias symbols-types="/symbols:query --kind=interface,type --domain=shared"
```

## Integration with Agents

```bash
# Agent context loading
/symbols:query --context="ui-engineer" --task="component-creation"
/symbols:query --context="backend-architect" --task="api-design"
```
