---
schema_version: 2
doc_type: spec
title: "Large-File Refactor Decomposition Spec"
status: active
created: 2026-06-03
owner: nick
related_documents:
  - .claude/plans/tiered-workflow-overhaul.md
  - .claude/skills/planning/SKILL.md
  - .claude/commands/dev/execute-contract.md
  - .claude/agents/dev/feature-sprint-executor.md
  - .claude/rules/context-budget.md
  - .claude/rules/delegation-modes.md
---

# Large-File Refactor Decomposition Spec

How to plan and execute refactors that **delete, relocate, split, or substantially rewrite a single large file** (>~2K lines; >5K is the danger zone) without blowing a subagent's context.

## Why this spec exists

A Tier 1 `execute-contract` autonomous sprint was tasked with deleting a **10,156-line** `_legacy.py` API route shim. The single sprint agent **blew context** ("Prompt is too long") at ~59 tool-uses — it had extracted route handlers into new files but completed **none of the wiring**, because it could not hold the giant source + its call-sites + edit targets in one context window. The work was only delivered after Opus recovered it via manual file-ownership-first decomposition.

**Root cause:** story points size *behavior change*; they do not size *agent context*. A whole-file move/deletion forces an agent to comprehend the entire file at once. No single-agent sprint can do that for a multi-thousand-line file.

## Classification rule (apply at planning time)

| Work shape | Classify as |
|---|---|
| Localized edit inside a large file (a few functions / one section) | Normal tier by points |
| Delete / relocate / split / substantially rewrite a file **>~2K lines** | **Tier 2 minimum**, regardless of points |
| Same, file **>5K lines** | **Tier 2 always**, mandatory decomposition (this spec) |

`wc -l` every candidate file at planning time. This override is encoded in:
`tiered-workflow-overhaul.md` §2.1, `planning/SKILL.md` Tier Matrix, `execute-contract.md` Scope Check + Pre-Flight (large-file guard), and the `feature-sprint-executor` sprint-sequence / Blocker Protocol.

## The decomposition pattern (the recovery that worked)

Drive this as a Tier 2 multi-phase plan (Opus orchestrates; sonnet subagents own one file each).

### Phase 0 — Faithfulness assessment (READ-ONLY, before any edit)

If any extraction/relocation already exists (e.g. a partial from a crashed sprint), or before relocating anything, verify the moved code is an **exact copy** of the original.

- Delegate to a read-only agent (`codebase-explorer` / `Explore`, Mode A).
- **Grep-locate each symbol** in the giant file and compare **signatures + key lines only**. Explicitly instruct the assessor **NOT to read the large file top-to-bottom** — it will blow context too.
- Output: per-symbol "faithful copy / diverged" table. **Faithful partial extractions are salvageable — assess before discarding.**

### Phase 1..N — File-ownership-first batches

Decompose remaining work so **each batch owns exactly ONE target file** (the hard file-contention rule from CLAUDE.md MEMORY — never two parallel agents on one file).

Prefer **minimal-edit rewiring** over rewrites:
- To redirect call-sites off the old module, swap the **import target**, not the call sites:
  `from . import legacy as _alias` → `from . import new_module as _alias` (zero call-site edits).
- Move helpers/handlers **verbatim** (copy exact line ranges), then fix only imports at the new home.
- Delete the shim + its registration (`__init__.py` includes, filter loops, frozensets) in a final dedicated batch.

Each batch: small prompt, file path + exact line ranges, no embedded source. Commit incrementally if the work spans many batches.

### Anti-blow guardrail block (paste into impl-agent prompts when a >2K-line file is in scope)

Any impl-agent task touching a file >2K lines (whether a refactor or an in-place edit per estimation heuristic H7) MUST carry this guardrail block in its prompt:

```text
GUARDRAIL — large file in scope (<path>, <N> lines):
- Do NOT read <path> top-to-bottom. Use `grep -n <symbol> <path>` + `sed -n 'A,Bp' <path>` to load ONLY the line ranges you edit.
- Budget ≤40 tool uses. If you approach the budget, STOP and report partial state on disk (which symbols done, which remain) — do NOT push through a context-blow.
- Faithful partial work survives a blow; a fresh finisher agent can complete it. Leaving usable on-disk state is the correct failure mode.
```

### Final phase — Gate on the REAL acceptance check

For relocation/wiring refactors, "tests pass" is necessary but **not the primary gate**. The primary gate is **behavioral/surface identity**:

- **API route work** → OpenAPI route-surface identity. Generate the spec before and after; assert **0 paths added/removed/changed, identical components + operationIds**. Use a **stash-to-baseline diff**: `git stash push -u` to reach the pre-change tree, regenerate the spec, compare, restore.
- **Schema/model work** → migration/DDL diff identity.
- **Pure code move** → public-symbol export diff (what's importable must be unchanged).

### Independent verification discipline (do not take on faith)

- **Verify every "pre-existing failure" claim** via stash-to-baseline: run the suite on the pre-change tree and compare the **failing-ID set**. Only failures present *before* your change are pre-existing. (In the incident, 60 discovery failures were proven pre-existing by a byte-identical failing-ID set with the shim still present.)
- Expect a **`git stash pop` untracked-file collision** when you used `-u`; recover with `git checkout stash@{0} -- <paths>` rather than fighting pop. See `[[gotcha_stash_pop_untracked_collision_recovery]]`.
- Watch xdist/keyring failure inflation; verify suspect counts per-file with `--color=no`.

## Checklist

- [ ] `wc -l` ran on every file the work deletes/relocates/splits/rewrites.
- [ ] Any such file >~2K lines → classified Tier 2+ (NOT Tier 1 sprint).
- [ ] Phase 0 faithfulness assessment done read-only (no top-to-bottom large-file reads).
- [ ] Work decomposed file-ownership-first (one file per batch).
- [ ] Rewiring uses import-target swaps / verbatim moves, not rewrites, where possible.
- [ ] Final gate is surface/behavioral identity (route/schema/export diff), verified stash-to-baseline.
- [ ] Every "pre-existing failure" claim independently verified against the baseline tree.

## Cross-references

- `[[gotcha_execute_contract_large_file_blows_context]]` — the originating incident.
- `[[gotcha_subagent_context_blow]]` — general context-blow failure mode.
- `[[feedback_refactor_phase_gate_discipline]]` — Opus independent phase gate.
- `[[gotcha_stash_pop_untracked_collision_recovery]]` — stash recovery.
- `[[gotcha_xdist_keyring_crashes]]` — failure-count inflation.
