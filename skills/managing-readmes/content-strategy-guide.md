# Content Strategy Guide (Route 3)

Audience analysis, section structure, and prose style for README content planning by project type.

## Audience Analysis Framework

Map project type to reader motivations. This table determines what information appears above-the-fold.

| Project Type | Primary Audience | What They Need First | What They Scan For | Exit Triggers |
|--------------|-----------------|---------------------|-------------------|---------------|
| **CLI Tool** | DevOps / Scripts | Problem it solves | Installation speed, command examples | No quick install path |
| | Developers | Workflow integration | Integration with existing tools | "Requires X" without clear why |
| **Web App** | End Users | What problems it solves | Screenshot, signup flow | Jargon, complicated description |
| | Developers | Authentication, API | API reference, setup guide | No dev setup instructions |
| **Library** | Developers | API surface | Installation, basic usage example | 50+ line minimal example |
| | Architects | Performance, dependencies | Benchmarks, dependency graph | Too many dependencies listed |
| **SaaS** | Product Manager | Feature list, pricing | Pricing, tier comparison | No clear value prop |
| | End Users | Getting started | Onboarding, templates | Requires credit card upfront |
| **Internal Tool** | Team Members | Permission model | Access instructions, docs link | No permission model stated |
| | Maintainers | Deployment, config | Setup guide, troubleshooting | Incomplete setup steps |

## Section Priority by Project Type

### Above-the-Fold Decision Window: 30 Seconds

Readers make 3 decisions in the first 30 seconds:
1. **Stay / Leave**: Does this project solve my problem?
2. **Skim / Read**: Is it worth reading carefully?
3. **Try / Skip**: Am I ready to try it right now?

### Section Priority Tiers

**Critical (Hero section — 0-30 seconds)**:
- Project name + one-line value proposition
- Problem statement (what pain does this address)
- Hero image or GIF showing the tool in action
- "Get Started" link to quickstart

**Important (30 seconds — 2 minutes)**:
- Feature highlights (3-5 bullet points, benefit-focused)
- Screenshots showing key workflows
- Quick installation instructions (3 steps max)

**Supporting (2-5 minutes)**:
- Detailed configuration reference
- Contributing guidelines
- License and attribution
- Advanced features (for power users)

### Section Order by Project Type

| Project Type | Order | Rationale |
|--------------|-------|-----------|
| **CLI Tool** | Hero → Features → Quickstart → Commands → Config → Contributing → License | Developers want to install and use immediately |
| **Web App** | Hero → Screenshots → Quickstart → Features → Config → Architecture → Contributing → License | Visual demonstration is critical for SaaS/web |
| **Library** | Hero → Installation → API Reference → Examples → Architecture → Testing → License | API surface is the primary artifact |
| **SaaS** | Hero → Features → Pricing → Screenshots → Quickstart → FAQ → Support → License | Product information comes before technical setup |
| **Internal Tool** | Hero → Access / Permissions → Quickstart → Features → Troubleshooting → Contributing → License | Team members need to know access model immediately |

## Section Checklists

### Hero Section
**Required elements:**
- Project name
- One-line value proposition (what problem does it solve)
- Visual: screenshot, GIF, or diagram
- Call-to-action (installation / signup / try)

**Common mistakes:**
- Hero tagline is too abstract ("Build modern applications" → use "Manage Claude Code artifacts with a web UI")
- Missing visuals (text-only hero loses 80% of readers at 2 seconds)
- Call-to-action is unclear or buried (should be in top 3 lines)

**Length guidance:**
- Value prop: 1 sentence, max 15 words
- Intro paragraph: 2-3 sentences, max 50 words
- Visual: 1280×720 minimum (16:9 aspect ratio)

### Features Section
**Required elements:**
- 3-5 feature highlights (not a feature dump)
- Each feature: headline + 1 sentence benefit
- Visuals (icon or screenshot per feature)

**Common mistakes:**
- Too many features listed (readers scan, not read)
- Features described as nouns, not benefits ("REST API" → "Query data from any HTTP endpoint")
- Missing visual anchors (bullets with text only)

**Length guidance:**
- Per feature: max 2 lines (headline + 1 sentence)
- Total features section: 150-200 words

### Quickstart Section
**Required elements:**
- Prerequisites (if any) in 1 line
- Installation: exact command(s) to copy-paste
- First usage: minimal working example
- Link to full documentation

**Common mistakes:**
- Missing package manager (pip? npm? brew?)
- Example code doesn't actually work (test before documenting)
- Skips required setup steps (environment variables, config)
- No indication of expected output

**Length guidance:**
- Install command: 1 line (2 max for complex envs)
- Minimal example: 5-10 lines, runnable as-is
- Total section: 150-200 words

### Screenshots / GIF Section
**Required elements:**
- 1 hero screenshot (most important feature)
- 1 screenshot per major workflow (3-5 total)
- Captions explaining what readers are seeing
- GIF showing primary workflow (optional but high-impact)

**Common mistakes:**
- Screenshots show empty/dummy states (capture with real data)
- Too small to read text in screenshots
- Missing alt text (impacts accessibility and SEO)
- GIFs are too fast (2-3 seconds per action minimum)

**Length guidance:**
- 1 image per 300-500 words of prose
- Screenshot width: 1280px minimum
- GIF length: 15-30 seconds
- Alt text: 10-15 words describing what the image shows

### CLI Command Reference
**Required elements:**
- Command group headings (if >5 commands)
- Per command: name → brief description → example invocation
- Show output for important commands
- Indicate which flags are required vs optional

**Common mistakes:**
- Showing `--help` output verbatim (too dense)
- Examples don't match the command description
- No indication of common usage patterns
- Required flags not clearly marked

**Length guidance:**
- Per command: 2-3 lines (name, 1-2 sentence description, 1 example)
- Use `code` blocks for commands and output
- Group related commands under headings

### Contributing Section
**Required elements:**
- Link to CONTRIBUTING.md (don't duplicate)
- Types of contributions welcome (bug reports, PRs, docs)
- Development setup (1-2 steps)
- PR process (if non-standard)

**Common mistakes:**
- Doesn't explain how to set up local environment
- "All contributions welcome" without specifics
- No link to issues or contribution guidelines
- Missing code style or testing requirements

**Length guidance:**
- Total section: 100-150 words
- Development setup: copy-paste commands, max 5 lines
- Link to detailed CONTRIBUTING.md for full process

## Prose Style Guide

### Voice
- **Direct**: "This tool manages your Claude Code artifacts" (not "enables management of artifacts")
- **Confident**: "You can deploy in 5 minutes" (not "you might be able to")
- **Benefit-focused**: "Save time with automated syncing" (not "implements sync algorithm")

### Avoid
- **Jargon without context**: "CRUD operations" → "create, read, update, delete data"
- **Hedging language**: Remove "simply", "just", "easily", "of course"
- **Walls of text**: Break paragraphs at 3 lines max
- **Future tense**: "Will support" → "Supports" (even if beta)

### Prefer
- **Concrete examples**: "Store 1000+ artifacts" (not "Store many artifacts")
- **Visuals over paragraphs**: Show a screenshot instead of describing a UI
- **Bullet points for features**: Easier to scan than prose
- **Active voice**: "Users can deploy" (not "Deployment can be performed")

### Code Examples
- **Minimal but complete**: Include imports and required setup
- **Copy-pasteable**: No placeholders like `<YOUR_API_KEY>` (use env var references or comments)
- **Show output**: Include expected console output in comments
- **Runnable as-is**: Test each example before documenting

**Example (good)**:
```python
from skillmeat import Collection

collection = Collection()
artifacts = collection.search("deployment")
for artifact in artifacts:
    print(f"{artifact.name}: {artifact.type}")
```

**Example (bad)**:
```python
# Collection usage example
collection = Collection()
# ... use collection
```

## Success Metrics

### Time-to-Understand
- Metric: Reader grasps project purpose in <30 seconds
- Test: Show hero section to someone unfamiliar with the project
- Success: They can answer "What does this tool do?" in 1 sentence

### Time-to-Try
- Metric: Reader can run a working example in <5 minutes
- Test: Follow quickstart instructions from fresh environment
- Success: Example runs without errors or missing steps

### Visual Density
- Metric: At least 1 image per 500 words of prose
- Why: Readers skim; visuals provide anchors for scanning
- Count: Include screenshots, diagrams, GIFs, tables

### Scroll Depth Target
- Metric: Key information in first 2 screenfuls (1440px vertical)
- What goes here: Hero, value prop, features, quickstart
- What goes below: Advanced configuration, contributing, license

## Content Plan Output Format

When an agent uses this route, produce a structured content plan document with these sections:

### 1. Audience Analysis
```
Primary Audience: [type]
  - What they need: [first piece of info]
  - What they scan for: [key terms]
  - Exit triggers: [what makes them leave]

Secondary Audience: [type]
  - [same structure]
```

### 2. Section Order & Rationale
```
Recommended order:
1. Hero
   - Rationale: Solve [project type] reader's top need
2. [Next section]
   - Rationale: [why this comes before alternatives]
[etc.]
```

### 3. Hero Tagline Options
Provide 3 alternatives, each <15 words:
1. [Option A - emphasizes speed]
2. [Option B - emphasizes power]
3. [Option C - emphasizes simplicity]

### 4. Feature Highlight Selection
Identify top 3-5 features:
- Feature name
- One-sentence benefit (user-focused, not technical)
- Visual requirement (screenshot, icon, etc.)

### 5. Visual Asset Requirements
```
Hero image:
  - Type: [screenshot/diagram/GIF]
  - Size: 1280×720
  - Content: [what should it show]
  - Status: [pending/captured/in-progress]

Feature screenshots (per feature):
  - [similar structure]

Workflow GIF:
  - [similar structure]
```

### 6. Copy Direction Notes
Brief style guide for this specific project:
- Tone adjustments (more technical, less jargon, etc.)
- Specific terms to use/avoid
- Pain points to emphasize
- Audience-specific messaging

---

## Quick Reference: Common Content Plans by Type

### CLI Tool Content Plan
- Hero: "Manage X from the command line"
- Features: Installation speed, common commands, integration with Y
- Quickstart: Install + single command example
- CLI Ref: Organized by command group
- Visual: Screenshot of typical workflow

### Web App Content Plan
- Hero: Screenshot showing main dashboard
- Features: Key workflows (3-5), with benefit statements
- Quickstart: Signup/first login flow
- Screenshots: One per major feature
- GIF: Primary user workflow
- Visual: High-quality screenshots with captions

### Library Content Plan
- Hero: "Type-safe API for X"
- Installation: Show for all package managers
- API Ref: Organized by functionality
- Examples: Minimal → intermediate → advanced
- Visual: Code examples, not screenshots
- Benchmarks: Performance claims need data

### SaaS Content Plan
- Hero: Problem statement + product screenshot
- Features: Benefit-focused, with visuals
- Pricing: Link or embed pricing table
- Quickstart: Signup flow + first action
- Screenshots: Key features in action
- GIF: Onboarding workflow
- FAQ: Common questions

### Internal Tool Content Plan
- Hero: Team name, tool purpose, access model
- Permissions: Who can use, how to request access
- Quickstart: Local setup in 2-3 steps
- Features: Major workflows
- Troubleshooting: Common issues
- Support: Who to contact
- Visual: Team dashboard or key interface
