# Image handoffs: generation, textual slides, edits and asset sets

## 1. Select the output kind

Use `slide`, `diagram`, `icon`, `web_graphic`, `infographic`, `illustration`, `ui_mockup`,
or `other`. State the actual use: an image for a slide, a native presentation, a web hero,
a transparent reusable icon, or a visual reference for local implementation. A request
for editable objects should route through artifact creation, possibly after image assets.

Each image spec has an output ID, kind, operation (`generate` or `edit`), composition brief,
exact text blocks, aspect ratio, target pixels, background, profile ID, overrides,
negative constraints, visual consistency instructions and actual input references.
Image specs may vary within a batch but should share a selected style and quality bar.

## 2. Exact text is data, not artistic direction

`text_mode` is `exact`, `editable_overlay`, or `none`. `exact_text` is an ordered list of
`id`, `region`, `text`, and `emphasis`. Preserve punctuation, capitalization, spelling,
numbers, product names and line breaks. Place each block once. Do not copy guidance
or source citations into the image unless those strings are explicitly in this list.
Empty lists are allowed only with `none` or `editable_overlay`; `exact` needs text.

For a slide, freeze a title, optional subtitle, short body blocks, labels and footer.
Supply an ordered reading path and describe which labels connect to which objects.
Avoid trusting image generation to carry dense legal text, small tables, numerous figures,
or exact chart geometry. Use an image background plus a later native text overlay when
accuracy or editability matters more than unified raster composition.

Text density warning heuristic: review a slide above roughly 70 words, an icon above zero,
and an infographic above roughly 150. These are local design heuristics, not platform caps.
Review every generated string visually. Numeric data and diagram edges need independent
checks; correct-looking artwork is not evidence of correct values or relationships.

## 3. Design resolution

Precedence: approved actual template → explicit image overrides → selected profile → neutral
fallback only when allowed. The profile is resolved and copied into each rendered prompt.
`brand_mode: template_exact` requires `template_input_id` for an actual attached file.
A filename from a prior chat is not sufficient. With a PPTX/PDF template, attach direct
PNG reference slides as well when exact visual interpretation matters.

Use `work.ibm-consulting-light.v1` as a user-preference-based starting point, not an official
IBM brand specification. Strict work-template matching requires the real template. Do not
invent logos or redistribute font files. Use provided authentic assets, or omit them.
Personal styles are explicitly selected; Fiber & Glass is not the default for every
personal project. An inline custom profile must contain sufficient concrete tokens.

## 4. Geometry, transparency and deliverable truth

`aspect_ratio` is an explicit W:H string; `target_pixels` are desired dimensions, not a
promise the image service will return exact pixels. QA measures actual dimensions and
performs only approved resize/crop transformations. Preserve the original as a separate file.
`background` has `mode: solid|transparent` and a color when solid. Transparency means an
actual alpha channel with transparent pixels, not a checkerboard painted into an opaque PNG.
Export JPEG only for opaque images. For icons, define stroke/fill style, optical padding,
view direction, visual weight, and whether each icon is a separate output or an explicit atlas.

Do not claim native SVG/PPTX editability for generated raster artwork. For a UI mockup,
state component states, responsive breakpoints, actual on-screen strings and design tokens;
local implementation remains a separate deliverable. For diagrams, declare node/edge
semantics in text or structured data outside the artwork as the validation authority.

## 5. Batch and sequence policy

The operator requested a ceiling of ten images per turn. Official documentation checked
for this release did not establish that as a universal generation limit. The registry
therefore records it as an operator ceiling, with actual session limit unknown. Use four
images as the default working batch for text-heavy output; reduce further for complexity.
The effective batch must not exceed any known lower live limit. Do not claim parallelism
or completion of queued turns without user interaction.

For 12 slides, the example uses three four-image turns, a visual review turn, then a
handback/export turn. Each generation turn ends with images only. There is no requirement
for the image-producing response to append JSON, a ZIP, a manifest or commentary.
Subsequent steps operate on actual images saved/reattached by the operator.

## 6. Edits and consistency

An edit must bind `source_input_id` to an accessible image file. Describe change regions,
unchanged regions, identity/layout constraints and allowed transformations. An uploaded
reference from another context must be brought into this conversation before use. Where
an actual person's likeness is required, supply their authorized reference and follow
current product requirements; do not synthesize a claimed exact likeness from biography.

Freeze an approved style anchor image before a larger set when consistency is critical.
Pass it into later turns as an actual input. Record the selected variant's output ID and
local file hash. Never identify variants solely as “the good one above.” For a failed image,
regenerate that output ID with a revision suffix and preserve the earlier original.

## 7. QA and local handback checklist

Compare exact text, layout, counts, diagram directions, color intent, crop, padding,
actual size, alpha, forbidden additions and consistency. Use a contact sheet for navigation,
not as a substitute for individual deliverables. Human inspection remains required for
text and visual semantics; machine checks can verify dimensions, alpha and file integrity.

Store output ID → saved filename → SHA-256 → actual dimensions → variant/approval status.
The final Chat export can propose this mapping but the local agent verifies the bytes.
Missing originals are `partial`, not complete merely because a preview is visible in chat.
