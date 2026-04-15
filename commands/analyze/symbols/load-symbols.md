---
name: load-symbols
description: Intelligently load relevant symbols based on task context using optimized chunked files
---

# Smart Symbol Loading

Dynamically load only relevant symbols based on task context using optimized domain-specific chunks.

## Quick Loading Patterns

### Frontend Development (Primary)
```bash
# Load main UI symbols (most common - optimized for tokens)
cat ai/symbols-ui.json | jq '.modules[] | select(.path | contains("components") or contains("hooks"))'

# Load UI test context when debugging
cat ai/symbols-ui-tests.json | head -50

# Search across all UI files
grep -E "(Component|Hook|Props)" ai/symbols-ui*.json
```

### Backend Development (Primary)
```bash
# Load main API symbols (services, routers, schemas)
cat ai/symbols-api.json | head -100

# Load API test context when debugging
cat ai/symbols-api-tests.json | head -50

# Focus on specific API patterns
grep -E "(Service|Repository|Router)" ai/symbols-api.json
```

### Shared Utilities (Primary)
```bash
# Load shared utilities and types
cat ai/symbols-shared.json | head -75

# Load shared test utilities
cat ai/symbols-shared-tests.json | head -30
```

## Context-Aware Loading Strategies

### By Domain (Recommended)
- **UI Domain**: `ai/symbols-ui.json` - Components, hooks, pages (NO tests)
- **API Domain**: `ai/symbols-api.json` - Services, routers, repositories (NO tests)
- **Shared Domain**: `ai/symbols-shared.json` - Utils, types, configs (NO tests)

### By File Type Priority
```bash
# High Priority: Main development files (token-optimized)
cat ai/symbols-ui.json      # Frontend development
cat ai/symbols-api.json     # Backend development
cat ai/symbols-shared.json  # Cross-cutting concerns

# Lower Priority: Test context (when needed)
cat ai/symbols-ui-tests.json     # UI testing/debugging
cat ai/symbols-api-tests.json    # API testing/debugging
cat ai/symbols-shared-tests.json # Shared testing utilities
```

### By Architectural Layer
```bash
# MeatyPrompts layered architecture: Routers → Services → Repositories → DB

# Load router layer (API domain)
jq '.modules[] | select(.symbols[].name | test("router|Router"))' ai/symbols-api.json

# Load service layer (API domain)
jq '.modules[] | select(.symbols[].name | test("service|Service"))' ai/symbols-api.json

# Load repository layer (API domain)
jq '.modules[] | select(.symbols[].name | test("repository|Repository"))' ai/symbols-api.json
```

## Optimized Agent Integration

### Primary Development Context (Token-Efficient)
```bash
# UI Engineer: Load main frontend symbols only
cat ai/symbols-ui.json | head -100

# Backend Architect: Load main API symbols only
cat ai/symbols-api.json | head -100

# Full-stack: Load main shared symbols
cat ai/symbols-shared.json | head -75
```

### Secondary Testing Context (On-Demand)
```bash
# Load test context only when debugging or writing tests
cat ai/symbols-*-tests.json | head -50

# Search test patterns across domains
grep -E "(test|spec|mock)" ai/symbols-*-tests.json
```

### Cross-Domain Search
```bash
# Find symbol across all main files (excluding tests)
grep -l "SymbolName" ai/symbols-{ui,api,shared}.json

# Find symbol across all files including tests
grep -l "SymbolName" ai/symbols-*.json

# Count symbols by domain
echo "UI: $(jq '.totalSymbols' ai/symbols-ui.json) symbols"
echo "API: $(jq '.totalSymbols' ai/symbols-api.json) symbols"
echo "Shared: $(jq '.totalSymbols' ai/symbols-shared.json) symbols"
```

## Performance Benefits

- **30-40% token reduction** for main development tasks
- **Faster agent loading** with focused symbol sets
- **On-demand test context** only when needed
- **Clear domain boundaries** for better context relevance
