# Frontend/React Troubleshooting Guide

React/Next.js-specific debugging patterns for SkillMeat.

**When to use**: Bug is in frontend code (components, hooks, pages, styles, API integration).
**External references**: 
- `.claude/context/key-context/component-patterns.md` for component conventions
- `.claude/context/key-context/nextjs-patterns.md` for App Router patterns

---

## Common Bug Categories

### 1. Hydration Mismatches

**Symptoms**: Console warning about server/client HTML mismatch. Component flickers on load.

**Investigation**:
```bash
# Find the component
grep "[ComponentName]" ai/symbols-frontend.json
# Check for client-only code in server component
grep -n "window\|document\|localStorage\|useEffect" skillmeat/web/components/[component].tsx
```

**Common causes**:
- Using browser APIs (`window`, `document`) in server component without guard
- Date/time formatting that differs between server and client
- Missing `'use client'` directive on component that uses hooks
- Conditional rendering based on client-only state

**Fix patterns**:
- Add `'use client'` if component needs browser APIs
- Use `dynamic(() => import(...), { ssr: false })` for client-only components
- Guard browser API access: `if (typeof window !== 'undefined')`

### 2. React Query / State Management Issues

**Symptoms**: Stale data after mutation. Infinite refetching. Cache not updating.

**Investigation**:
```bash
# Find the query hook
grep -rn "useQuery\|useMutation\|queryKey" skillmeat/web/hooks/[hook].ts
# Check invalidation patterns
grep -rn "invalidateQueries\|queryClient" skillmeat/web/hooks/
```

**Common causes**:
- Missing `queryClient.invalidateQueries()` after mutation
- Wrong query key in invalidation (must match exactly)
- Stale time too high for interactive data (should be 30s per data flow patterns)
- Optimistic update not rolled back on error
- Missing related cache invalidation (see invalidation graph in data flow patterns)

**Stale time reference** (from `.claude/context/key-context/data-flow-patterns.md`):
- Browsing: 5min
- Interactive/monitoring: 30sec
- Deployments: 2min

### 3. Component Rendering Issues

**Symptoms**: Infinite re-renders. UI not updating. Performance degradation.

**Investigation**:
```bash
# Check for missing dependency arrays
grep -n "useEffect\|useMemo\|useCallback" skillmeat/web/components/[component].tsx
# Look for object/array literals in render
grep -n "={{" skillmeat/web/components/[component].tsx
```

**Common causes**:
- Missing dependency in `useEffect`/`useMemo`/`useCallback` array
- Object/array literal created every render (causes child re-renders)
- State update inside `useEffect` without proper guards
- Missing `key` prop on list items or wrong key (index as key)

### 4. App Router / Routing Issues

**Symptoms**: Page not found. Layout not applying. Client component in server context.

**Investigation**:
```bash
# Check file structure
ls skillmeat/web/app/[route]/
# Check for 'use client' directives
grep -rn "'use client'" skillmeat/web/app/[route]/
```

**Common causes**:
- Missing `page.tsx` in route directory
- `layout.tsx` not wrapping children properly
- Client component imported into server component without boundary
- Parallel routes or intercepting routes misconfigured

**Invariant** (from `.claude/rules/web/pages.md`): Default to server components. Add `'use client'` only when needed.

### 5. TypeScript / Type Errors

**Symptoms**: Build failure. Red squiggles. Runtime type mismatch.

**Investigation**:
```bash
# Run type checker
cd skillmeat/web && pnpm type-check 2>&1 | head -50
# Check shared types
grep "[TypeName]" ai/symbols-frontend.json
```

**Common causes**:
- Missing props in component interface
- Union type not narrowed before access
- API response type doesn't match actual response
- Duplicate type exports (known pre-existing issue in `types/index.ts`)

**Reference**: `.claude/context/key-context/fe-be-type-sync-playbook.md` for keeping frontend types aligned with backend schemas.

### 6. API Integration Issues

**Symptoms**: Network errors. Wrong data shape. Loading states stuck.

**Investigation**:
```bash
# Find the API client function
grep -rn "fetch\|apiClient\|axios" skillmeat/web/lib/api/
# Check the hook
grep -rn "[hookName]" skillmeat/web/hooks/
```

**Common causes**:
- API URL mismatch (wrong base URL or path)
- Response shape changed on backend but frontend type not updated
- Error boundary not catching fetch failures
- Loading/error states not properly handled in component

### 7. Accessibility Issues

**Symptoms**: Screen reader can't navigate. Keyboard trap. Missing labels.

**Investigation**:
```bash
# Check for a11y attributes
grep -n "aria-\|role=\|tabIndex\|label" skillmeat/web/components/[component].tsx
# Run accessibility tests if they exist
cd skillmeat/web && pnpm test -- --testPathPattern="a11y"
```

**Common causes**:
- Missing `aria-label` on icon-only buttons
- Missing `role` attribute on custom interactive elements
- Focus not managed after modal/dialog open
- Missing keyboard event handlers alongside click handlers

**Invariant** (from `.claude/rules/web/components.md`): Keep accessibility explicit (labels, keyboard/focus behavior).

### 8. Build / Compilation Issues

**Symptoms**: Next.js build fails. Module not found. Chunk loading errors.

**Investigation**:
```bash
cd skillmeat/web && pnpm build 2>&1 | tail -30
# Check for dynamic imports
grep -rn "dynamic\|React.lazy\|import(" skillmeat/web/components/[area]/
```

**Common causes**:
- `React.lazy` with dynamic variable paths (bypasses bundler chunk generation)
- Missing dependency in `package.json`
- Circular imports between modules
- Server component importing client-only module

---

## Browser DevTools Integration

For frontend bugs, use Chrome DevTools via MCP:

```
mcp__claude-in-chrome__read_console_messages  # Check JS errors
mcp__claude-in-chrome__read_network_requests  # Inspect API calls
mcp__claude-in-chrome__read_page              # Debug DOM state
mcp__claude-in-chrome__javascript_tool        # Run JS in page context
```

## Investigation Quick Reference

| Error Type | First Check | Symbol Query | Delegate To |
|-----------|-------------|-------------|-------------|
| Hydration | Component source | `grep "[Comp]" ai/symbols-frontend.json` | ui-engineer-enhanced |
| Query/Cache | Hook definition | `grep "use[Hook]" ai/symbols-frontend.json` | ui-engineer-enhanced |
| Rendering | Component deps | `grep "[Comp]" ai/symbols-frontend.json` | ui-engineer-enhanced |
| Routing | File structure | `ls skillmeat/web/app/[route]/` | ui-engineer-enhanced |
| Types | Type definitions | `grep "[Type]" ai/symbols-frontend.json` | ui-engineer-enhanced |
| Build | Build output | N/A — read build error | ui-engineer-enhanced |
| Accessibility | Component ARIA | `grep "[Comp]" ai/symbols-frontend.json` | ui-engineer-enhanced + a11y-sheriff |
