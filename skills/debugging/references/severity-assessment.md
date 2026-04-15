# Severity Assessment Reference

Classification criteria for bug severity. Drives mode selection in the debug skill.

**When to use**: During triage mode, or inline at the start of any debug workflow.
**When NOT to use**: When `--severity` is explicitly provided and confirmed.

---

## Assessment Dimensions

Score each dimension, then classify:

### 1. Scope

| Score | Criteria |
|-------|----------|
| Low | 1-2 files, single layer |
| Medium | 3-5 files, single layer or 2 adjacent layers |
| High | 5+ files, or 3+ layers, or cross-cutting concern |

### 2. Root Cause Clarity

| Score | Criteria |
|-------|----------|
| Clear | Obvious from stack trace, error message, or reproduction steps |
| Likely | Strong hypothesis from symbols/investigation, needs confirmation |
| Unclear | Multiple hypotheses, requires deep analysis or bisection |

### 3. Architectural Impact

| Score | Criteria |
|-------|----------|
| None | Fix uses existing patterns, no interface changes |
| Minimal | Minor adjustments within existing patterns |
| Significant | Changes contracts, crosses boundaries, or affects patterns |

### 4. Risk

| Score | Criteria |
|-------|----------|
| Low | Fix is isolated, unlikely to affect other components |
| Medium | Fix touches shared code, regression possible |
| High | Fix affects critical path, production data, or multiple consumers |

### 5. PRD Alignment

| Score | Criteria |
|-------|----------|
| Aligned | Bug is a straightforward implementation error |
| Gap | Bug reveals missing requirement or edge case |
| Conflict | Bug suggests the design itself needs revision |

---

## Classification Matrix

| Severity | Scope | Root Cause | Arch Impact | Risk | Action |
|----------|-------|------------|-------------|------|--------|
| **Simple** | Low | Clear | None | Low | → Quick Fix |
| **Moderate** | Low-Med | Clear-Likely | None-Minimal | Low-Med | → Quick Fix + validation |
| **Complex** | Med-High | Likely-Unclear | Minimal-Significant | Med-High | → Comprehensive |
| **Critical** | Any | Any | Any | Production impact | → Comprehensive (urgent) |

---

## Upgrade Triggers

Any single trigger bumps severity to the indicated minimum, regardless of other scores:

| Trigger | Minimum Severity | Reason |
|---------|-----------------|--------|
| API contract change needed | Complex | Must update `skillmeat/api/openapi.json`, affects consumers |
| Enterprise/local edition divergence | Complex | Needs dual-edition testing and possibly separate paths |
| Introduces new pattern | Complex | Must justify vs existing patterns, risks inconsistency |
| Affects auth/security | Complex | Security-sensitive changes need careful review |
| Rollback strategy needed | Critical | Implies production risk |
| Data migration needed | Critical | Irreversible change to persistent state |
| Production system down | Critical | Urgency overrides normal process |
| Data loss or corruption | Critical | Highest severity, immediate action |

---

## Quick Assessment Checklist

Run through this in order. Stop at the first "yes" that upgrades severity:

```
1. Is production down or data at risk?           → Critical
2. Is a rollback or data migration needed?        → Critical
3. Does the fix change API contracts?             → Complex (minimum)
4. Does it affect both editions (local+enterprise)? → Complex (minimum)
5. Does it introduce a pattern not seen elsewhere? → Complex (minimum)
6. Does it touch auth/security code?              → Complex (minimum)
7. Is the root cause unclear after symbol query?  → Complex (minimum)
8. Are 5+ files affected?                         → Complex (minimum)
9. Are 3-5 files affected with clear cause?       → Moderate
10. Is it 1-2 files with obvious fix?             → Simple
```

---

## Assessment Output Format

After running the checklist, produce:

```
Severity: [Simple | Moderate | Complex | Critical]
Reasoning: [which dimensions and triggers drove the classification]
Upgrade triggers hit: [list any, or "none"]
Recommended mode: [Quick Fix | Quick Fix + validation | Comprehensive | Comprehensive (urgent)]
```
