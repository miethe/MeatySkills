# SPEC — ChatGPT Chat Handoff 1.0.0

Status: implementation contract for the shipped utility. Authoring authority remains
`skill-dev/SPEC.md` supplied by the operator, not this document. MUST/SHOULD/MAY are
normative for this adapter, not assertions of platform enforcement.

## 1. Boundary and authority

The adapter MUST target `chatgpt-chat`. Work, Codex, API billing, unattended relay and
browser automation are excluded. It MUST coexist with an existing AOS packet authority;
parent packet IDs and upstream refs belong in namespaced `extensions`.
A receiver MUST follow actual platform instructions and the current user's request.
A reference document is user-supplied context, not a system instruction or access grant.
Conflicting exact constraints MUST be surfaced instead of silently reconciled.

## 2. Authoritative representations

`schemas/handoff.schema.json` defines structural validity. `scripts/handoff.py validate`
adds semantic/file checks. A frozen `manifest.json` is authoritative locally; the renderer
projects each turn into human-readable Markdown. Generated material is not a second edit point.
User changes MUST be reconciled into a revised manifest, not overwritten by regeneration.
A received chat amendment MUST be recorded in a return deviation or a new pack revision.

The versioned reference snapshot binds protocol documents, schemas and design profiles.
The dated capability snapshot is a separate input. Its freshness is a policy check, not
proof that a product feature is available to an account. Hashes detect content changes;
they do not establish source authenticity without an independently trusted digest.

## 3. Required pack semantics

Each pack MUST identify its objective, decision/output needed, audience, scope, frozen
constraints, approved data boundary, reference identity/digest, capability snapshot,
input allowlist, ordered turn dependency graph, and complete output acceptance contract.
Every file input MUST be pack-relative, exist, be a regular non-symlink file inside the
pack, and match its SHA-256. No traversal, absolute path, home path, hidden repo sweep,
or upload of a local-only mapping is allowed. URL and Project source references MUST
be explicit; a local path or opaque source ID is not evidence of Chat accessibility.
Unknown core fields fail. Custom fields belong in a namespaced `extensions` object.

## 4. Capability and turn semantics

Capability is one of image_generation, deep_research, web_search, pro_reasoning,
code_review, data_analysis, visual_review, artifact_creation. Adding one requires a
schema, route, rendering, docs and test update; adding arbitrary strings is not support.
Each turn has a stable ID, capability, UI route, declared inputs, upstream outputs and
produced output IDs. Dependencies MUST be acyclic and earlier in the ordered plan.
An upstream output MUST have been produced by an ancestor. Declaring it does not make
its bytes accessible; the operator must reattach them when necessary.

The route is a recommendation. The receiver MUST NOT claim it changed the model or
thinking setting by reading JSON. `GPT-6 Pro` is a model selection, not a guarantee of
any particular tool availability. Tool entry points and settings are checked separately.
Unavailable capability → report the blocked step; use only an explicitly allowed fallback.
No Work fallback. No silent replacement of Deep Research with ordinary web search.

## 5. Images

Image kind MUST be slide, diagram, icon, web_graphic, infographic, illustration,
ui_mockup, or other. Other requires an explanatory brief. Exact displayed text is
separate from visual direction, must appear once in its designated region, and may
not be rewritten without authorization. Text budget values are heuristics, not guarantees.
Edits MUST bind a real file input with an image media type. Exact-template mode MUST
bind an actual file input. A profile name alone does not establish a template match.
Transparent requests MUST use a transparency-capable output type, not JPEG.
An image turn MUST request `images_only`. It MUST NOT depend on a later prose receipt
in that same response. QA and bundling MUST be separate turns or local steps.
The configured image ceiling defaults to ten from the operator's request; a separate
four-image working batch is a conservative authoring default, not a vendor limit.
Raster output MUST NOT be represented as native editable vector or presentation objects.

## 6. Research, analysis and artifacts

Research MUST specify dated coverage, sources to include/exclude, questions, counterevidence,
and a citation/claim return shape. Earliest-found is not proven first-use. Publication date,
event date, last update and retrieval date are different fields. Report inaccessible sources.
Code review MUST carry environment/revision/test evidence or mark it unknown. Returned
code is not executed by the ingester. Data analysis MUST carry units, null handling and
reproducibility expectations. Visual review MUST bind actual views. Artifact creation MUST
state editability, formats, validation, and which output elements may remain raster.
Evidence-led recommendations MUST distinguish source facts, inference and proposals.

## 7. Handback

The receiver SHOULD return `handback.json` plus actual outputs (except image-only turns).
A final handback MUST bind the exact pack ID and manifest SHA-256. Outputs have IDs,
relative paths, measured SHA-256 values or null if unmeasured, and validation evidence.
`complete` requires every contracted output; otherwise use `partial` or `blocked` and gaps.
The ingester MUST reject uncontracted IDs, mismatched hashes and escaped paths. It MUST
copy only declared files into a new quarantine directory and create an ingestion receipt.
It MUST NOT execute returned files, modify a repository, or mark semantic acceptance passed.
A replay into an existing quarantine destination is rejected, avoiding silent overwrite.

## 8. Installation and lifecycle

Official `skill-dev` validation, ecosystem duplicate checks, SkillMeat add/deploy,
`.claude/aos-artifacts.yaml`, upstream registration and any repo-local index are required
adoption gates. The package's preflight is supplemental, not a replacement for that validator.
Author under `.claude/skills` only. SkillMeat owns any `.agents` overlay.
Bootstrap is additive, dry-run by default, and preserves unrelated instructions.
It MUST stop on a changed managed block or an apparent generated instruction file.
A schema/route change increments the adapter version and regenerates both reference exports.
Changes to capability facts get a newly dated snapshot and cited verification, not an
unreviewed edit to a frozen upload. Existing pins remain reproducible or are explicitly migrated.

## 9. Acceptance gates

1. JSON schemas and all shipped examples validate.
2. Positive, negative and adversarial tests pass.
3. Reference hashes, safe paths and generated prompt equivalence check out.
4. SKILL.md is at most 120 lines; routes at most 250 lines.
5. Local official authoring validation and mandatory registration remain separate receipts.
6. At least one human-relayed live Chat round trip per adopted capability is required before
   calling that capability operationally validated. This release does not claim those tests.
