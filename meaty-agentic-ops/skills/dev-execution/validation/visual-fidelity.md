# Visual-Fidelity Gate (sketch/mockup-faithful UI work)

A gate for any phase that rebuilds or restyles UI against a **visual reference**
(design sketches, Figma frames, mockup PNGs). Behavioral gates — `tsc`, ESLint,
vitest, a11y — **never** catch a screen that compiles cleanly but looks wrong, is
missing an element, or silently renders zeros. This protocol is how you catch it.

Distilled from the Command Center v3 visual-rebuild AAR (2026-06-11). Every step
below maps to a real failure or a real save from that run.

> **Scope.** Run this gate when `ui_touched` **and** a visual reference exists.
> Capture tooling is owned by the `chrome-devtools` (Puppeteer) and `demo-foundry`
> (Playwright) skills — **delegate capture to them, don't reinvent it here.** This
> doc owns the *review discipline* that wraps capture. The capture mechanics
> (Playwright-to-disk, dnd-kit pointer choreography) are in the
> `playwright-visual-review-capture` project memory.

---

## The five-step protocol

### 1. Capture by structure, assert identity — never trust a text selector

The only P0 of the v3 run was self-inflicted: a capture script used
`get_by_text("Northwind Web Redesign").first`, which matched an *active item card*
that reused the same title as the *project row* it meant to click. The reviewer
then judged a screen that was never captured.

- **Select by structural class / `data-testid`, never by visible text.** Seeds and
  demos reuse titles across entity types; text selectors silently bind the wrong node.
- **Assert a screen-identity marker before screenshotting.** Wait for / assert an
  element unique to the target surface (an expected header class, a route-scoped
  test-id) so a wrong-surface capture **fails loudly** instead of producing a
  plausible-but-wrong artifact.
- See R11 in the same AAR (and the seed-distinct-titles lesson): give demo entities
  **distinct titles across types** so neither capture nor reviewer language is ambiguous.

```js
// WRONG — binds whichever node renders this text first
await page.getByText("Northwind Web Redesign").first().click();

// RIGHT — structural selector + identity assertion before the shot
await page.locator('[data-testid="project-row"][data-project-id="proj_nw"]').click();
await expect(page.locator('.project-drilldown__header')).toBeVisible(); // identity gate
await page.screenshot({ path: 'review-shots/s3-project-drilldown.png' });
```

### 2. Capture to disk with delegate-visible artifacts

- **Playwright-to-disk** (system Python + cached browsers) is the capture mechanism:
  the PNGs land on disk where a downstream review delegate can `Read` them.
- **Chrome MCP screenshots are invisible to delegates** — they live in the
  orchestrator's tool stream, not on disk. Never hand a reviewer a Chrome-MCP shot.
- **dnd-kit / drag flows need manual pointer choreography** (`page.mouse.down/move/up`);
  `page.drag_and_drop` fails on dnd-kit sensors. Pattern: `playwright-visual-review-capture` memory.

### 3. Region-crop the build shots before dispatching a reviewer (R1 — highest leverage)

The Read-tool image pipeline **downsamples** full-page shots (a 1600×1000 PNG comes
back illegible). Four of the v3 reviewer's "missing element" findings were elements
that existed but were too small to read — the reviewer had zoom crops of the
*sketches* but only a downsampled full-page image of the *build*. **Asymmetric
evidence quality produces asymmetric errors.**

- Auto-generate **region crops of the build shots** on the *same tile grid* you used
  to crop the reference sketches (e.g. a 6-tile grid per screen).
- Never make a reviewer judge fine detail from a single full-page image. Pair each
  sketch crop with the matching build crop at the same zoom.

### 4. Spot-check capture correctness yourself, then dispatch the reviewer (R9)

Before spending a review delegate, the orchestrator spot-reads **1–2 interactive-state
shots** to confirm the captures show the surfaces they claim. Cheap insurance: the
unchecked s3 capture is exactly what produced the false P0 above.

- One opus-tier read-only delegate is the right reviewer (see `ica-delegate` — a
  free opus-ICA delegate carried the v3 adversarial review; paid subagents were not needed).
- Hand the reviewer **paired crops** (sketch ↔ build) per region, not full-page images.

### 5. Adjudicate every finding against zoom crops before writing code (R3 — mandatory)

The review is **evidence, not a punch list.** Re-verify every reviewer claim against
full-resolution crops *before* touching code, and classify each finding:

| Disposition | Meaning | Action |
|-------------|---------|--------|
| **real** | Genuine fidelity miss, confirmed at full res | Fix it |
| **capture artifact** | The shot was wrong/stale, not the build | Re-capture, re-judge |
| **misread** | Element exists but reviewer couldn't see it (downsample) | Refute with a zoom crop; no code change |
| **accepted deviation** | Intentional, in-scope divergence from the reference | Document; no code change |

Write the disposition for each finding into the review report. In the v3 run, of 10
ranked findings: 4 real, 2 capture artifacts, 4 misreads — adjudication prevented
both under-reaction (missing the 4 real) and over-reaction (4 needless changes).

---

## Fidelity gaps that are really schema gaps (R12)

When a reference shows data the model does not have (run target/thumbnails, packet
harness-target / skill-pack / context-refs, owner avatar stacks), **do not fake it in
the UI to match the picture.** File a data-model follow-up and note the deferral in
the review report. Faked UI data is a worse lie than an honest gap.

---

## Polish-pass addenda (cc-v3.1, 2026-06-12)

Four lessons from the v3.1 polish pass that extend the protocol above.

### R13 — When a screenshot can't resolve "renders vs. not," probe the DOM/pixels, don't eyeball

The "map lines never appear" bug only converged when capture stopped being *screenshot reading* and
became *probing*: `document.elementFromPoint`, `getBoundingClientRect` / `getComputedStyle` on the
suspect layer, SVG `path` length/segment sampling, and mask/heatmap plots of where strokes actually
landed. The root cause was invisible to any screenshot — **the xyflow edges `<svg>` was sized at
width 0, so every edge path was clipped for everyone since v2.** A downsampled (or even full-res)
screenshot of "no lines" can't distinguish *not drawn* from *drawn-then-clipped*; a box-and-pixel
probe can. Reach for probes the moment a visual question is "is it there at all?" rather than "does it
look right?". (Generalizes R1: when crops still don't answer it, drop below the screenshot.)

### R14 — Verify interaction outcomes against the datastore, not the DOM

Every DnD / drawer / capture flow in v3.1 was asserted against **Postgres / API state**, not against
what the DOM appeared to show — and that is what caught the real defects (approve flow, undo inverses,
link deletion). A DOM that "looks updated" routinely lies (optimistic cache, stale render, wrong
entity bound). For any mutation flow, the acceptance check is a DB row or an API read, with the
screenshot as corroboration only. (This is the visual-work face of the same doctrine in
[`completion-criteria.md`](./completion-criteria.md).)

### R15 — New Command Center stylesheets must prefix-scope their classes

The density P1 root cause was an **unscoped `.cc-filter-bar`** added in `command-center-launcher.css`
that silently restyled the active rail on a different surface. CC stylesheets share a global cascade;
a generic class name added in one file leaks into every surface that happens to use it. Convention:
prefix-scope CC classes to their surface (`.cc-launcher-filter-bar`, not `.cc-filter-bar`) and treat a
duplicate `cc-*` selector across files as a smell worth a grep before shipping.

### R16 — `DELETE` soft-archives; capture surfaces (and probes) must exclude archived rows

`DELETE /nodes` soft-archives rather than hard-deleting, and three surfaces (map, recent items, link
picker) rendered archived items — so verification probes leaked into screenshots and read as defects.
Two consequences for the gate: (1) **probe/test cleanup needs a hard delete** (psql), not the API
`DELETE`; (2) any list/query surface must apply an **archived-exclusion** filter, or stale archived
rows pollute both the UI and the review evidence.

---

## Evidence & integration

- Emit crops + full shots under `.claude/evidence/phase-<N>/` (or a run-scoped
  `review-shots/` + `crops/`), consistent with the `planning` skill's
  `visual_evidence_required` AC field and `debugging`'s `smoke_gate` retrospective.
- This gate composes with the standard gates in [`quality-gates.md`](./quality-gates.md):
  run behavioral gates first (they're cheap and block hard), then this visual gate.
- Cross-refs: `ica-delegate` "Build-and-Gate Pre-Flight" item 3 (visual grounding for
  FE delegates); `planning/references/ac-schema.md` (`visual_evidence_required`);
  `debugging/modes/post-incident-retrospective.md` (`smoke_gate`).
