# Gemini CLI Creative Prompt Templates

Prompt templates for image generation, SVG, animation, and multimodal workflows.
All templates target Gemini 3.1 Pro unless noted.

## Template 1: UI Component Mockup

Generate a visual mockup and accompanying React/TSX implementation together.

### When to Use
- New component with no existing reference design
- Stakeholder review before full implementation
- Rapid layout prototyping

### Template
```bash
gemini "Generate a UI mockup image for {COMPONENT_NAME}.

Context: {1-2 sentences on purpose, data displayed, and user action}

Design requirements:
- {requirement 1, e.g., shows artifact name, type badge, version, deploy status}
- {requirement 2}

Tech stack: Next.js 15, Tailwind CSS, shadcn/ui components
Constraints: {e.g., card width max 320px, dark mode compatible}

After the image, output the complete React/TSX component:
- Named export: {ComponentName}
- Props interface included
- Use shadcn/ui Card, Badge, Button primitives
- No placeholder comments — output working code only" --yolo -o text
```

### Example
```bash
gemini "Generate a UI mockup image for a MiniDeploymentSetCard.

Context: Compact card showing a deployment set's name, member count, active group,
and last-synced timestamp. Used in a sidebar list view.

Design requirements:
- Deployment set name as heading
- Member count badge (e.g., '4 members')
- Active group name in muted text
- Relative timestamp (e.g., '2h ago')
- Hover state with subtle border highlight

Tech stack: Next.js 15, Tailwind CSS, shadcn/ui components
Constraints: card width max 280px, dark mode compatible

After the image, output the complete React/TSX component:
- Named export: MiniDeploymentSetCard
- Props interface included
- Use shadcn/ui Card, Badge primitives
- No placeholder comments — output working code only" --yolo -o text
```

### Validation Checklist
- [ ] Image layout matches intent before integrating code
- [ ] Imports match installed shadcn/ui version
- [ ] Props interface is accurate and typed
- [ ] Accessibility: role, aria-label, keyboard focus handled

---

## Template 2: SVG Generation

### Routing Decision

```
Simple SVG (icon, logo, <50 elements)?
├── Yes → Write inline with Claude (no CLI overhead)
└── No → Complex (illustration, diagram, animation)?
    └── Yes → Use Gemini 3.1 Pro (templates below)
```

### Template 2a: Complex SVG Illustration
```bash
gemini "Create an SVG illustration of {SUBJECT}.

Dimensions: {width}x{height}px, viewBox='0 0 {width} {height}'
Style: {e.g., flat design, line art, isometric}
Color palette: {e.g., #1e293b background, #38bdf8 accent}
Elements: {list key visual elements}

Output requirements:
- Complete, self-contained SVG markup only
- No wrapper HTML, no <script> tags
- Group related elements with <g> and id attributes for editability
- All text as <text> elements (no embedded images)" --yolo -o text
```

### Template 2b: Architecture / Data Flow Diagram as SVG
```bash
gemini "Create an SVG architecture diagram for {SYSTEM_NAME}.

Components to show:
- {Component A}: {description}
- {Component B}: {description}
- {Component C}: {description}

Connections:
- A → B: {label/description}
- B → C: {label/description}

Style: clean box-and-arrow, monochrome with blue accent
Layout: left-to-right flow
Dimensions: 900x500px

Output: complete SVG only, no wrapper HTML" --yolo -o text
```

### Validation
```bash
# Validate SVG is well-formed XML
xmllint --noout output.svg && echo "Valid SVG"

# Open for visual preview
open output.svg
```

---

## Template 3: CSS Animation

Generate keyframe animations with reduced-motion compliance.

### Template 3a: Simple Keyframe
```bash
gemini "Generate CSS keyframe animations for {UI_ELEMENT}.

Behavior: {describe motion, e.g., 'pulse glow effect on hover, 2s infinite'}
Target class: .{class-name}
Trigger: {hover | focus | always-on | class-toggle}

Requirements:
- @keyframes definition
- Animation applied to .{class-name}
- @media (prefers-reduced-motion: reduce) override that disables motion
- Output only the CSS — no component wrapper, no HTML" -o text
```

### Template 3b: Complex Sequence Animation
```bash
gemini "Generate a CSS animation sequence for {COMPONENT}.

Sequence:
1. {step 1, e.g., 'fade in from bottom (0-200ms)'}
2. {step 2, e.g., 'slide right (200-400ms)'}
3. {step 3, e.g., 'settle with spring bounce (400-600ms)'}

Target element: .{class-name}
Easing preference: {e.g., cubic-bezier(0.34, 1.56, 0.64, 1) for spring}

Requirements:
- Single @keyframes or split into named stages as appropriate
- CSS custom properties for duration/delay so consuming components can override
- @media (prefers-reduced-motion: reduce) block that removes all transforms
- Comment each keyframe stage
- Output CSS only" -o text
```

### Integration
After generating, inject into the component's CSS module or Tailwind plugin:
```bash
# Append to existing CSS module
cat animation.css >> skillmeat/web/components/ui/animations.css
```

---

## Template 4: Image-Aware Code Edit (Screenshot-to-Code)

Use Gemini's multimodal input to fix UI bugs from screenshots.

### When to Use
- Visual regression: "it looks wrong but I can't describe why"
- Layout bugs where the gap between intent and output is visual
- Alignment, spacing, overflow issues that are easier to show than describe

### Template
```bash
# Pass screenshot as file reference in the prompt
gemini "Here is a screenshot of {COMPONENT_NAME}: @{/path/to/screenshot.png}

The current TSX implementation is: @{./path/to/component.tsx}

Issue: {describe what looks wrong, e.g., 'the badge is overlapping the title on narrow viewports'}

Fix the TSX to resolve the visual issue.
Constraints:
- Keep shadcn/ui primitives unchanged
- Only modify Tailwind classes and layout structure
- Do not change prop interface or logic
Apply the fix now." --yolo -o text
```

### Example
```bash
gemini "Here is a screenshot of MemberListItem: @/tmp/member-list-bug.png

The current TSX implementation is: @./skillmeat/web/components/deployment-sets/member-list.tsx

Issue: the version badge overflows outside the card boundary on viewports under 768px.

Fix the TSX to resolve the visual issue.
Constraints:
- Keep shadcn/ui primitives unchanged
- Only modify Tailwind classes and layout structure
- Do not change prop interface or logic
Apply the fix now." --yolo -o text
```

### Validation
```bash
# After applying fix, run type-check
pnpm type-check

# Visual re-check
# Open browser at the affected viewport width and confirm fix
```

---

## Model Routing Quick Reference

| Task | Model | Flag |
|------|-------|------|
| UI mockup + code | Gemini 3.1 Pro | (default) |
| Complex SVG / animation | Gemini 3.1 Pro | (default) |
| Simple CSS animation | Gemini 3 Flash | `-m gemini-3-flash` |
| Screenshot-to-code fix | Gemini 3.1 Pro | (default, multimodal required) |
| Simple icon SVG | Claude (inline) | — |

## Output Chunking Reminder

Creative outputs (especially full SVG with animations or multi-section mockups) can approach the 65K output cap. If output appears cut off:

```bash
# Resume from cut-off point
echo "Continue the SVG from where you stopped. Start from the <g id='animations'> section." | gemini -r latest -o text
```
