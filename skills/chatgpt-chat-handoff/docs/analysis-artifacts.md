# Pro decisions, code, data, visual review and editable artifacts

## Pro reasoning

Reserve a Pro consultation for expensive judgment: architecture tradeoffs, adversarial
review, research synthesis, failure analysis, constrained planning, or a difficult technical
proof/derivation. Specify the decision, alternatives, constraints, evidence, failure costs,
and required output shape. Include counterarguments and an explicit stopping condition.
A “thoughts?” prompt without a decision is not a well-bounded local-agent handoff.

The route `pro-decision` recommends GPT-6 Pro when available; it does not claim a separate
Extra High knob for that model. `reasoned-standard` recommends an available general
reasoning route for routine work. The operator checks the current UI, allowance and actual
tool compatibility. Never treat “use maximum effort” in prose as a verified UI setting.
Ask for concise rationale, assumptions, alternatives, checks and uncertainty, not private
chain-of-thought. A Pro answer is not an independent test or automatic approval.

## Code review and implementation proposals

Carry repository/revision, relevant tree, exact changed files, environment/runtime versions,
dependency constraints, API/schema contracts, local test commands/results, known failures,
and requested review scope. Mark missing details unknown. Provide a minimal reproducible
case rather than a whole repository by default. Do not include secrets or environment files.

Freeze the mutation boundary: review-only, proposed patch, or sandbox demonstration.
Chat cannot verify a local test merely by suggesting a command. Results must distinguish
`run_passed`, `run_failed`, and `not_run`. Return runnable source files when requested,
with setup instructions, error handling, type hints where appropriate and a small self-test.
If producing patches, name the exact base revision; local application requires a clean
compatibility check. No local execution happens merely because the handback is imported.

## Data analysis

Provide actual CSV/XLSX/JSON data plus a dictionary: columns, types, units, timezones,
missing-value meanings, inclusion filters, sample scope and anonymization. Freeze desired
metrics, denominators, statistical assumptions and expected reconciliation totals. Tables
embedded as images are a weak input for exact computation; prefer structured source data.

Ask for code-backed calculations, reproducible transformations, descriptive output names,
and explicit handling of incomplete data. A stateful Chat runtime is not the local project
environment. Do not assume its Python can access the internet, private network or arbitrary
package repositories. Supply external data via approved uploads or available authorized tools.

For an XLSX deliverable, define sheets, formulas versus values, number formats, units,
filters/freeze panes, validation and formula checks. Request the workbook itself rather
than just a screenshot. In a chart, preserve data semantics independently of visual style.

## Visual review

Bind actual image inputs or prior output images. Define the target artifact/version,
view IDs, check criteria, severity levels and whether annotations are allowed. Screenshots
should include a matching viewport/scale. Use original slides/documents for structure and
PNG exports for visual inspection when needed; do not assume retrieval sees embedded images.

Return issue ID, exact view/region, observed problem, why it matters, concrete repair,
severity and acceptance test. Separate a visual defect from a semantic/content defect.
Do not claim an unseen page was inspected. A contact sheet is navigation, not proof that
all small text was checked. Freeze approved content so polishing does not become a rewrite.

## Artifact creation

Specify each output format and editable/raster boundary. Examples: a native PPTX with
editable text and connectors, a mixed PPTX with a complex approved raster diagram, a DOCX
with styles/tables, a PDF proof, a formula-bearing XLSX, Markdown, source code, or ZIP.
Ask for actual files, a source/editability map, validation notes and unresolved defects.

Separate narrative, visuals, implementation and evidence. For slides, preserve slide order,
exact copy, layout geometry, master/theme intent, approved imagery and talk-track mapping.
A presenter guide should map one-to-one to the target deck version, not a remembered earlier
version. A generated slide image does not become fully editable by being placed in PPTX.

Validation must match the format: render and inspect every slide/page where feasible,
check text overflow, missing glyphs, misaligned icons, chart values, broken links and object
editability. For code/config, parse/lint/self-test. For archives, list contents and verify
paths/hashes. The receiver's installed authoring skills or tools should own format-specific
implementation; this handoff skill does not duplicate a PPTX or spreadsheet authoring stack.

## Other capabilities and deliberate exclusions

Supported connected sources can be included in inputs for research/analysis when their
actual tools are available and authorized. The pack does not grant access or authorize
writes. Consumer/enterprise approvals must match the actual destination.
Voice, video, scheduled tasks, Work agents, API batch jobs and browser control are not
first-release execution routes. Add them through the extension process only after contracts
and tests exist. Do not infer availability from a Pro subscription label alone.
