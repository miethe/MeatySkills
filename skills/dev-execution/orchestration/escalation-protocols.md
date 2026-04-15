# Escalation Protocols

## Debug Escalation Protocol

**Trigger**: After `models.codex.debug_escalation_threshold` (default: 2) failed debug cycles with Claude
**Model**: GPT-5.3-Codex, reasoning `xhigh`, sandbox `workspace-write`
**Behavior**: Always `ask` — never auto-escalate to external model for debugging

### Codex Debug Prompt Template

```
Independent debugging investigation.
Error: {description}
Stack trace: {trace}
Already tried: {approaches}
Files of interest: {paths}

Investigate independently. Do not assume previous conclusions are correct.
Find the root cause and propose a minimal fix.
If you can reproduce the issue in sandbox, do so.
IMPORTANT: Re-check your proposed fix against the actual repo state
before finalizing — do not overfit to your initial hypothesis.
```

### Why Codex for Debug

- True sandbox isolation for safe execution and testing
- 400K context handles large log dumps
- "Re-check" instruction mitigates known overfitting tendency

### Orchestration Flow

1. `ultrathink-debugger` reports failure after N cycles
2. Opus presents options to user:
   a. Continue with Claude (different approach)
   b. Escalate to Codex (independent investigation, `xhigh`)
   c. Escalate to Gemini (`codebase_investigator` analysis)
3. User selects approach
4. If Codex: invoke with full error context + list of already-tried approaches
5. Opus evaluates Codex root cause analysis
6. If fix proposed: delegate implementation to `python-backend-engineer` or `ui-engineer-enhanced`
7. Run tests to verify fix

---

## Thinking/Effort Escalation Rules

### Escalation Within Claude

- Default: adaptive thinking (let model decide depth)
- Escalate to extended thinking ONLY when:
  1. Task is **blocked** (not just "hard")
  2. You have **concrete artifacts** to reason over (failing tests, stack traces, conflicting requirements)
  3. Adaptive thinking was attempted first and was insufficient
- "Hard problem" alone is NOT sufficient justification
- `budget_tokens` is **deprecated** on Opus 4.6 — use effort controls instead

### Codex Effort Escalation

| Level | When to Use |
|-------|-------------|
| `none` | Pure mechanical execution (formatting, simple refactoring) |
| `medium` | Default for implementation tasks |
| `high` | Plan generation, initial debugging |
| `xhigh` | Blocked debugging with concrete artifacts only |

---

## Review Escalation

When Claude code review is insufficient:

| Condition | Escalation |
|-----------|------------|
| Files changed > `thresholds.files_changed_suggest_review` (default: 10) | Suggest Codex review |
| Security-sensitive patterns detected | Suggest Codex review |
| Architecture change | Suggest Gemini codebase analysis |
| User explicit request | Any model |

All review escalations are suggestions — user decides.
