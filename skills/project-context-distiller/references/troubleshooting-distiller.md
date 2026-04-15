# Troubleshooting — project-context-distiller

Recovery recipes for common failure modes. Read when stuck during or after a distillation run.

---

## "Claim marked `[open]` but evidence seems present"

A claim ended up in Open Questions but you believe the codebase answers it.

**Step 1 — Targeted grep.**

```bash
# For a concrete symbol or concept
grep -rn "YourConceptHere" <repo_root>/skillmeat/ --include="*.py" -l

# For config/env patterns
grep -rn "FEATURE_FLAG\|is_enabled\|env.*YOUR_CONCEPT" <repo_root>/skillmeat/

# For test coverage (confirms a feature is tested, not just defined)
grep -rn "def test_.*your_concept" <repo_root>/tests/ -i
```

**Step 2 — Check supplemental classification.** A doc may have been classified `aspirational` when it should be `implemented`. Reread it with Phase 4 maturity signals in mind.

**Step 3 — Promote the claim.** If evidence is found:
- Change tag from `[open]` to `[inference M]` or `[evidence H]` depending on directness.
- Update the ledger: set `type` to `inference` or `evidence`, add `evidence_ids` reference.
- Add the citation inline in the artifact.

**Delegate the grep to a subagent** — orchestrator should not run file searches directly.

---

## "Contradicting signals between code and docs"

A doc says X; code implements not-X.

**Triage flowchart:**

```
Is the doc a PRD/ADR marked "proposed"?
  Yes → doc is aspirational; code is current. Mark doc [aspirational]. No contradiction.
  No  ↓

Is the doc's last modified date older than the relevant code commit?
  Yes → doc is stale. Code wins. Mark in artifact: "stale doc: <doc> claims X; <file>:<line> implements Y".
  No  ↓

Do they describe different scopes (e.g., doc = planned enterprise, code = current local)?
  Yes → not a contradiction. Clarify scope in both. Tag inference.
  No  ↓

Flag as genuine contradiction in Phase 8. Add to:
  - catalog "Known Gaps / TODO Signals"
  - fundamentals "Technical Debt / Fragility Signals"
Record: "doc <path> and code <path:line> conflict. Resolving evidence: operator confirmation."
```

---

## "Feature looks dormant but is used"

Git history shows no recent commits; maturity labeled `dormant` but it may still be active.

**Caller-discovery grep:**

```bash
# Python: find all import sites
grep -rn "from skillmeat.core.X import\|import skillmeat.core.X" <repo_root>/ --include="*.py"

# Find all function callers
grep -rn "function_name(" <repo_root>/skillmeat/ --include="*.py" -l

# API: find router registration
grep -rn "include_router\|router\." <repo_root>/skillmeat/api/app.py

# Frontend: find hook/component usage
grep -rn "useYourHook\|<YourComponent" <repo_root>/skillmeat/web/ --include="*.tsx" -l
```

If callers exist, promote maturity from `dormant` to `implemented` or `partial` and note the git staleness separately. Dormant means **no callers**, not just no recent commits.

---

## "verify.py fails path validation"

`verify.py --path-citations` reports unresolvable paths.

**Common causes:**

1. **Stale citation from refactor.** File was moved/renamed. Find new location:
   ```bash
   find <repo_root> -name "old-filename.py" 2>/dev/null
   git log --all --follow -- "old/path/file.py"
   ```

2. **Symbol suffix included in path.** Citation like `` `skillmeat/api/app.py:create_app` `` — the `:create_app` suffix is stripped by verify.py, but watch for nested colons or ranges with spaces.

3. **Relative vs absolute mismatch.** All citations must be repo-relative (no leading `/`). `skillmeat/api/routers/artifacts.py` is correct; `/skillmeat/api/routers/artifacts.py` is not.

4. **Path was in supplemental, not repo.** If the citation is to an external doc (NotebookLM export, etc.), skip validation by prefixing with `external:` or removing the backtick code formatting.

**Recovery:** Update the citation in the artifact and re-run verify.py. Do not auto-correct — human confirms the new path is semantically correct.

---

## "Orchestrator token budget blown"

The run consumed far more orchestrator tokens than the ~15K target.

**Diagnosis — which phase overran?**

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Phase 1 was verbose | Explore subagent returned full file contents, not summary | Tighten Phase 1 prompt: "return compact YAML summary only" |
| Phase 6 had long tagging loops | Evidence tagging done inline in orchestrator | Delegate tagging to a writer subagent with ledger path only |
| Phase 7 had 4 sequential writers | Writers ran sequentially, not in parallel | Single message with 4 Task() calls |
| Phase 9 used manual reading | Orchestrator read artifacts to self-review | Run verify.py instead; delegate review subagent if needed |
| `TaskOutput()` called on writers | Each call returns ~7.5K tokens of JSONL | Verify writers on disk (Glob) instead |

**Escalation checklist:**

- [ ] Phase 1 prompt says "compact YAML only, no prose, <2K tokens"
- [ ] Ledger is written to disk before Phase 7; writers receive only the path
- [ ] Phase 7 writers launched in single parallel batch (4 Task() in one message)
- [ ] `TaskOutput()` not called for any file-writing agent
- [ ] verify.py replaces manual artifact reading in Phase 9
- [ ] Subagent prompts are each <500 words (paths not contents)

If budget is still over, split the run: Phase 1–5 as one session writing the ledger, Phase 7–9 as a second session reading the ledger. The ledger is the handoff artifact between sessions.

---

## "Health Signals section is sparse"

The catalog's Health Signals section has few entries.

**Signal discovery grep set:**

```bash
# CI config presence
ls .github/workflows/ 2>/dev/null | wc -l

# Test coverage marker
grep -rn "coverage\|cov_report\|coveragerc" <repo_root>/ --include="*.toml" --include="*.ini" -l

# CHANGELOG presence and recency
git log --format="%ai" -- CHANGELOG.md | head -1

# Release cadence (count tags in last year)
git tag --sort=-creatordate | head -20

# Recent commit activity (commits in last 30 days)
git log --oneline --since="30 days ago" | wc -l

# Test matrix (GitHub Actions matrix)
grep -rn "python-version\|node-version" .github/workflows/ 2>/dev/null
```

Delegate the above to an Explore subagent; receive only the summary counts.
