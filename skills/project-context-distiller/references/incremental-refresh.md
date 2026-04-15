# Incremental Refresh

Read when `mode=refresh`. Use when artifacts already exist in `output_dir` and the repo has evolved since last generation.

## Goal

Update existing artifacts in place rather than regenerate from scratch. Preserve human edits, open questions, and validated findings.

## Procedure

1. **Load existing artifacts**. Read all four files from `output_dir`. Note any section that appears hand-edited (deviations from template skeleton, added prose).
2. **Detect repo delta**. Use `git log --since=<last-refresh-date>` or compare mtimes against the artifact's own frontmatter/last-generated marker. Get the list of changed files.
3. **Map delta to artifact sections**:
   - Changed feature files → catalog feature entries.
   - Changed architecture docs / ADRs → fundamentals artifact.
   - Changed PRDs or roadmap docs → opportunity map + "Planned" maturity features.
   - New top-level directories / services → inventory and catalog.
4. **Re-run Phases 2, 4, 5** scoped to changed surfaces only. Do NOT re-run Phase 1 globally unless top-level structure changed.
5. **Update sections in place**. Use Edit, not Write — preserve surrounding content.
6. **Preserve Open Questions**. Never drop an open question unless explicitly resolved. Mark resolved ones with `RESOLVED (<date>):` prefix and keep them for one refresh cycle before removing.
7. **Update confidence levels**. If new evidence strengthens an `inference`, promote it and note the new evidence. If new evidence contradicts, demote it or flip to `open question`.
8. **Re-run Phase 8** (contradiction sweep). Old contradictions may have been resolved; new ones may have appeared.
9. **Update last-refreshed marker**. Add or update a top-of-file comment: `<!-- last refreshed: YYYY-MM-DD by project-context-distiller -->`.

## What to preserve

- Hand-written sections that go beyond the template skeleton.
- Open questions unless explicitly resolved.
- Cross-references between artifacts.
- Glossary entries (rarely change; additive only).

## What to regenerate

- Feature maturity labels (state drifts fastest).
- Contradictions and stale-doc notes.
- Opportunity map (especially "Near-Adjacent Opportunities" which track current gaps).
- File path citations (paths get renamed).

## Schedule Configuration

Optionally configure refresh cadence via a `.claude/distiller-schedule.yaml` file at the repo root (path is configurable via env `DISTILLER_SCHEDULE_PATH`):

```yaml
# .claude/distiller-schedule.yaml
refresh:
  cadence: monthly          # monthly | weekly | on-merge | manual
  post_merge_hook: true     # run refresh after merges to main branch
  scope: full               # full | changed-only
  output_dir: .claude/context/distilled/
  counts_check: .claude/distiller-counts.yaml   # optional

# What changed since last refresh:
# git log --since=<ledger.last_refreshed> --name-only --pretty=format: | sort -u
```

**Post-merge hook pattern (`.git/hooks/post-merge`):**

```bash
#!/bin/bash
# Trigger distiller refresh after merges to main
SCHEDULE=".claude/distiller-schedule.yaml"
if [ -f "$SCHEDULE" ] && grep -q "post_merge_hook: true" "$SCHEDULE"; then
  echo "[distiller] Running incremental refresh..."
  # Invoke via Claude CLI or CI job — do not block the merge hook
fi
```

**"What changed since last refresh" workflow:**

1. Read `last_refreshed` from ledger frontmatter: `ledger.last_refreshed` (ISO 8601 date).
2. Get changed files: `git log --since=<date> --name-only --pretty=format: | sort -u`
3. Map changed files to artifact sections using the delta mapping in this document (step 3 above).
4. Re-run only the affected phases for those sections.

The ledger is the authoritative store of the refresh timestamp. Update it on every full or incremental run:

```yaml
# .ledger.yaml (excerpt)
meta:
  last_refreshed: "2026-04-11"
  distiller_version: "1.1"
  mode: incremental
  changed_files_since_last: 14
```

## Report delta

When refresh completes, report to the user:
- Files touched by refresh.
- New features added to catalog.
- Features whose maturity changed (with old → new label).
- Resolved open questions.
- Newly discovered contradictions.
- Sections left untouched (so the user knows what was preserved).
