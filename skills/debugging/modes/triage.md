# Triage Mode

Investigation and severity assessment. No implementation in this mode.

**When to use**: `--triage-only` flag, or as the first step of any debug workflow.
**When NOT to use**: If severity is already known and confirmed.

---

## Workflow

### 1. Git Context

Gather current state:

```bash
git status --porcelain
git log --oneline -5
git branch --show-current
```

### 2. Search Existing Tracking

Check if this bug is already tracked:

```bash
# Search request logs
meatycapture log search "$BUG_DESCRIPTION" . --json 2>/dev/null || echo "meatycapture not configured"

# Check existing fixes documentation
ls -la .claude/worknotes/fixes/ 2>/dev/null || echo "No fixes directory"
```

If already tracked, note the request log ID and any prior investigation.

### 3. Symbol-First Investigation

**Start with symbols** (150 tokens) before file exploration (5-15K tokens):

```bash
# Find the module/function related to the bug
grep "[error_name_or_function]" ai/symbols-*.json

# Get file paths and layer information
grep -A5 "[component_name]" ai/symbols-backend.json | grep "file_path"

# Check exports and dependencies
grep -B2 -A10 "\"name\": \"[module]\"" ai/symbols-*.json
```

**Decision tree** — when symbols aren't enough:
- Name not found in symbols → delegate to `codebase-explorer`
- Need implementation logic → delegate to `codebase-explorer` with targeted file list
- Need string literals/config → use Grep directly

Full methodology: `.claude/context/key-context/debugging-patterns.md`

### 4. Delegate Deep Investigation

**For pattern discovery** (2-5K tokens):

```
Task("codebase-explorer", "Find files and patterns related to: [BUG]
Focus on:
- Error messages and stack traces
- Related component files
- Test files that cover this area
- Configuration that might affect behavior
Start with these symbol hits: [paths from step 3]")
```

**For complex root cause analysis** (escalation — only when needed):

```
Task("ultrathink-debugger", "Analyze bug: [BUG]
Symbol context: [relevant symbol hits]
Files identified: [paths from codebase-explorer]
Initial hypothesis: [your hypothesis]
Provide:
- Root cause confirmation or alternative hypothesis
- Affected code paths (full chain)
- Fix strategies ranked by risk
- Risk assessment for each approach")
```

### 5. Severity Assessment

Apply classification from `../references/severity-assessment.md`:

**Quick checklist**:

| Dimension | Question | Score |
|-----------|----------|-------|
| Scope | How many files need changes? | 1-2 / 3-5 / 5+ |
| Root Cause | Is the cause clear from investigation? | Clear / Likely / Unclear |
| Arch Impact | Does the fix change patterns or contracts? | None / Minimal / Significant |
| Risk | Could the fix break other things? | Low / Medium / High |
| PRD Gap | Does this reveal a design gap? | No / Maybe / Yes |

**Classification**:
- **Simple**: All Low/Clear/None → Quick Fix mode
- **Moderate**: Mix of Low-Medium, cause is clear → Quick Fix + extra validation
- **Complex**: Any High/Significant/Unclear → Comprehensive mode
- **Critical**: Production impact OR rollback needed → Comprehensive (urgent)

**Upgrade triggers** (any one bumps to next level):
- API contract change (`skillmeat/api/openapi.json` affected) → at least Complex
- Enterprise/local edition divergence → at least Complex
- Introduces a new pattern not seen elsewhere in codebase → at least Complex
- Rollback strategy needed → Critical
- Data migration needed → Critical

### 6. Create Request Log

If this is a new bug not already tracked:

```bash
MC_STATUS=in-progress MC_PRIORITY=[SEVERITY] \
  .claude/skills/meatycapture-capture/scripts/mc-quick.sh bug [DOMAIN] [COMPONENT] \
  "[BUG_TITLE]" \
  "Root cause: [IDENTIFIED_ROOT_CAUSE]" \
  "Fix strategy: [PLANNED_APPROACH]"
```

### 7. Triage Output

Produce a structured summary:

```
## Triage Summary

**Bug**: [description]
**Severity**: [Simple | Moderate | Complex | Critical]
**Root Cause**: [hypothesis with confidence level]
**Affected Files**: [list of file paths]
**Affected Layers**: [router / service / repository / DB / frontend / config]
**Related PRDs**: [if found during investigation, or "none identified"]
**Risk Assessment**: [what could go wrong with a fix]

**Recommended Mode**: [Quick Fix | Comprehensive Remediation]
**Recommended Agent**: [primary agent for the fix]

**Request Log**: [REQ-ID if created]
```

If `--triage-only`, stop here. Otherwise, proceed to the recommended mode.
