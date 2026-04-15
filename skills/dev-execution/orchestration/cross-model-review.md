# Cross-Model Review Checkpoints

SDLC workflow spec for Plan Review (Codex) and PR Cross-Validation (Gemini).
Config source: `.claude/config/multi-model.toml`

---

## Checkpoint Overview

| Checkpoint | Trigger Point | Default Model | Default Behavior | Config Key |
|------------|---------------|---------------|------------------|------------|
| Plan Review | After PRD/plan generation | GPT-5.3-Codex | `ask` | `checkpoints.plan_review` |
| PR Cross-Validation | Before PR creation | Gemini 3.1 Pro / Flash | `ask` | `checkpoints.pr_cross_review` |

Both checkpoints output findings to Opus for synthesis. Neither auto-applies changes.

---

## 1. Plan Review (Codex)

### When to Invoke

```
checkpoints.plan_review = "ask"   → prompt user before running
checkpoints.plan_review = "auto"  → run automatically if plan has >20 tasks
checkpoints.plan_review = "off"   → skip entirely
```

Fits after: `/plan:plan-feature`, `/dev:execute-phase` plan generation step.

### Model Parameters

| Parameter | Value |
|-----------|-------|
| Model | `gpt-5.3-codex` (`[models.codex].default_model`) |
| Reasoning | `medium` (`[models.effort_policy].plan_review.codex`) |
| Sandbox | `read-only` (`[models.codex].sandbox_default`) |
| Cost estimate | ~$0.05–0.15 per review (400K context, read-only) |

### Prompt Template

```
Review this implementation plan for:
1. Missing edge cases or error scenarios
2. Security gaps in the proposed approach
3. Feasibility concerns (over-engineering, missing dependencies)
4. Task ordering issues (dependency conflicts)
5. Missing test coverage areas
Output structured feedback as: PASS / CONCERN (with details) / BLOCK (with rationale)
```

### Invocation

```
codex exec --model gpt-5.3-codex --reasoning medium --sandbox read-only \
  --prompt-file <prompt_template> --input <plan_file_path>
```

### Output Handling

| Output | Opus Action |
|--------|-------------|
| `PASS` | Approve plan, proceed to implementation |
| `CONCERN` | Evaluate each concern; incorporate valid ones before approving |
| `BLOCK` | Address blocker; re-run review or override with explicit rationale |

### Orchestration Steps

1. Check `checkpoints.plan_review` in `.claude/config/multi-model.toml`
2. If `"ask"` → surface to user: _"Plan has N tasks. Run Codex plan review? [y/N]"_
3. If `"auto"` AND task count > 20 → proceed without prompting
4. If `"off"` → skip; continue to implementation
5. Invoke codex skill with plan file path as input (not contents)
6. Collect structured PASS/CONCERN/BLOCK output
7. Opus evaluates findings and incorporates before marking plan approved

---

## 2. PR Cross-Validation (Gemini)

### When to Invoke

```
checkpoints.pr_cross_review = "ask"   → prompt user before running
checkpoints.pr_cross_review = "auto"  → not recommended; keep as "ask"
checkpoints.pr_cross_review = "off"   → skip entirely
```

Auto-suggest (within `"ask"` mode) when changed files match `thresholds.security_sensitive_patterns`.
Fits before: `/pm:pre-pr-validation` PR creation step.

### Model Selection Logic

```
files_changed ≤ 5  AND  no security patterns  →  gemini-3-flash
files_changed > 5  OR   security patterns detected  →  gemini-3.1-pro
user override ("use Codex for this review")  →  gpt-5.3-codex, read-only sandbox
```

Config references:
- `[models.gemini].default_model` = `gemini-3.1-pro`
- `[models.gemini].fast_model` = `gemini-3-flash`
- `[thresholds].files_changed_suggest_review` = `10`
- `[thresholds].security_sensitive_patterns` = auth, crypto, token, password, secret, injection, sanitiz, escap

### Prompt Template

```
Review this diff for:
1. Bugs or logic errors
2. Security vulnerabilities (OWASP top 10)
3. Performance regressions
4. Missing error handling
5. Style inconsistencies with surrounding code
Use Google Search if you need to verify API usage or library patterns.
Output: LGTM / ISSUES (with file:line references)
```

### Output Discipline

- Use `-o text` flag on all Gemini invocations
- `[models.gemini].max_output_tokens` = 65536; chunk diffs above `chunking_threshold` (32000 tokens)
- Chunking: split diff by file; run one Gemini call per chunk; merge LGTM/ISSUES lists

### Orchestration Steps

1. Check `checkpoints.pr_cross_review` in `.claude/config/multi-model.toml`
2. If `"off"` → skip
3. Grep changed files for `thresholds.security_sensitive_patterns`
4. Count files changed in the diff
5. Select model: Flash (small, no security) vs Pro (large or security patterns)
6. If `"ask"` → surface to user: _"N files changed[, security patterns detected]. Run Gemini PR review? [y/N]"_
7. Invoke gemini-cli skill with diff as input; use `-o text`; chunk if needed
8. Present LGTM/ISSUES findings alongside Claude's own review summary
9. Opus synthesizes both reviews; never auto-applies Gemini suggestions

---

## 3. Interaction Patterns

### Pattern A — Ask (Default)

```
Opus: "Plan has 23 tasks including auth middleware.
       Recommend Codex plan review (medium reasoning, read-only). Run? [y/N]"
User: "y"
→ Codex reviews → returns PASS/CONCERN/BLOCK
→ Opus incorporates feedback → plan approved
```

### Pattern B — Auto (Plans >20 Tasks)

```
Config: plan_review = "auto"
Plan has 25 tasks
→ Opus runs Codex review without prompting
→ If BLOCK returned → surfaces to user for resolution
```

### Pattern C — User Override (Always Honored)

```
User: "Use Codex for the PR review this time"
→ Opus routes to Codex (gpt-5.3-codex, read-only) regardless of config
→ No config check required for explicit user requests
```

---

## 4. Integration Points

| Workflow Step | Checkpoint | Preceding Command | Gating Behavior |
|---------------|------------|-------------------|-----------------|
| Plan approved | Plan Review | `/plan:plan-feature` | Block on BLOCK; warn on CONCERN |
| PR created | PR Cross-Validation | `/pm:pre-pr-validation` | Present findings; Opus decides |

Both checkpoints are **advisory to Opus**, not gating automation. Opus synthesizes and decides.

---

## 5. Configuration Reference

All values read from `.claude/config/multi-model.toml`:

| Key Path | Relevant To |
|----------|-------------|
| `[checkpoints].plan_review` | Plan review behavior (ask/auto/off) |
| `[checkpoints].pr_cross_review` | PR review behavior (ask/auto/off) |
| `[models.codex].default_model` | Codex model for plan review |
| `[models.codex].default_reasoning` | Reasoning level (overridden to `medium` for plan review) |
| `[models.codex].sandbox_default` | Sandbox mode (`read-only`) |
| `[models.gemini].default_model` | Gemini Pro for large/security PRs |
| `[models.gemini].fast_model` | Gemini Flash for small PRs |
| `[models.gemini].max_output_tokens` | Output ceiling; triggers chunking |
| `[models.gemini].chunking_threshold` | Token count above which diffs are split |
| `[models.effort_policy].plan_review` | Effort level per model for plan review |
| `[thresholds].security_sensitive_patterns` | Patterns that promote PR review to Pro |
| `[thresholds].files_changed_suggest_review` | File count threshold for auto-suggest |
