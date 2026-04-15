# Evidence Standards

Read before Phase 6. Apply to every claim in every artifact.

## Claim taxonomy

Every statement in an artifact must be one of:

### `evidence`
A claim directly verifiable by reading a specific file, config, test, or docstring. Must cite the path.

Example: "The project exposes a FastAPI application registered at `skillmeat/api/app.py:create_app`."

### `inference`
A claim reasoned from one or more pieces of evidence but not stated directly anywhere. Must cite the underlying evidence.

Example: "The project prioritizes local-first development — inferred from the `local` edition being the default in `skillmeat/api/config.py` and the filesystem-backed repository implementations being the only ones registered in `dependencies.py`."

### `open question`
An unresolved ambiguity, gap, or unknown. Must state what evidence would resolve it.

Example: "Unclear whether multi-tenant row-level security is active in production — enterprise repos exist but no runtime toggle observed. Resolving evidence: deployment config or operator confirmation."

## Confidence levels

Attach one to every `evidence` and `inference` claim:

- **high**: multiple corroborating signals; unlikely to be wrong.
- **medium**: one strong signal or several weak ones; plausible alternative interpretations exist.
- **low**: single weak signal; stated because the question matters but the answer is shaky. Prefer to demote to `open question` if confidence drops below ~30%.

Never assert `high` confidence based on documentation alone when code contradicts or is silent.

## Citation format

Inline: `` `path/to/file.py` `` or `` `path/to/file.py:symbol_name` `` or `` `path/to/file.py:120-145` ``.

For directories: `` `skillmeat/api/routers/` ``.

For docs-vs-code contradictions: cite both, e.g. "`docs/architecture.md` claims X; `services/foo.py:bar` implements not-X".

## Anti-patterns to avoid

- **Restating README**: the catalog is not a README rewrite. Synthesize across code, config, and docs.
- **Unfalsifiable claims**: "The project values quality" — drop unless backed by specific test coverage, CI policy, or review rules.
- **Overclaiming from a single grep hit**: one `TODO` comment is weak evidence of a systemic gap.
- **Silent fabrication**: never invent file paths, function names, or configs. When unsure, mark as `open question`.
- **Promoting aspirational docs to evidence**: a PRD is evidence of intent, not implementation. Classify accordingly.

## Doc/code conflict resolution

When docs and code disagree:
1. Default: code wins. Record the doc as stale.
2. Exception: if the doc is explicitly forward-looking (PRD, ADR marked `proposed`, implementation plan), treat as aspirational, not stale.
3. Always log the conflict in the catalog's "Known Gaps" and the fundamentals artifact's "Technical Debt / Fragility Signals" sections.

## Confidence Uncertainty Bands

When a section of an artifact contains more than 30% `inference` claims, the writer must include a **Confidence Note** at the top of that section:

```
> **Confidence Note:** [X of Y] claims in this section are inferences rather than direct evidence.
> Supporting evidence: [cite the primary sources]. Recommend validation via: [what to check].
```

**Rule:** The Confidence Note names the supporting evidence and recommends a concrete validation step. It does not soften claims — it flags the epistemic state so downstream agents can calibrate.

**Thresholds:**
- >30% inference → Confidence Note required.
- >60% inference → demote entire section to `open question` status and move it to Open Questions, retaining a pointer.
- 100% inference with no cited evidence parent → the section must be marked `[open]` and not filled with speculative prose.

Writers apply this rule during artifact generation (Phase 7). The orchestrator does not re-read artifacts to check — verify.py enforces the tag coherence rule; the writer is responsible for the note.

## Maturity label discipline

Use these labels consistently:

| Label | Definition |
|-------|------------|
| `implemented` | Code exists, tests exist, appears in user-facing surface, no blocking TODOs. |
| `partial` | Code exists but has TODOs/NotImplementedError in primary path, or missing tests. |
| `experimental` | Explicitly flagged as beta/experimental, behind a feature flag, or in a `experimental/` directory. |
| `dormant` | Code exists but has no callers, not referenced in routes/CLI, stale git history. |
| `planned` | No code exists; only appears in PRDs, ADRs, or implementation plans. |

When in doubt between adjacent labels, pick the less-mature one and note the ambiguity in Open Questions.
