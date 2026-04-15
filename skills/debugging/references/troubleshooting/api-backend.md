# API/Backend Troubleshooting Guide

Python/FastAPI-specific debugging patterns for SkillMeat.

**When to use**: Bug is in Python backend code (routers, services, repositories, middleware, schemas).
**External reference**: `.claude/context/key-context/debugging-patterns.md` for symbol-first methodology.

---

## Common Bug Categories

### 1. 422 Validation Errors

**Symptoms**: Client receives 422 Unprocessable Entity. Pydantic validation failure.

**Investigation**:
```bash
# Find the schema involved
grep "[SchemaName]" ai/symbols-backend.json
# Check router for request model
grep -A10 "def [endpoint_name]" skillmeat/api/routers/[router].py
```

**Common causes**:
- Required field missing from request body (field should be `Optional` or have default)
- Field comes from URL path but schema expects it in body (e.g., `list_id` from path param)
- Pydantic v2 strict mode rejecting type coercion
- `int` vs `str` mismatch in path parameters

**Key files**: `skillmeat/api/routers/`, `skillmeat/core/interfaces/dtos/`
**Reference**: `.claude/context/key-context/router-patterns.md`

### 2. 500 Internal Server Errors

**Symptoms**: Unhandled exception in API endpoint.

**Investigation**:
```bash
# Check for the exception in recent logs
grep -r "raise\|Exception\|Error" skillmeat/api/routers/[router].py
# Find service layer for the endpoint
grep "[service_function]" ai/symbols-backend.json
```

**Common causes**:
- DB session not properly committed/rolled back
- Missing null check on optional relationship
- Import error in a lazily-loaded module
- Repository method not implemented for current edition

**Key files**: `skillmeat/api/dependencies.py`, `skillmeat/core/services/`

### 3. Auth Failures

**Symptoms**: 401/403 on endpoints that should be accessible.

**Investigation**:
```bash
# Check auth middleware
grep -n "require_auth\|AuthContextDep\|verify_token" skillmeat/api/routers/[router].py
# Check excluded paths
grep "excluded_paths\|EXCLUDED" skillmeat/api/middleware/auth*.py
```

**Common causes**:
- Using legacy `TokenDep`/`verify_token` instead of `require_auth()`/`AuthContextDep`
- Path not excluded from auth middleware when it should be (health, docs)
- Enterprise PAT (`verify_enterprise_pat`) applied to non-enterprise router
- `LocalAuthProvider` not set as fallback

**Invariants** (from `.claude/rules/api/auth.md`):
- All `/api/v1/*` routes protected by default
- `LocalAuthProvider` must always remain as fallback
- Use `require_auth()`/`AuthContextDep` for new endpoints
**Reference**: `.claude/context/key-context/auth-architecture.md`

### 4. CORS Issues

**Symptoms**: Browser blocks requests with CORS error.

**Investigation**:
```bash
grep -n "CORSMiddleware\|allow_origins" skillmeat/api/main.py
```

**Common causes**:
- Middleware ordering (CORS must be added early)
- Missing origin in allowed list
- Preflight OPTIONS not handled

### 5. Performance Issues

**Symptoms**: Slow API responses, timeouts.

**Investigation**:
```bash
# Find N+1 queries — look for loops with DB calls
grep -n "for.*in.*:" skillmeat/core/repositories/[repo].py
# Check for missing eager loading
grep -n "relationship\|joinedload\|selectinload" skillmeat/cache/models/[model].py
```

**Common causes**:
- N+1 query pattern (loop of individual queries instead of batch)
- Missing database index on filtered/sorted column
- Eager loading not configured for frequently-accessed relationships
- Full table scan on large tables

**Reference**: `.claude/context/key-context/repository-architecture.md`

### 6. Migration Failures

**Symptoms**: Alembic migration fails, different behavior SQLite vs PostgreSQL.

**Investigation**:
```bash
# Check migration file
ls -la skillmeat/cache/alembic/versions/
# Look for dialect-specific code
grep -n "dialect\|sqlite\|postgresql" skillmeat/cache/alembic/versions/[migration].py
```

**Common causes**:
- Missing dialect guard (`op.get_bind().dialect.name`)
- SQLite doesn't support `ALTER TABLE ADD COLUMN` with constraints the same way
- PostgreSQL-specific types (JSONB, UUID) used without fallback
- Migration dependency ordering wrong

**Reference**: `.claude/context/key-context/migration-dialect-patterns.md`

### 7. Dependency Injection Issues

**Symptoms**: Wrong repository implementation used, circular imports.

**Investigation**:
```bash
# Check DI factory
grep -n "edition\|get_.*repository" skillmeat/api/dependencies.py
# Check edition config
grep -n "edition" skillmeat/api/config.py
```

**Common causes**:
- DI factory not routing to correct edition implementation
- New repository not registered in `dependencies.py`
- Circular import between service and repository
- Edition string mismatch (`"local"` not `"community"`)

**Reference**: `.claude/context/key-context/repository-architecture.md`

---

## Investigation Quick Reference

| Error Type | First Check | Symbol Query | Delegate To |
|-----------|-------------|-------------|-------------|
| 422 | Schema definition | `grep "[Schema]" ai/symbols-backend.json` | python-backend-engineer |
| 500 | Stack trace file | `grep "[function]" ai/symbols-backend.json` | python-backend-engineer |
| 401/403 | Auth middleware | `grep "auth" ai/symbols-backend.json` | python-backend-engineer |
| Slow response | Repository layer | `grep "[repo]" ai/symbols-backend.json` | python-backend-engineer |
| Migration | Version file | N/A — read migration directly | data-layer-expert |
| DI error | dependencies.py | `grep "factory\|get_" ai/symbols-backend.json` | python-backend-engineer |
