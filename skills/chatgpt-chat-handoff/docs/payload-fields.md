# Typed payloads and handback fields

The JSON schemas shipped with the local skill are authoritative for types, required fields
and enums. This dictionary explains the receiver-facing meanings; it is not permission to
ignore unknown core fields. Additional integration metadata belongs in namespaced extensions.

## Image payload

| Field | Meaning |
|---|---|
| `images` | Ordered image specifications, exactly one per output ID |
| `return_mode` | Must be `images_only` |
| `output_id` | Stable mapping to a contracted output, not text to draw |
| `kind` / `operation` | Output use/type, and generate versus edit |
| `brief` | Composition, subject, semantics and placement |
| `text_mode` | `exact`: bake supplied strings; `editable_overlay`: leave space; `none`: no text |
| `exact_text` | Blocks with ID, region, exact text and emphasis; preserve order/content |
| `aspect_ratio` / `target_pixels` | Requested geometry; measure actual output later |
| `background.mode` / `.color` | Solid color or actual alpha transparency |
| `profile_id` / `overrides` | Resolve named profile, then apply explicit token overrides |
| `negative_constraints` | Elements or transformations to exclude |
| `consistency` | Cross-image style/identity/geometry constraints |
| `brand_mode` | Profile approximation or `template_exact` |
| `source_input_id` | Mandatory actual image-file binding for edits; otherwise null |
| `template_input_id` | Mandatory actual file binding for exact-template mode; otherwise null |

## Research and search payload

Both use `questions`, `as_of`, `date_window`, `source_policy`, `counterevidence`,
`output_structure` and `citation_contract`. The capability/route selects investigation depth.
`source_policy.mode` is primary_only, primary_preferred or source_bound; allow/exclude domains,
connected source names and access limits are explicit. A named source does not create access.
`as_of` is the factual cutoff, not necessarily the oldest/newest allowed publication date.

## Other payloads

| Capability | Fields and meaning |
|---|---|
| `pro_reasoning` | `decision`, `alternatives`, `evidence_policy`, `adversarial_questions`, `output_structure`, `reasoning_request` (concise rationale and checks) |
| `code_review` | `task`, `base_revision`, `environment`, `test_evidence`, `mutation_boundary`, `review_focus`, `output_structure` |
| `data_analysis` | `questions`, `data_dictionary`, `coverage`, `missing_values`, `method`, `reconciliation`, `output_structure` |
| `visual_review` | `review_target`, `criteria`, `severity_scheme`, `allowed_changes`, `output_structure` |
| `artifact_creation` | `build_brief`, `structure`, `native_requirements`, `raster_allowed`, `validation`, `output_structure` |

`test_evidence` records command, observed status (run_passed/run_failed/not_run), and result.
`environment` and `data_dictionary` allow descriptive keyed data; do not hide unstated output
requirements there. `mutation_boundary` is review_only, proposed_patch or sandbox_demo.
The artifact editability contract in `outputs` governs over vague requests to make it “editable.”

## Handback

| Field | Meaning |
|---|---|
| `protocol` / `protocol_version` | CGH/1 and 1.0.0 |
| `pack_id` / `manifest_sha256` | Exact frozen request being answered |
| `status` | complete, partial or blocked; do not overstate completion |
| `completed_turn_ids` | Finished plan steps with completed dependencies |
| `files` | Actual delivered IDs/paths, measured hash or null, validation records |
| `files[].validation` | `check`, `status` (pass/fail/not_run), `note`; facts rather than intended tests |
| `findings` | Outcome summaries or decision proposals |
| `deviations` | Authorized amendments, model/tool fallbacks or changed scope |
| `gaps` | Missing files, unresolved questions, failed inputs/tests or unavailable capabilities |
| `observed_execution` | model_label/thinking_label or null; basis operator_observed/session_exposed/unknown; tools_used |
| `extensions` | Namespaced optional AOS/integration records |

Exact return filenames may differ from requested names when the image UI chooses them;
output IDs retain identity. Completed means delivered, not automatically approved. The local
receipt always starts semantic acceptance at pending_local_review.
