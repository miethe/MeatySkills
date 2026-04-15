# Disagreement Protocol

**Key Principle**: Tests decide, not model preference. CI is the neutral arbiter. This prevents "model-religion wars."

---

## Decision Tree

```
Disagreement detected (Model A says X, Model B says Y)
│
├─ Are there existing tests covering this behavior?
│   ├─ Yes → Run tests against both implementations
│   │        Winner = implementation that passes all tests
│   │        If both pass → prefer simpler/smaller diff
│   │        If both fail → escalate to Opus with extended thinking
│   └─ No → "Prove it" rule: require creation of minimal tests first
│            Both implementations must pass the new tests
│            Then apply same winner selection
│
├─ Is this a design/architecture disagreement (no testable behavior)?
│   ├─ Reversible decision? → Pick either, document rationale in ADR, move on
│   └─ Irreversible (DB schema, API contract)?
│       → Escalate to Opus (adaptive thinking) with both proposals
│       → Only use extended thinking if adaptive can't decide
│
└─ Escalation is NOT justified by:
    - "This is a hard problem" (try harder with adaptive first)
    - "The models disagree" (tests decide, not authority)
    - "I'm not sure" (write tests to gain certainty)
```

---

## Implementation Rules

1. **Test creation is mandatory** when no tests cover the disputed behavior
2. **Simpler wins** when both pass — measured by: fewer lines changed, fewer new dependencies, closer to existing patterns
3. **Document the disagreement** briefly in commit message when resolved
4. **Never auto-pick based on model reputation** — always use objective criteria
5. **Escalation budget**: extended thinking for disagreement resolution is limited to irreversible decisions only

---

## When This Protocol Applies

- Two models produce different implementations for the same task
- Code review from different models gives conflicting recommendations
- Architecture suggestions conflict between models

## When This Protocol Does NOT Apply

- Stylistic preferences → use project conventions
- Performance micro-optimizations → benchmark instead

---

## Integration

- Referenced from `quality-gates.md` (optional cross-model gate)
- Used by Opus orchestrator when synthesizing multi-model output
- Part of the cross-model consensus workflow (Phase 4)
