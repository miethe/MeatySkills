# Quick Fix Mode

For Simple and Moderate severity bugs. Fast, focused, delegated.

**When to use**: Severity is Simple or Moderate. Root cause is clear. Fix is 1-5 files.
**When NOT to use**: Severity is Complex/Critical, root cause unclear, or fix requires architectural changes. Use [comprehensive-remediation.md](./comprehensive-remediation.md) instead.

**Prerequisites**: Triage completed (or bug is obviously simple — inline triage is fine).

---

## Workflow

### 1. Verify Severity

Confirm the bug is Simple or Moderate:
- Root cause is identified
- Fix is contained to 1-5 files
- No API contract changes
- No new patterns needed
- No enterprise/local divergence

If any of these fail, **redirect to Comprehensive mode**.

### 2. Select Agent

Choose the fix agent based on bug domain. Quick reference:

| Domain | Fix Agent |
|--------|-----------|
| Python/FastAPI | python-backend-engineer (sonnet) |
| React/Next.js | ui-engineer-enhanced (sonnet) |
| TypeScript backend | backend-typescript-architect (sonnet) |
| Database/SQLAlchemy | data-layer-expert (sonnet) |
| API contracts | python-backend-engineer (sonnet) |
| Build/Config | platform-engineer (opus) |

Full routing: `../references/agent-routing.md`

### 3. Delegate Implementation

**Single-file fix**:

```
Task("[AGENT]", "Fix [BUG_DESCRIPTION]:

Location: [FILE_PATH]
Root Cause: [ROOT_CAUSE]
Required Changes:
- [CHANGE_1]
- [CHANGE_2]

Pattern Reference: [path to similar existing code to follow]

Constraints:
- Follow existing patterns (don't introduce new ones)
- Do NOT create validation reports or temp scripts
- Do NOT add temporary test files
- Commit: fix([component]): [description]")
```

**Multi-file fix** (2-5 files):

Group by file ownership — 1 agent per file when possible:

```
# Batch 1 (parallel — no file overlap)
Task("[AGENT_A]", "Fix [part 1] in [FILE_A]: ...")
Task("[AGENT_B]", "Fix [part 2] in [FILE_B]: ...")

# Batch 2 (depends on batch 1)
Task("[AGENT_C]", "Update tests for fix in [TEST_FILE]: ...")
```

**Key delegation rules**:
- Task prompt < 500 words — provide file paths, not contents
- Never have 2 agents edit the same file in parallel
- Don't call `TaskOutput()` for file-writing agents — verify on disk
- Reference existing patterns by path: "follow pattern in `path/to/example.py`"

### 4. Validate

**For 1-2 file changes** — Opus can run directly:

```bash
# TypeScript
pnpm test && pnpm type-check && pnpm lint

# Python
pytest -x && mypy skillmeat --ignore-missing-imports
```

**For 3+ file changes** — delegate validation:

```
Task("task-completion-validator", "Validate fix for [BUG]:

Files changed: [list]
Expected behavior: [what should work now]
Run: [specific test commands]
Check: [specific assertions]

Do NOT create validation reports or temp scripts.")
```

### 5. Cleanup

Before committing, ensure NO temporary artifacts remain:

```bash
# Check for untracked artifacts
git status --porcelain | grep "^??"

# Remove any that slipped through
rm -f VALIDATION_SUMMARY.txt CODE_VERIFICATION_REPORT.md
rm -f *.screenshot.png debug-*.json
```

### 6. Document

Update bug-fixes doc and request log using the automation script:

```bash
# After committing: updates both bug-fixes doc + request-log item
.claude/scripts/update-bug-docs.py --commits <sha> --req-log REQ-YYYYMMDD-skillmeat

# Preview first
.claude/scripts/update-bug-docs.py --commits <sha> --req-log REQ-YYYYMMDD-skillmeat --dry-run
```

If script unavailable, manual fallback:

```bash
mkdir -p .claude/worknotes/fixes
meatycapture log item update [DOC_PATH] [ITEM_ID] --status done
meatycapture log note add [DOC_PATH] [ITEM_ID] -c "Fixed in commit [HASH]. Root cause: [BRIEF]"
```

### 7. Commit

```bash
git add [specific files]
git commit -m "fix([component]): [brief description]

Root cause: [brief explanation]
Resolves: [REQ-ID if applicable]"
```

---

## Strict Rules

- **NO** temporary validation scripts
- **NO** VALIDATION_SUMMARY.txt, CODE_VERIFICATION_REPORT.md, or similar
- **NO** screenshots, reports, or artifacts committed (outside bug-fixes doc)
- **NO** implementing as Opus — always delegate
- **DO** use existing test infrastructure only
- **DO** delete any temp artifacts before commit
- **DO** verify changes on disk, not via TaskOutput()

## Quality Checklist

- [ ] Root cause identified and documented
- [ ] Fix implemented via subagent delegation
- [ ] Existing tests pass (pnpm test / pytest)
- [ ] Type checking passes (pnpm type-check / mypy)
- [ ] No temporary artifacts committed
- [ ] Bug-fixes document updated
- [ ] Request log updated (if applicable)
- [ ] Clear commit message with component scope and root cause
