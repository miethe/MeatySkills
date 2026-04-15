# Cross-Layer Troubleshooting Guide

Debugging patterns for issues that span multiple layers of the SkillMeat stack.

**When to use**: Bug manifests across layers (frontend ↔ API ↔ DB), involves data flow violations, or affects both editions.
**External references**:
- `.claude/context/key-context/data-flow-patterns.md` for canonical data flow patterns
- `.claude/context/key-context/fe-be-type-sync-playbook.md` for type sync workflow
- `.claude/context/key-context/api-contract-source-of-truth.md` for OpenAPI contract workflow

---

## Common Cross-Layer Bug Categories

### 1. Frontend ↔ API Contract Mismatches

**Symptoms**: Frontend shows wrong data, missing fields, or type errors from API responses.

**Investigation**:
```bash
# Check OpenAPI spec for the endpoint
grep -A20 "[endpoint_path]" skillmeat/api/openapi.json
# Find frontend type definition
grep "[TypeName]" ai/symbols-frontend.json
# Find backend schema
grep "[SchemaName]" ai/symbols-backend.json
# Compare frontend type with backend schema
```

**Common causes**:
- Backend schema changed but `openapi.json` not regenerated
- Frontend type definition doesn't match OpenAPI spec
- New field added to backend but not to frontend interface
- Field renamed on one side but not the other
- Nullable field not handled in frontend

**Fix workflow** (from `.claude/context/key-context/fe-be-type-sync-playbook.md`):
1. Update backend schema (Pydantic model)
2. Regenerate `openapi.json`
3. Update frontend TypeScript types to match
4. Update any affected components/hooks

**Key invariant**: `skillmeat/api/openapi.json` is the canonical API contract.

### 2. API ↔ DB Schema Drift

**Symptoms**: API returns 500 errors. Fields missing from responses. Query failures.

**Investigation**:
```bash
# Compare ORM model with API schema
grep "[FieldName]" skillmeat/cache/models/[model].py
grep "[FieldName]" skillmeat/core/interfaces/dtos/[dto].py
# Check if migration is needed
cd skillmeat && alembic check 2>&1
```

**Common causes**:
- ORM model updated but migration not created/applied
- DTO doesn't map all ORM fields
- New column in migration but ORM model not updated
- Type mismatch between ORM column type and DTO field type

**Layer chain to verify**: DB schema → ORM model → DTO/Interface → Service → Router schema → OpenAPI → Frontend type

### 3. Edition Divergence (Local vs Enterprise)

**Symptoms**: Works in local (SQLite) but fails in enterprise (PostgreSQL), or vice versa.

**Investigation**:
```bash
# Check edition config
grep -n "edition" skillmeat/api/config.py
# Find edition-specific repositories
ls skillmeat/core/repositories/enterprise/
ls skillmeat/core/repositories/
# Check DI routing
grep -n "if.*edition\|Local.*Repository\|Enterprise.*Repository" skillmeat/api/dependencies.py
```

**Common causes**:
- New feature only implemented in one edition's repository
- SQL syntax difference (SQLite vs PostgreSQL)
- Different column types (UUID vs int, JSONB vs JSON string)
- RLS policies only in enterprise, not simulated in local
- DI factory not routing new repository for one edition

**Known divergences** (intentional):
- SQLAlchemy 1.x style (local) vs 2.x style (enterprise)
- Integer PKs (local) vs UUID PKs (enterprise)
- JSON string (local) vs JSONB (enterprise)

### 4. Cache Invalidation Issues

**Symptoms**: UI shows stale data after mutation. Data updates on refresh but not immediately.

**Investigation**:
```bash
# Find the mutation hook
grep -rn "useMutation\|onSuccess" skillmeat/web/hooks/[hook].ts
# Check invalidation calls
grep -rn "invalidateQueries" skillmeat/web/hooks/[hook].ts
# Check stale time config
grep -rn "staleTime\|gcTime" skillmeat/web/hooks/[hook].ts
```

**Common causes**:
- Missing `queryClient.invalidateQueries()` in mutation's `onSuccess`
- Invalidating wrong query key (must match exactly)
- Not invalidating related queries per the invalidation graph
- Stale time too high for the interaction pattern

**Canonical data flow** (from `.claude/context/key-context/data-flow-patterns.md`):
1. **Write-through**: Write filesystem first → sync to DB → invalidate frontend caches
2. **Stale times**: 5min browsing, 30sec interactive, 2min deployments
3. **Invalidation graph**: Every mutation must invalidate all affected query keys

### 5. Auth Flow Issues

**Symptoms**: Logged in but API returns 401. Token not propagating. Session lost on navigation.

**Investigation**:
```bash
# Check auth middleware chain
grep -n "auth\|middleware\|bearer" skillmeat/api/middleware/auth*.py
# Check frontend auth context
grep -rn "AuthContext\|useAuth\|token" skillmeat/web/contexts/
# Check API client auth header
grep -rn "Authorization\|Bearer\|token" skillmeat/web/lib/api/
```

**Common causes**:
- Auth header not attached to API client requests
- Token expired but not refreshed
- Auth middleware ordering (must run before route handlers)
- Auth provider mismatch between frontend and backend config
- CORS blocking auth headers

**Auth invariants** (from `.claude/rules/api/auth.md`):
- All `/api/v1/*` routes protected by default
- `LocalAuthProvider` must always remain as fallback
- Use `require_auth()`/`AuthContextDep` for new endpoints

### 6. Data Flow Violations

**Symptoms**: Inconsistent data between CLI and web. Cache out of sync. Stale reads.

**Investigation**:
```bash
# Check for direct DB writes bypassing cache refresh
grep -rn "session.add\|session.commit" skillmeat/api/routers/
# Check for filesystem reads from web (should go through DB)
grep -rn "open(\|pathlib\|os.path" skillmeat/api/routers/
```

**Common causes**:
- Web route reading filesystem directly instead of DB cache
- Mutation not calling `refresh_single_artifact_cache()` after filesystem write
- CLI operation not triggering cache refresh
- `POST /cache/refresh` not called after bulk operations

**Canonical principles**:
1. DB cache = web's source of truth (frontend reads from DB-backed API)
2. Filesystem = CLI's source of truth
3. Write-through for web mutations: write FS first, sync to DB, invalidate caches
4. `refresh_single_artifact_cache()` after every single-artifact mutation

---

## Cross-Layer Investigation Strategy

For bugs that span layers, investigate from the symptom layer inward:

```
Frontend symptom → Check API response → Check service logic → Check repository → Check DB
API symptom → Check middleware → Check service → Check repository → Check DB
DB symptom → Check migration → Check ORM model → Check repository queries
```

**Always trace the full chain** before fixing. A fix at one layer may mask the real issue at another.

## Investigation Quick Reference

| Issue Type | Key Files to Check | Delegate To |
|-----------|-------------------|-------------|
| Contract mismatch | openapi.json + frontend types | lead-architect (decision) → specialists |
| Schema drift | ORM models + migrations | data-layer-expert |
| Edition divergence | Both repo implementations + DI | python-backend-engineer |
| Cache invalidation | Mutation hooks + query config | ui-engineer-enhanced |
| Auth flow | Middleware + frontend context | python-backend-engineer + ui-engineer-enhanced |
| Data flow | Router write path + cache refresh | python-backend-engineer |
