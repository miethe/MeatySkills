# Database Troubleshooting Guide

SQLAlchemy/Alembic-specific debugging patterns for SkillMeat.

**When to use**: Bug involves database models, migrations, queries, or ORM behavior.
**External references**:
- `.claude/context/key-context/migration-dialect-patterns.md` for SQLite vs PostgreSQL pitfalls
- `.claude/context/key-context/repository-architecture.md` for repository pattern invariants

---

## Common Bug Categories

### 1. Migration Failures

**Symptoms**: `alembic upgrade head` fails. Different behavior on SQLite vs PostgreSQL.

**Investigation**:
```bash
# List recent migrations
ls -la skillmeat/cache/alembic/versions/ | tail -10
# Check for dialect guards
grep -n "dialect\|op.get_bind" skillmeat/cache/alembic/versions/[migration].py
# Check migration history
cd skillmeat && alembic history --verbose | head -20
```

**Common causes**:
- **Missing dialect guard**: SQLite and PostgreSQL handle DDL differently
  ```python
  # Required pattern:
  bind = op.get_bind()
  if bind.dialect.name == 'postgresql':
      # PostgreSQL-specific DDL
  else:
      # SQLite fallback
  ```
- **Column constraint on ALTER TABLE**: SQLite doesn't support adding NOT NULL columns without defaults
- **PostgreSQL-specific types without fallback**: JSONB, UUID, ARRAY need SQLite alternatives
- **Dependency ordering**: Migration depends on a table that hasn't been created yet

**Reference**: `.claude/context/key-context/migration-dialect-patterns.md` — full dialect guard checklist

### 2. Query Errors

**Symptoms**: SQLAlchemy query raises exception. Wrong results returned.

**Investigation**:
```bash
# Find the repository method
grep "[method_name]" ai/symbols-backend.json
# Check query style (1.x vs 2.x)
grep -n "session.query\|select(" skillmeat/core/repositories/[repo].py
```

**Common causes**:
- **SQLAlchemy style mismatch**: Local repos use 1.x `session.query()`, enterprise repos use 2.x `select()`. This is intentional — don't mix styles.
  ```python
  # Local (1.x style)
  session.query(Model).filter(Model.id == id)
  
  # Enterprise (2.x style)
  select(Model).where(Model.id == id)
  ```
- **Relationship not loaded**: Accessing lazy-loaded relationship outside session scope
- **Wrong filter**: Using `==` with `None` instead of `.is_(None)`
- **JSONB operator on SQLite**: `@>` containment operator is PostgreSQL-only

**Key invariant**: Enterprise repos use `select()` style; local repos use `session.query()`. This divergence is intentional.

### 3. Connection / Session Issues

**Symptoms**: "Database is locked" (SQLite). Connection pool exhausted. Transaction not committed.

**Investigation**:
```bash
# Check session management
grep -n "get_db\|Session\|session" skillmeat/api/dependencies.py
# Check for session leaks
grep -rn "session\." skillmeat/core/repositories/ | grep -v "session.close\|session.commit\|session.rollback"
```

**Common causes**:
- **SQLite concurrent access**: SQLite doesn't support concurrent writes. Use WAL mode.
- **Session not closed**: Dependency injection should handle session lifecycle via `get_db()`
- **Missing commit**: Write operations need explicit `session.commit()` or `session.flush()`
- **Transaction not rolled back on error**: Missing try/except with `session.rollback()`

### 4. Schema / Model Drift

**Symptoms**: Column not found. Unexpected NULL. Type mismatch at runtime.

**Investigation**:
```bash
# Compare model with migration
grep -A20 "class [ModelName]" skillmeat/cache/models/[model].py
# Check latest migration for this table
grep -rl "[table_name]" skillmeat/cache/alembic/versions/
# Generate diff
cd skillmeat && alembic check 2>&1 || echo "Schema drift detected"
```

**Common causes**:
- Model updated but migration not created
- Migration created but not applied (`alembic upgrade head`)
- Column type changed in model but not migrated
- Default value mismatch between model and migration

### 5. Enterprise-Specific Gotchas

**Symptoms**: Works in local (SQLite) but fails in enterprise (PostgreSQL), or vice versa.

**Investigation**:
```bash
# Check edition-specific code
grep -n "edition\|enterprise\|local" skillmeat/core/repositories/[repo].py
# Check for PostgreSQL-only features
grep -n "JSONB\|UUID\|RLS\|@>" skillmeat/cache/models/
```

**Known gotchas**:
- **UUID primary keys**: Enterprise uses `UUID`, local uses `int` — plan docs may say `int` but enterprise implementation uses `uuid.UUID`
- **JSONB operators**: `@>` containment is PostgreSQL-only, must use `@pytest.mark.integration` for tests
- **SQLAlchemy comparator cache poisoning**: Patching `column.type` for SQLite compat doesn't propagate to `comparator.__dict__['type']` — must manually refresh after patching
- **RLS policies**: Row-Level Security is PostgreSQL-only, not available in SQLite tests
- **Mock-based unit tests preferred**: Use `MagicMock(spec=Session)` for enterprise repo tests, not SQLite shims

### 6. Performance Issues

**Symptoms**: Slow queries. High DB CPU. Timeout on large datasets.

**Investigation**:
```bash
# Look for N+1 patterns
grep -n "for.*in.*:" skillmeat/core/repositories/[repo].py
# Check relationship loading strategy
grep -n "relationship\|joinedload\|selectinload\|lazy=" skillmeat/cache/models/[model].py
# Check for missing indexes
grep -n "Index\|index=True\|unique=True" skillmeat/cache/models/[model].py
```

**Common causes**:
- **N+1 queries**: Loop making individual queries instead of batch/join
- **Missing index**: Filter/sort column without index
- **Eager loading everything**: `joinedload` on large relationships when not needed
- **Full table scan**: Query without WHERE clause on large table

---

## Investigation Quick Reference

| Error Type | First Check | Key Files | Delegate To |
|-----------|-------------|-----------|-------------|
| Migration | Dialect guards | `skillmeat/cache/alembic/versions/` | data-layer-expert |
| Query | Style (1.x vs 2.x) | `skillmeat/core/repositories/` | data-layer-expert |
| Connection | Session lifecycle | `skillmeat/api/dependencies.py` | data-layer-expert |
| Schema drift | Model vs migration | `skillmeat/cache/models/` | data-layer-expert |
| Enterprise | Edition-specific code | `skillmeat/core/repositories/enterprise/` | data-layer-expert |
| Performance | Relationship loading | `skillmeat/cache/models/` | data-layer-expert |
