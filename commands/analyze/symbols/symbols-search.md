---
name: symbols-search
description: Advanced symbol search with filters and contextual relevance
---

# Advanced Symbol Search Strategies

Implement intelligent symbol lookup to avoid loading entire 447KB graph.

## Search by Intent

### Component Development
```bash
# Find existing components for pattern reference
symbols-search --intent=component --name="Button|Card|Modal" --limit=20

# Find component interfaces and props
symbols-search --intent=interface --pattern=".*Props|.*Config" --limit=30
```

### API Development
```bash
# Find existing API patterns
symbols-search --intent=api --pattern="router|endpoint|handler" --limit=25

# Find DTO and schema patterns
symbols-search --intent=schema --pattern="DTO|Schema|Pydantic" --limit=20
```

## Contextual Filters

### By Architectural Layer (MeatyPrompts Pattern)
```bash
# Router layer symbols
grep -E "router.*export.*function|class.*Router" symbols.graph.json

# Service layer symbols
grep -E "service.*export.*function|class.*Service" symbols.graph.json

# Repository layer symbols
grep -E "repository.*export.*function|class.*Repository" symbols.graph.json
```

### By Package Boundary
```bash
# UI package patterns
grep -E "packages/ui.*export" symbols.graph.json | head -50

# API service patterns
grep -E "services/api.*export" symbols.graph.json | head -50

# Shared utilities
grep -E "packages/shared.*export" symbols.graph.json | head -30
```

## Smart Relevance Scoring

### High Priority Symbols (Load First)
1. **Interfaces & Types**: Critical for TypeScript development
2. **Component Exports**: Main functionality patterns
3. **Service Classes**: Business logic patterns
4. **Hook Functions**: State management patterns

### Medium Priority Symbols
1. **Utility Functions**: Helper patterns
2. **Constants**: Configuration patterns
3. **Enum Definitions**: Value patterns

### Low Priority Symbols (Load on Demand)
1. **Test Files**: Development-time only
2. **Internal Functions**: Implementation details
3. **Deprecated Patterns**: Legacy code

## Implementation Strategy

### Phase 1: Essential Context (< 100KB)
Load symbols directly related to current task:
```bash
# For UI tasks
symbols-search --priority=high --domain=ui --limit=75

# For API tasks
symbols-search --priority=high --domain=api --limit=75
```

### Phase 2: Supporting Context (< 50KB)
Load related symbols for broader understanding:
```bash
# Related patterns and utilities
symbols-search --priority=medium --related-to="CurrentTask" --limit=25
```

### Phase 3: On-Demand Context
Load specific symbols only when explicitly needed:
```bash
# Specific symbol lookup
symbols-search --exact="ComponentName|FunctionName" --with-context
```

## Agent Integration Examples

### UI Engineer Pattern
```bash
# Load UI essentials
symbols-search --agent=ui-engineer --context=current-task --limit=100
```

### Backend Architect Pattern
```bash
# Load API essentials
symbols-search --agent=backend-architect --context=current-task --limit=100
```

### Cross-Domain Pattern
```bash
# Load shared essentials for full-stack work
symbols-search --domain=shared --priority=high --limit=50
```
