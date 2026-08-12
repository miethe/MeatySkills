# Scaffold Execution Mode

Guidance for creating new feature structures following project architecture.

## When to Use

- New feature scaffolding (creating file structure)
- Boilerplate code generation
- Following project architecture patterns

## Architecture Sequence

Follow MP architecture sequence exactly:

```
schema → DTO → repo → service → API → web hook + UI → tests
```

## Phase 1: Feature Planning

### 1.1 Gather Requirements

- Define feature requirements and acceptance criteria
- Break down into smaller, manageable tasks
- Identify affected components and impact areas
- Plan API/interface design before implementation

### 1.2 Research Existing Patterns

Delegate to **codebase-explorer**:

> Study existing codebase patterns and conventions. Find similar features for consistency. Identify relevant file locations and naming conventions.

### 1.3 Architecture Design

- Design feature architecture and data flow
- Plan database schema changes if needed
- Define API endpoints and contracts
- Consider scalability implications

## Phase 2: Environment Setup

### 2.1 Create Feature Branch

```bash
git checkout -b feature/${ARGUMENTS}
```

### 2.2 Create Directory Structure

Based on feature scope:

#### Backend Only

```bash
mkdir -p app/{schemas,repositories,services}
mkdir -p app/api/v1/endpoints
mkdir -p app/tests
```

#### Frontend Only

```bash
mkdir -p src/components/${feature_name}
mkdir -p src/hooks
mkdir -p src/__tests__
```

#### Full Stack

Create both structures.

## Phase 3: Implementation Sequence

### 3.1 Schema Layer (Backend)

Create schema/DTO files:

```python
# app/schemas/${feature}.py
from pydantic import BaseModel

class ${Feature}Create(BaseModel):
    """Create DTO"""
    pass

class ${Feature}Response(BaseModel):
    """Response DTO"""
    pass
```

### 3.2 Repository Layer (Backend)

```python
# app/repositories/${feature}_repository.py
class ${Feature}Repository:
    """Data access layer"""
    pass
```

### 3.3 Service Layer (Backend)

```python
# app/services/${feature}_service.py
class ${Feature}Service:
    """Business logic layer"""
    pass
```

### 3.4 API Layer (Backend)

```python
# app/api/v1/endpoints/${feature}.py
from fastapi import APIRouter

router = APIRouter()

@router.post("/")
async def create_${feature}():
    pass
```

### 3.5 Frontend Components

```typescript
// src/components/${Feature}/${Feature}.tsx
export function ${Feature}() {
  return null;
}
```

### 3.6 Frontend Hooks

```typescript
// src/hooks/use${Feature}.ts
export function use${Feature}() {
  return {};
}
```

### 3.7 Tests

Create test files for each layer:
- Unit tests for services
- Integration tests for APIs
- Component tests for UI

## Phase 4: Wire Infrastructure

### 4.1 Telemetry

Add telemetry spans named `{route}.{operation}`:

```python
with tracer.start_as_current_span(f"{feature}.create"):
    pass
```

### 4.2 Structured Logs

Add JSON logs with context:

```python
logger.info("Created feature", extra={
    "trace_id": trace_id,
    "user_id": user_id,
    "feature_id": feature_id
})
```

### 4.3 OpenAPI Docs

Update API documentation for new endpoints.

## Phase 5: Quality Gates

Run all gates:

```bash
pnpm test && pnpm typecheck && pnpm lint
```

### 5.1 Reviewer Gate — one lens (mandatory)

A scaffold writes real product code across every layer, so it gets the same one-lens floor as
everything else (`references/gate-risk-classes.md` §2, step 1 — *implement → tests → one review →
ship*):

```
Workflow({ name: 'reviewer-gate', args: {
  scope:               { id: '${feature}', title: 'Scaffold: ${feature}', kind: 'scaffold' },
  lenses:              ['validator'],
  acceptance_criteria: [
    'Each layer is actually WIRED to the next, not merely present',
    'The API is reachable from the real entry point',
    'The tests exercise the slice end to end rather than asserting the scaffold\'s shape',
  ],
  files_changed:       ${files_changed},
  notes:               'Layers scaffolded: schema/DTO, repository, service, API, frontend, tests.',
  timestamp:           '${ISO-8601}',
}})
```

The reviewer runs edit-less (constraint 3). The verdict is a **validated tool call**, not prose — and
`approved: false` splits on `gate_ran`: `true` is a rejection to fix, `false` means the gate did not
run and must be re-dispatched (never "fixed"). Rationale for the form:
`../SKILL.md` § "How a gate is dispatched".

**Why this mode needed one.** Until 2026-07-31 this mode shipped a full vertical slice with **no
reviewer pass whatsoever** — only `test && typecheck && lint`. That is exactly the gap the standing
early-e2e requirement exists for: a scaffold's layers can each pass their own tests while nothing is
connected end to end (`validation/completion-criteria.md`, test-rigor `R3`/`R2`).

**No second lens here.** If the scaffold's API surface parses untrusted input or is an authorization
boundary, that milestone earns a `security` lens under the normal triggers — plan it there, not as a
blanket addition to scaffolding.

## Phase 6: Commit

Create atomic commit with clear message:

```bash
git add .
git commit -m "feat(${feature}): scaffold ${feature} following MP architecture

- Added schema/DTO layer
- Added repository layer
- Added service layer
- Added API endpoints
- Added frontend components
- Wired telemetry and logging
- Added tests

Refs: scaffold/${feature}"
```

## Architecture Checklist

### Backend

- [ ] Schema/DTO in `app/schemas/`
- [ ] Repository in `app/repositories/`
- [ ] Service in `app/services/`
- [ ] Router in `app/api/v1/endpoints/`
- [ ] Migration if schema changed
- [ ] Tests in `app/tests/`
- [ ] Telemetry spans
- [ ] Structured logs

### Frontend

- [ ] Component in appropriate location
- [ ] Hook if needed
- [ ] Page/Route wiring
- [ ] API client integration
- [ ] Tests
- [ ] Storybook story if reusable

### Integration

- [ ] API endpoints documented
- [ ] Types exported and shared
- [ ] Error handling complete
- [ ] Loading states handled

## Output Summary

```
Feature Scaffold Complete: ${feature_name}

Files Created:
- app/schemas/${feature}.py
- app/repositories/${feature}_repository.py
- app/services/${feature}_service.py
- app/api/v1/endpoints/${feature}.py
- src/components/${Feature}/${Feature}.tsx
- src/hooks/use${Feature}.ts
- app/tests/test_${feature}.py

Architecture: schema → DTO → repo → service → API → UI → tests
Branch: feature/${feature_name}
```
