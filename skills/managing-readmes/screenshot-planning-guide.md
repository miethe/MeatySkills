# Screenshot Planning Guide (Route 2)

Surface enumeration, capture tool selection, and asset spec format for planning README visual assets.

## Capturable Surface Enumeration

Before planning screenshots, enumerate all capturable surfaces in the project.

### Web Apps (Next.js, React, etc.)

**Discover capturable pages:**
1. Read app router structure (`/app` directory in Next.js 13+)
2. List all route files (`page.tsx`, `layout.tsx`)
3. Extract dynamic segments (e.g., `/[id]`, `/[type]/[id]`)
4. Note authentication boundaries (public vs. protected routes)

**Identify key states:**
- Empty state (no data yet)
- Populated state (with sample data)
- Loading state (if visually interesting)
- Error state (if user-facing)
- Mobile responsive view (if relevant)

**Example enumeration** (for SkillMeat web):
```
/                          → Dashboard (default view, with sample artifacts)
/artifacts                 → Artifact browser
/artifacts/[id]            → Artifact detail + sync status tab
/artifacts/[id]/manage     → Deployment editor
/settings                  → Settings page
/api/v1/artifacts          → API response (show in browser, not screenshot)
```

### CLI Tools

**Discover commands:**
1. Run `<tool> --help` to list top-level commands
2. For each command, run `<tool> <command> --help` for subcommands
3. Group related commands (e.g., all `deploy` variants together)

**Identify capturable outputs:**
- Help text (`--help`, `-h`)
- Successful command output with sample data
- Error messages (useful for troubleshooting)
- Table/list output (if structured)
- Progress output (if long-running)

**Example enumeration** (for SkillMeat CLI):
```
skillmeat init             → Initialize collection
skillmeat add <source>     → Add artifact from GitHub
skillmeat deploy <id>      → Deploy artifact to project
skillmeat list             → List collection artifacts
skillmeat sync             → Sync with upstream
skillmeat search <query>   → Search artifacts
skillmeat config           → Configuration commands
```

### APIs (OpenAPI / REST)

**Discover endpoints:**
1. Parse `openapi.json` (auto-generated)
2. Group endpoints by tag (e.g., `/artifacts/*` → artifacts tag)
3. Identify key operations: list, create, detail, update, delete
4. Note required authentication and example payloads

**Identify capturable examples:**
- Successful request/response pairs (JSON structure)
- Error responses with meaningful error codes
- Paginated list responses
- Real-world data examples

**Note**: APIs are typically documented via OpenAPI spec, not README screenshots. Include examples in code blocks, not screenshots.

### Libraries (Python, JavaScript, etc.)

**Discover API surface:**
1. Read top-level `__init__.py` or `index.ts` (public exports)
2. List all public classes and functions
3. Identify common usage patterns from tests or examples

**Identify capturable examples:**
- Minimal working code snippet
- Output or result from running code
- Interactive examples (REPL output)
- Complex workflow chained together

**Note**: Libraries typically show code + output in README, not screenshots of IDE.

## Screenshot Spec Format

Create a `screenshots.json` file at project root to track all visual assets.

```json
{
  "screenshots": [
    {
      "id": "dashboard-overview",
      "file": "docs/screenshots/dashboard-overview.png",
      "alt": "Dashboard showing artifact collection with search and filter options",
      "width": 1280,
      "height": 720,
      "category": "readme",
      "page": "/",
      "features": ["collection-browse", "search"],
      "status": "pending",
      "notes": "Capture with 5-10 sample artifacts loaded"
    },
    {
      "id": "artifact-detail-sync-tab",
      "file": "docs/screenshots/artifact-detail-sync-tab.png",
      "alt": "Artifact detail view showing sync status between source and project",
      "width": 1280,
      "height": 720,
      "category": "features",
      "page": "/artifacts/[id]",
      "features": ["sync-status", "upstream-diff"],
      "status": "pending",
      "notes": "Show artifact with upstream tracking enabled, upstream changes available"
    }
  ],
  "gifs": [
    {
      "id": "quickstart-workflow",
      "file": "docs/screenshots/gifs/quickstart-workflow.gif",
      "tool": "mcp__claude-in-chrome__gif_creator",
      "config": {
        "showClickIndicators": true,
        "quality": 10,
        "fps": 12
      },
      "sequence": [
        {
          "action": "navigate",
          "url": "http://localhost:3000",
          "label": "Home page",
          "hold": 2000
        },
        {
          "action": "click",
          "selector": "button[aria-label='Add artifact']",
          "label": "Click Add Artifact",
          "hold": 1000
        }
      ],
      "status": "pending",
      "notes": "Show complete flow from home to first artifact addition"
    }
  ]
}
```

**Field definitions:**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Unique identifier (kebab-case) |
| `file` | string | Relative path from project root |
| `alt` | string | Accessibility text (appears in README, read by screen readers) |
| `width` | number | Pixel width (use preset from Viewport Presets table) |
| `height` | number | Pixel height (use preset from Viewport Presets table) |
| `category` | string | `readme` (shown in README), `features` (optional detail), `cli` (terminal), `gifs` (animations) |
| `page` | string | URL or command name being captured |
| `features` | array | List of features showcased in this asset |
| `status` | string | `pending`, `in-progress`, `captured`, `approved` |
| `notes` | string | Pre-capture requirements (data setup, UI state, etc.) |
| `tool` | string | (GIFs only) MCP tool used: `mcp__claude-in-chrome__gif_creator`, `asciinema`, etc. |
| `config` | object | (GIFs only) Tool-specific configuration |
| `sequence` | array | (GIFs only) List of actions to record |

## Capture Tool Decision Matrix

Choose the right tool based on asset type and platform.

| Asset Type | Primary Tool | When to Use | Fallback |
|-----------|-------------|------------|----------|
| **Web UI screenshot** | Chrome MCP `screenshot` action | Fast, integrated, no setup | Puppeteer / Playwright |
| **Web interactive GIF** | Chrome MCP `gif_creator` | Smooth, click indicators, full control | Manual screen recording |
| **CLI output (static)** | Chrome MCP (terminal tab) | Consistent rendering, syntax highlighting | Copy-paste from terminal |
| **CLI animated demo** | Chrome MCP (terminal tab recording) or asciinema | Shows user interactions frame-by-frame | Manual screen recording |
| **API response example** | Code block in README (not screenshot) | JSON responses shown in text, not images | Never screenshot JSON |
| **Complex diagram** | SVG or Mermaid diagram (text-based) | Version-controlled, editable | Never use image for diagrams |

## Chrome MCP Capture Workflows

### Screenshot Capture Workflow

1. **Open/navigate to target page:**
   ```
   mcp__claude-in-chrome__tabs_create_mcp
     → stores tab_id

   mcp__claude-in-chrome__resize_window
     width: 1280
     height: 720
     tab_id: <from step 1>

   mcp__claude-in-chrome__navigate
     url: http://localhost:3000/artifacts
     tab_id: <from step 1>

   # Wait for page to fully load (see notes)
   ```

2. **Prepare UI state:**
   - Ensure data is loaded (wait for spinners to finish)
   - Interact with page if needed (expand sections, toggle tabs)
   - Capture any notifications/toasts that appear
   - Verify state matches "notes" in screenshots.json

3. **Capture screenshot:**
   ```
   mcp__claude-in-chrome__computer
     action: screenshot
     tab_id: <from step 1>

   # Returns base64 PNG image data
   ```

4. **Save and update manifest:**
   - Decode base64 image
   - Save to `docs/screenshots/<id>.png`
   - Update `screenshots.json` status to `captured`
   - Verify `width` and `height` match viewport

**Timing notes:**
- After navigation, wait 2-3 seconds for React to render
- For data-heavy pages, wait until data queries complete
- If page has animations, wait for them to finish before capturing

### GIF Recording Workflow

1. **Start recording:**
   ```
   mcp__claude-in-chrome__navigate
     url: http://localhost:3000
     tab_id: <tab_id>

   # Hold on start page
   mcp__claude-in-chrome__computer
     action: wait
     duration: 2000

   mcp__claude-in-chrome__gif_creator
     action: start_recording
     tab_id: <tab_id>
   ```

2. **Record sequence:**
   For each action in the sequence array:
   ```
   mcp__claude-in-chrome__computer
     action: click | type | key
     selector | text | key: <from sequence>

   mcp__claude-in-chrome__computer
     action: wait
     duration: 1000  # Extra frames for smooth rendering

   mcp__claude-in-chrome__computer
     action: screenshot  # (Optional, for verification)
   ```

3. **Finalize recording:**
   ```
   mcp__claude-in-chrome__computer
     action: wait
     duration: 1500  # Final hold before ending

   mcp__claude-in-chrome__gif_creator
     action: stop_recording
     tab_id: <tab_id>

   mcp__claude-in-chrome__gif_creator
     action: export
     quality: 10
     fps: 12
     showClickIndicators: true

   # Returns base64 GIF data
   ```

4. **Save and update manifest:**
   - Decode base64 GIF
   - Save to `docs/screenshots/gifs/<id>.gif`
   - Update `screenshots.json` status to `captured`
   - Test GIF plays smoothly in browser

**Timing notes:**
- Start each action with 500ms pause before to show button/input at rest
- After each action (click, type), wait 1000-1500ms for UI to respond
- End with 1500-2000ms hold to avoid cutting off final state
- GIFs should be 15-30 seconds total (not too fast, not too slow)

### Terminal Screenshot Workflow

For CLI output or asciinema recordings:

1. **Set up terminal environment:**
   - Open new terminal tab
   - Set size to match preset (800×600 for CLI screenshots)
   - Navigate to project directory
   - Clear screen

2. **Run command:**
   ```
   terminal$ skillmeat list
   ```

3. **Capture screenshot:**
   ```
   mcp__claude-in-chrome__computer
     action: screenshot
   ```

4. **For animated asciinema recordings:**
   ```
   asciinema rec -c "skillmeat sync" output.cast
   ```
   Then convert to GIF:
   ```
   agg output.cast output.gif
   ```

## Viewport Presets

Standard viewport sizes for consistent, professional screenshots.

| Preset | Width | Height | Aspect Ratio | Use Case |
|--------|-------|--------|--------------|----------|
| **Desktop** | 1280 | 720 | 16:9 | Default README screenshots |
| **Desktop HD** | 1920 | 1080 | 16:9 | Detailed feature shots, showing full interface |
| **Tablet** | 768 | 1024 | 3:4 | Responsive design demo |
| **Mobile** | 375 | 812 | ~19.5:9 | Mobile layout, responsive design |
| **CLI** | 800 | 600 | 4:3 | Terminal output, command examples |
| **Ultra-wide** | 2560 | 1440 | 16:9 | Complex dashboards, data-heavy pages |

**Recommendation:** Use **Desktop 1280×720** for most README screenshots. It's:
- Wide enough to show complete interfaces
- Tall enough to show workflow (without excessive scrolling)
- Fits in standard README width (600px in browser)
- Readable on mobile when zoomed

## Screenshot Categories

Organize screenshots by purpose using the `category` field.

| Category | Where Shown | Example | Quantity |
|----------|------------|---------|----------|
| `readme` | Embedded in README body | Dashboard overview, hero screenshot | 1-5 |
| `features` | Optional: linked from README or in docs | Detailed feature screenshots | 3-5 |
| `cli` | In CLI reference section | Command output examples | 5-10 |
| `gifs` | Embedded in quickstart or features | Workflow demo, onboarding | 1-3 |

**Filename convention**: Use kebab-case, descriptive names:
- `dashboard-overview.png` (not `screenshot1.png`)
- `artifact-detail-sync-tab.png` (describes what it shows)
- `quickstart-workflow.gif` (not `demo.gif`)

## Planning Heuristic

For a typical project, estimate visual assets as:

- **1 hero screenshot**: The most important page or state (dashboard, home, app overview)
- **1 screenshot per major feature** (3-5 total): Top features users should know about
- **1 GIF for primary quickstart**: Show the flow from "zero to first action"
- **1 GIF for most impressive feature** (optional): Demonstrate power or complexity

**Example for web app:**
```
Hero: Dashboard overview (shows what the app does)
Features:
  - Search and filter workflow
  - Artifact detail with sync status
  - Deployment workflow
Quickstart GIF: Add artifact → Search → View details (30 seconds)
Optional: Advanced sync diff workflow (45 seconds)
```

**Example for CLI tool:**
```
Hero: Help output showing available commands
Features:
  - Initialization workflow
  - Add artifact from GitHub
  - List and search artifacts
Quickstart GIF: init → add → list (20 seconds)
Optional: Complex workflow (sync + deploy) (40 seconds)
```

## Sample Data Requirements

Screenshots should represent realistic, populated states.

### Data Preparation

1. **Create seed script** (if needed):
   ```bash
   # Example: scripts/seed-demo-data.sh
   skillmeat init
   skillmeat add anthropics/skills/canvas-design@latest
   skillmeat add user/repo/my-skill@latest
   ```

2. **Run before capturing:**
   ```bash
   npm run dev  # Start dev server
   ./scripts/seed-demo-data.sh  # Populate database
   # Wait 2-3 seconds for data to load
   # Now capture screenshots
   ```

3. **Document in `notes` field:**
   ```json
   {
     "id": "dashboard-overview",
     "notes": "Run seed-demo-data.sh first; requires 5-10 artifacts in collection"
   }
   ```

### State Considerations

| State | Use For | Data Requirements |
|-------|---------|-------------------|
| **Empty** | Empty state design | No artifacts/data |
| **Populated** | Normal usage | Realistic sample data |
| **Loading** | Loading indicators | In-progress async state |
| **Error** | Error messages | Invalid state or network failure |
| **Mobile** | Responsive demo | Touch-friendly viewport |

**Recommendation:** Capture populated states by default. Empty states are less compelling for README.

### Pre-Capture Checklist

Before each screenshot:
- [ ] Data is loaded (no spinners, no "Loading..." text)
- [ ] Page is fully rendered (wait 2-3 seconds after navigation)
- [ ] Any modals or overlays are closed or intended
- [ ] Viewport size matches preset in `screenshots.json`
- [ ] Sample data matches what README promises
- [ ] No sensitive data is visible (redact API keys, personal info)
- [ ] UI state matches `notes` field requirements

## Implementation Checklist for Agents

When using this guide to plan screenshots:

1. **Enumerate surfaces:**
   - [ ] List all routes (web) or commands (CLI)
   - [ ] Identify key states and workflows
   - [ ] Determine which surfaces are worth capturing

2. **Create `screenshots.json`:**
   - [ ] Add hero screenshot entry
   - [ ] Add 3-5 feature screenshot entries
   - [ ] Add 1-2 GIF entries
   - [ ] Fill in `alt`, `notes`, `status` for each

3. **Plan visual assets:**
   - [ ] Choose viewport preset for each screenshot
   - [ ] Identify required sample data per screenshot
   - [ ] Note any UI states that need setup (data loaded, tab active, etc.)

4. **Document in README:**
   - [ ] Link to `screenshots.json` in project root
   - [ ] Embed hero screenshot early in README
   - [ ] Add captions to each screenshot
   - [ ] Embed GIFs in quickstart section

5. **Execute captures:**
   - [ ] Prepare environment (start dev server, seed data)
   - [ ] Capture each screenshot using Chrome MCP
   - [ ] Record GIFs using gif_creator workflow
   - [ ] Update `screenshots.json` status to `captured`
   - [ ] Verify all files are saved to correct paths

---

## Quick Reference: Screenshots.json Template

```json
{
  "screenshots": [
    {
      "id": "hero-dashboard",
      "file": "docs/screenshots/hero-dashboard.png",
      "alt": "SkillMeat dashboard showing artifact collection browser",
      "width": 1280,
      "height": 720,
      "category": "readme",
      "page": "/",
      "features": ["collection-browse", "artifact-cards"],
      "status": "pending",
      "notes": "Seed with 5-10 artifacts of different types"
    },
    {
      "id": "quickstart-workflow",
      "file": "docs/screenshots/gifs/quickstart-workflow.gif",
      "tool": "mcp__claude-in-chrome__gif_creator",
      "config": {
        "showClickIndicators": true,
        "quality": 10,
        "fps": 12
      },
      "sequence": [
        {"action": "navigate", "url": "http://localhost:3000", "label": "Home", "hold": 2000},
        {"action": "click", "selector": "button[aria-label='Add artifact']", "hold": 1000}
      ],
      "status": "pending",
      "notes": "Show full quickstart flow"
    }
  ],
  "gifs": []
}
```
