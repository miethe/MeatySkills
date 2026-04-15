---
name: symbols-update
description: Incrementally update symbols graph without full regeneration
---

# Incremental Symbol Updates

Maintain symbols graph freshness without full 447KB regeneration.

## File-Based Updates

### Watch Mode Implementation
```bash
# Watch for changes and update incrementally
symbols-update --watch --debounce=500ms

# Update specific files
symbols-update --files="apps/web/src/components/Button.tsx,packages/ui/src/Card.tsx"

# Update by directory
symbols-update --directory="apps/web/src/hooks" --recursive
```

### Git-Based Updates
```bash
# Update symbols for changed files since last commit
symbols-update --since=HEAD~1

# Update symbols for files in current branch
symbols-update --branch-changes --base=main

# Update symbols for staged files
symbols-update --staged
```

## Delta Management

### Incremental Strategy
1. **Track File Modifications**: Use file timestamps and git history
2. **Update Only Changed Symbols**: Replace symbols from modified files only
3. **Maintain Symbol References**: Update cross-references incrementally
4. **Validate Integrity**: Ensure symbol graph remains consistent

### Implementation Pattern
```bash
# Check which files need symbol updates
symbols-update --check --verbose

# Apply incremental updates
symbols-update --apply --log-changes

# Validate updated graph
symbols-update --validate --fix-references
```

## Chunked Update Strategy

### Update by Domain
```bash
# Update UI-related symbols only
symbols-update --domain=ui --scope="packages/ui,apps/web/src"

# Update API-related symbols only
symbols-update --domain=api --scope="services/api"

# Update shared utilities
symbols-update --domain=shared --scope="packages/shared,packages/tokens"
```

### Parallel Updates
```bash
# Update multiple domains in parallel
symbols-update --parallel --domains="ui,api,shared" --max-workers=3

# Update with priority queuing
symbols-update --priority-queue --high="ui" --medium="api" --low="shared"
```

## Performance Optimization

### Lazy Loading Updates
- Update symbols on-demand when agents request specific domains
- Cache frequently accessed symbol chunks
- Invalidate cache only for modified file dependencies

### Differential Updates
```bash
# Generate diff between old and new symbols
symbols-update --diff --output=symbols.diff.json

# Apply differential update
symbols-update --apply-diff=symbols.diff.json

# Rollback if needed
symbols-update --rollback --from=backup.symbols.json
```

## CI/CD Integration

### Pre-commit Hook
```bash
#!/bin/bash
# Update symbols for staged files only
symbols-update --staged --silent --fast

# Validate symbol integrity
symbols-update --validate --exit-on-error
```

### Build Pipeline
```bash
# Full symbol regeneration on main branch
if [[ $BRANCH == "main" ]]; then
  symbols-update --full-regeneration --optimize
else
  # Incremental updates on feature branches
  symbols-update --incremental --since=origin/main
fi
```

## Monitoring and Metrics

### Update Performance
- Track update latency by file count
- Monitor symbol graph size growth
- Alert on validation failures
- Log update frequency patterns

### Usage Analytics
```bash
# Track which symbols are accessed most
symbols-update --analytics --track-usage

# Optimize based on access patterns
symbols-update --optimize-for-usage --prune-unused
```
