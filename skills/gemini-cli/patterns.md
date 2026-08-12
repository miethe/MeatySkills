# Gemini CLI Integration Patterns

Advanced patterns for orchestrating Gemini CLI effectively from Claude Code.

## Pattern 1: Generate-Review-Fix Cycle

The most reliable pattern for quality code generation.

```bash
# Step 1: Generate code
gemini "Create [code description]" --yolo -o text

# Step 2: Have Gemini review its own work
gemini "Review [generated file] for bugs and security issues" -o text

# Step 3: Fix identified issues
gemini "Fix these issues in [file]: [list from review]. Apply now." --yolo -o text
```

### Why It Works
- Different "mindset" for generation vs review
- Self-correction catches common mistakes
- Security vulnerabilities often caught in review phase

### Example
```bash
# Generate
gemini "Create a user authentication module with bcrypt and JWT" --yolo -o text

# Review
gemini "Review auth.js for security vulnerabilities" -o text
# Output: "Found XSS risk, missing input validation, weak JWT secret"

# Fix
gemini "Fix in auth.js: XSS risk, add input validation, use env var for JWT secret. Apply now." --yolo -o text
```

## Pattern 2: JSON Output for Programmatic Processing

Use JSON output when you need to process results programmatically.

```bash
gemini "[prompt]" -o json 2>&1
```

### Parsing the Response

```javascript
// In Node.js or with jq
const result = JSON.parse(output);
const content = result.response;
const tokenUsage = result.stats.models["gemini-2.5-flash"].tokens.total;
const toolCalls = result.stats.tools.byName;
```

### Use Cases
- Extracting specific data from responses
- Monitoring token usage
- Tracking tool call success/failure
- Building automation pipelines

## Pattern 3: Background Execution

For long-running tasks, execute in background and continue working.

```bash
# Start in background
gemini "[long task]" --yolo -o text 2>&1 &

# Get process ID for later
echo $!

# Monitor output incrementally with BashOutput tool
```

### When to Use
- Code generation for large projects
- Documentation generation
- Running multiple Gemini tasks in parallel

### Parallel Execution
```bash
# Run multiple tasks simultaneously
gemini "Create frontend" --yolo -o text 2>&1 &
gemini "Create backend" --yolo -o text 2>&1 &
gemini "Create tests" --yolo -o text 2>&1 &
```

## Pattern 4: Model Selection Strategy

Choose the right model for the task.

### Decision Tree

```
Is the task complex (architecture, multi-file, deep analysis, image gen)?
├── Yes → Use default (Gemini 3.1 Pro)
└── No → Is speed critical?
    ├── Yes → Use gemini-3-flash
    └── No → Is it trivial (formatting, simple query)?
        ├── Yes → Use gemini-2.5-flash-lite
        └── No → Use gemini-3-flash
```

### Examples
```bash
# Complex: Architecture analysis or image generation
gemini "Analyze codebase architecture" -o text

# Quick: Simple formatting
gemini "Format this JSON" -m gemini-3-flash -o text

# Trivial: One-liner
gemini "What is 2+2?" -m gemini-3-flash -o text
```

## Pattern 5: Rate Limit Handling

Strategies for working within rate limits.

### Approach 1: Let Auto-Retry Handle It
Default behavior - CLI retries automatically with backoff.

### Approach 2: Use Flash for Lower Priority
```bash
# High priority: Use Pro
gemini "[important task]" --yolo -o text

# Lower priority: Use Flash (different quota)
gemini "[less critical task]" -m gemini-3-flash -o text
```

### Approach 3: Batch Operations
Combine related operations into single prompts:
```bash
# Instead of multiple calls:
gemini "Create file A" --yolo
gemini "Create file B" --yolo
gemini "Create file C" --yolo

# Single call:
gemini "Create files A, B, and C with [specs]. Create all now." --yolo
```

### Approach 4: Sequential with Delays
For automated scripts, add delays:
```bash
gemini "[task 1]" --yolo -o text
sleep 2
gemini "[task 2]" --yolo -o text
```

## Pattern 6: Context Enrichment

Provide rich context for better results.

### Using File References
```bash
gemini "Based on @./package.json and @./src/index.js, suggest improvements" -o text
```

### Using GEMINI.md
Create project context that's automatically included:
```markdown
# .gemini/GEMINI.md

## Project Overview
This is a React app using TypeScript.

## Coding Standards
- Use functional components
- Prefer hooks over classes
- All functions need JSDoc
```

### Explicit Context in Prompt
```bash
gemini "Given this context:
- Project uses React 18 with TypeScript
- State management: Zustand
- Styling: Tailwind CSS

Create a user profile component." --yolo -o text
```

## Pattern 7: Validation Pipeline

Always validate Gemini's output before using.

### Validation Steps

1. **Syntax Check**
   ```bash
   # For JavaScript
   node --check generated.js

   # For TypeScript
   tsc --noEmit generated.ts
   ```

2. **Security Scan**
   - Check for innerHTML with user input (XSS)
   - Look for eval() or Function() calls
   - Verify input validation

3. **Functional Test**
   - Run any generated tests
   - Manual smoke test

4. **Style Check**
   ```bash
   eslint generated.js
   prettier --check generated.js
   ```

### Automated Validation Pattern
```bash
# Generate
gemini "Create utility functions" --yolo -o text

# Validate
node --check utils.js && eslint utils.js && npm test
```

## Pattern 8: Incremental Refinement

Build complex outputs in stages.

```bash
# Stage 1: Core structure
gemini "Create basic Express server with routes for /api/users" --yolo -o text

# Stage 2: Add feature
gemini "Add authentication middleware to the Express server in server.js" --yolo -o text

# Stage 3: Add another feature
gemini "Add rate limiting to the Express server in server.js" --yolo -o text

# Stage 4: Review all
gemini "Review server.js for issues and optimize" -o text
```

### Benefits
- Easier to debug issues
- Each stage validates before continuing
- Clear audit trail

## Pattern 9: Cross-Validation with Claude

Use both AIs for highest quality.

### Claude Generates, Gemini Reviews
```bash
# 1. Claude writes code (using normal Claude Code tools)
# 2. Gemini reviews
gemini "Review this code for bugs and security issues: [paste code]" -o text
```

### Gemini Generates, Claude Reviews
```bash
# 1. Gemini generates
gemini "Create [code]" --yolo -o text

# 2. Claude reviews the output (in conversation)
# "Review this code that Gemini generated..."
```

### Different Perspectives
- Claude: Strong on reasoning, following complex instructions
- Gemini: Strong on current web knowledge, codebase investigation

## Pattern 10: Session Continuity

Use sessions for multi-turn workflows.

```bash
# Initial task
gemini "Analyze this codebase architecture" -o text
# Session saved automatically

# List sessions
gemini --list-sessions

# Continue with follow-up
echo "What patterns did you find?" | gemini -r 1 -o text

# Further refinement
echo "Focus on the authentication flow" | gemini -r 1 -o text
```

### Use Cases
- Iterative analysis
- Building on previous context
- Debugging sessions

## Pattern 11: UI Mockup Generation

Use Gemini 3.1 Pro's image generation capability to produce visual mockups alongside code.

### When to Use
- Designing a new component with no existing reference
- Communicating layout intent before implementation
- Rapid prototyping where visual + code together accelerate review

### Prompt Structure
```bash
gemini "Generate a UI mockup image for [component name].
Context: [1-2 sentences on purpose and data it displays]
Tech stack: Next.js 15, Tailwind CSS, shadcn/ui
After the image, output the complete React/TSX implementation." --yolo -o text
```

### Example
```bash
gemini "Generate a UI mockup image for a DeploymentSet member card.
Context: Shows artifact name, type badge, version, and deploy status.
Tech stack: Next.js 15, Tailwind CSS, shadcn/ui
After the image, output the complete React/TSX implementation." --yolo -o text
```

### Validation
- Review the image for layout intent before integrating the code
- Check TSX for correct shadcn/ui imports and Tailwind class names
- Verify accessibility (labels, roles) before committing

## Pattern 12: SVG / Animation Generation

Route SVG requests by complexity: simple SVGs stay with Claude; complex ones go to Gemini.

### Routing Decision

```
Is the SVG simple (icon, logo, basic shape)?
├── Yes → Stay with Claude (faster, no CLI overhead)
└── No → Is it complex (illustration, animation, data viz)?
    └── Yes → Delegate to Gemini 3.1 Pro
```

### Simple SVG (Claude handles directly)
Single-path icons, logos under 50 elements — write inline.

### Complex SVG (Gemini)
```bash
gemini "Create an SVG diagram of [subject].
Requirements:
- [dimension/style requirements]
- Include embedded CSS animations for [motion description]
- Output complete, self-contained SVG markup only (no wrapper HTML)" --yolo -o text
```

### CSS Animation Pattern
```bash
gemini "Generate CSS keyframe animations for [UI element].
Behavior: [describe motion]
Constraints: prefers-reduced-motion must be respected with a @media query.
Output: only the @keyframes and animation class CSS, no component wrapper." -o text
```

### Validation
```bash
# Check SVG is well-formed
xmllint --noout output.svg

# Preview in browser
open output.svg
```

## Pattern 13: Output Chunking Discipline

Gemini 3.1 Pro and Gemini 3 Flash both cap output at ~65K tokens. Requests that would produce more will be silently truncated.

### Detection
Signs of truncation:
- Response ends mid-function or mid-block
- Final JSON/code block is unclosed
- `-o json` response `candidates` token count equals exactly 65536

### Threshold
**Chunk any request expected to produce more than ~32K output tokens** (roughly 24K words or 800+ lines of dense code).

### Chunking Strategies

**By file**:
```bash
gemini "Generate tests for auth.py only. Do not include other modules." --yolo -o text
gemini "Generate tests for user.py only." --yolo -o text
```

**By section**:
```bash
gemini "Generate the data model section of the spec. Stop after the models. Do not proceed to endpoints." -o text
gemini "Generate the endpoints section of the spec. Assume data models are already defined." -o text
```

**Explicit length instruction**:
```bash
gemini "Generate the API spec. If you reach 3000 lines, stop and indicate 'CHUNK BOUNDARY' so I can resume." -o text
```

### Resume Pattern
```bash
# After a chunk boundary:
echo "Continue from CHUNK BOUNDARY. Remaining sections: [list]" | gemini -r latest -o text
```

## Pattern 14: Context Hygiene

Gemini's ~1M input window is large, but larger context degrades response quality and increases cost. Prefer targeted injection over dumping the whole repo.

### Preferred: Repo Map + Targeted Files
```bash
# 1. Generate a lightweight repo map (symbols) — per-invocation path, NEVER a fixed /tmp name
MAP=$(mktemp -t geminimap)
jq '.symbols[] | {name, file, layer}' ai/symbols-api.json > "$MAP"

# 2. Inject map + only the files Gemini needs
gemini "Given this repo map: $(cat "$MAP")
And these files: @./skillmeat/api/routers/artifacts.py @./skillmeat/api/schemas/artifact.py
Review for API contract consistency." -o text
```

`mktemp` is load-bearing, not stylistic: a fixed `/tmp/map.json` written on one line and read back two lines later is a race window another concurrent Claude Code session can write into, and the failure is silent — valid JSON, plausible symbols, no error — so you'd act on the wrong repo's map without any signal that it happened (`node_01KZP268STNZ6XC26FZVGMP12V`).

### Anti-Pattern: Repo Dump
```bash
# Avoid: blasting all source files into context
gemini "Review the whole codebase" --include-directories ./skillmeat -o text
```

### Context Hygiene Rules
- Inject repo map or symbol list to orient Gemini without full file reads
- Use `@./path/to/file` for only the files directly relevant to the task
- Use `.geminiignore` to exclude build artifacts, node_modules, generated files
- Prefer scoped prompts: "Review auth.py and its direct imports" over "review the auth system"
- For architecture questions, inject the symbols graph JSON, not all source files

## Anti-Patterns to Avoid

### Don't: Expect Immediate Execution
YOLO mode doesn't prevent planning. Gemini may still present plans.

**Do**: Use forceful language ("Apply now", "Start immediately")

### Don't: Ignore Rate Limits
Hammering the API wastes time on retries.

**Do**: Use appropriate models, batch operations

### Don't: Trust Output Blindly
Gemini can make mistakes, especially with security.

**Do**: Always validate generated code

### Don't: Over-Specify in Single Prompt
Extremely long prompts can confuse the model.

**Do**: Use incremental refinement for complex tasks

### Don't: Forget Context Limits
Even with 1M tokens, context can overflow and quality degrades with noise.

**Do**: Use .geminiignore, inject only relevant files, use repo map for orientation (see Pattern 14)

### Don't: Expect Full Output for Long Generations
65K output cap means large codebases or specs will be silently cut off.

**Do**: Chunk by file or section (see Pattern 13), use session resume for continuation
