# IntentTree — DESIGN.md

**Version:** 0.1  
**Date:** 2026-04-30  
**Status:** Draft design handoff  
**Primary design direction:** iPad-first Apple-native glassmorphism  
**Primary product metaphor:** zoomable intent-to-execution tree  
**Primary outcome:** help users turn large goals into visible, sequenced, delegated, executable work.

---

## 1. Product Intent

IntentTree is a visual execution system that turns high-level intent into a living task tree. It helps a user move from a broad goal such as **“Build Execution OS / Agentic OS”** into progressively smaller levels of work until the system reaches atomic tasks that can be completed by a human, an agent, or a hybrid human-agent workflow.

IntentTree is not a normal task manager. It is an **execution map**.

A normal task manager asks:

> What do you need to do?

IntentTree asks:

> What are you trying to make true, what has to unlock first, and who or what should execute each part?

The design should support the feeling of a calm, premium command center: clear enough for serious execution, but visually engaging enough to keep momentum high.

---

## 2. Core Product Thesis

Big goals fail because they usually collapse into either vague lists or sprawling plans. IntentTree solves that by making the decomposition visible, navigable, and actionable.

The core loop is:

```text
Intent → Tree → Work Package → Atomic Task → Execute → Review → Update Tree
```

The long-term loop is:

```text
Capture → Distill → Decompose → Assign → Execute → Learn → Improve → Repeat
```

The user should always know:

1. where they are in the tree
2. why this node matters
3. what this node unlocks
4. whether the work is human, agent, hybrid, or autonomous
5. what the next executable step is

---

## 3. Design Principles

### 3.1 Clarity over completeness

The app may represent complex project graphs, but the interface must avoid making the user feel trapped inside the complexity. Use progressive disclosure, zoom levels, filters, minimaps, breadcrumbs, and focus mode.

### 3.2 Zoom, do not drown

The core UX is zooming. The user starts at the project level and drills deeper into task branches until reaching atomic work.

The user should never lose context while zooming.

Always preserve:

- breadcrumb path
- parent context
- zoom level
- minimap or orientation affordance
- current progress
- selected node state

### 3.3 Execution is the purpose

Maps are useful only if they lead to action. Every visible task path should eventually resolve into an executable next action.

### 3.4 Side quests are allowed, but contained

The product should preserve exploration without letting it hijack execution. Side quests should appear as optional branches, visually separated unless connected to the main path.

### 3.5 Shared work should be discovered

When different goals share an underlying task, capability, or reusable pattern, the system should surface it. This is a major differentiator.

Example:

```text
Telemetry & Analytics
  ↳ helps Execution Core
  ↳ helps Agent Runtime
  ↳ helps Control Plane
  ↳ helps Productionize First Service
```

The UX language for this is:

> Solve once, advance many.

### 3.6 Agents should feel powerful but inspectable

Agent execution must not feel magical or unsafe. Every agent action should show:

- what context is being used
- what tools are available
- what will be changed
- whether approval is required
- what output is expected
- how the result will update the tree

### 3.7 Delight should reinforce progress

Use subtle visual delight: glassy depth, small mascot moments, sparkle on completion, milestone glow, shared-work pulse, and friendly microcopy. Do not turn the standard theme into a noisy game UI.

---

## 4. Selected Visual Direction

### 4.1 Theme

The initial product should use the selected standard theme:

> **Apple-native inspired, iPad-first, clean glassmorphism with subtle delightful details.**

Avoid the more intense fantasy/Civilization styling for MVP. Keep that as a future alternate theme or persona mode.

### 4.2 Visual qualities

The interface should feel:

- calm
- premium
- spacious
- luminous
- tactile
- precise
- trustworthy
- slightly magical

### 4.3 Surface system

Use soft layered surfaces:

| Surface | Usage |
|---|---|
| `surface.base` | main app background |
| `surface.canvas` | tree workspace |
| `surface.glass` | cards, panels, inspectors |
| `surface.frosted` | sidebar, modal sheets, floating controls |
| `surface.elevated` | active cards, selected nodes |
| `surface.toast` | tips, hints, transient state |

Glass treatment:

- translucent white or dark navy depending on mode
- subtle blur
- soft border
- layered shadow
- very light gradient
- minimal noise texture

### 4.4 Color semantics

| Color | Meaning |
|---|---|
| Blue | primary execution, selected state, core tree paths |
| Green | complete, ready, on track, safe |
| Purple | agents, intelligence, side quests |
| Teal | knowledge, memory, wiki, context |
| Orange | quick wins, priority, attention |
| Red | blockers, risk, failure |
| Gold | milestones, unlocks, achievements |
| Gray | inactive, parked, weak/speculative links |

### 4.5 Typography

Use an Apple-like hierarchy.

Recommended:

- Native Apple platforms: SF Pro
- Web fallback: Inter, system UI

Rules:

- big, confident page titles
- compact section headings
- readable body text
- muted metadata
- tabular figures for metrics
- avoid dense paragraphs inside graph nodes

### 4.6 Iconography

Use crisp line icons with soft filled accent tiles for important objects.

| Concept | Icon direction |
|---|---|
| Intent | target / north star |
| Tree | branching node graph |
| Atomic task | leaf / check circle |
| Agent | small robot / sparkle-bot |
| Shared work | chain link / infinity |
| Quick win | lightning bolt |
| Side quest | sparkle / compass |
| Milestone | star / shield / diamond |
| Risk | warning triangle |
| Knowledge | book / brain / wiki tile |
| Homelab/platform | server / home / rack |

---

## 5. Primary Information Architecture

### 5.1 App-level navigation

The left sidebar should include:

1. Overview
2. Tree
3. Today
4. Projects
5. Tasks
6. Agents
7. Inbox
8. Notes
9. Artifacts
10. Insights
11. Settings

For MVP, the essential set is:

1. Overview
2. Tree
3. Today
4. Tasks
5. Agents
6. Inbox
7. Settings

### 5.2 Workspace-level views

Inside a project/intent:

1. Map
2. Horizontal Tree
3. Vertical Tree
4. Board
5. Timeline
6. Work Packages
7. Artifacts
8. Activity
9. Metrics
10. Settings

For MVP:

1. Map
2. Horizontal Tree
3. Vertical Tree
4. Today
5. Work Packages
6. Artifacts

---

## 6. Core Object Model

IntentTree uses a hierarchy of increasingly executable nodes.

### 6.1 Node levels

| Level | Name | Description | Example |
|---|---|---|---|
| L0 | Intent / North Star | Highest-level desired outcome | Build Execution OS / Agentic OS |
| L1 | Major Goal / Pillar | Major branch of work | Execution Core |
| L2 | Sub-Branch / Capability | Functional area | Planning Engine |
| L3 | Work Package | Scoped deliverable | Plan Authoring |
| L4 | Task Group | Small task cluster | Define Node Schema |
| L5 | Atomic Task | Leaf-level executable action | Add `id` field to node schema |

### 6.2 Node types

| Type | Meaning | Visual treatment |
|---|---|---|
| Intent | strategic outcome | large hero card, north-star badge |
| Major Goal | main project branch | large glass card, progress ring |
| Sub-Goal | mid-level capability | medium card or row |
| Work Package | concrete deliverable | detail-rich card/table row |
| Task Group | small cluster | checklist group |
| Atomic Task | executable unit | compact task card/checklist row |
| Milestone | checkpoint/unlock | diamond/shield/star badge |
| Side Quest | optional exploratory work | dotted border, purple accent |
| Quick Win | small high-leverage work | lightning icon, green/gold accent |
| Shared Work | reused across goals | link/infinity badge, dotted lines |
| Blocker | prevents progress | amber/red warning treatment |
| Agent Loop | recurring autonomous workflow | bot + loop indicator |

### 6.3 Execution modes

Every executable node should support:

| Mode | Meaning |
|---|---|
| Human | a person executes |
| Agent | an agent executes with tool access |
| Hybrid | agent scaffolds or executes, human reviews/refines |
| Autonomous | recurring or triggered agent loop with guardrails |

The UI should recommend a mode but allow override.

---

## 7. Example Seed Project: Execution OS / Agentic OS

Use this as the default demo/sample data for design and prototype work.

### L0 Intent

**Execution OS / Agentic OS**  
Build the operating system for intent-driven execution.

### L1 Major Goals

1. Execution Core
2. Knowledge Brain / MeatyWiki
3. Homelab Recovery
4. Agent Runtime
5. Integrations
6. Productionize First Service
7. Control Plane

### L2 Example: Execution Core

1. Planning Engine
2. Task & State Model
3. Execution Engine
4. Context & Memory
5. Observability
6. Error Handling

### L3 Example: Planning Engine

1. Plan Model
2. Plan Authoring
3. Plan Versioning
4. Plan Validation
5. Plan Templates

### L4 Example: Plan Authoring

1. Authoring API
2. Authoring UI
3. Node Types
4. Dependency Editor
5. Draft & Save
6. Plan Preview

### L5 Example: Define Node Schema

Atomic checklist:

1. Create `Node` interface/type
2. Add `id: UUID`
3. Add `title: string`
4. Add `description?: string`
5. Add `type: NodeType`
6. Add `status: NodeStatus`
7. Add `createdAt` and `updatedAt`
8. Add parent/child relationship fields
9. Add dependency references
10. Add execution mode metadata

---

## 8. Core Screens

### 8.1 Project Map / Zoomed-Out View

Purpose: show the entire project as a high-level map.

Required elements:

- iPad landscape frame
- left sidebar
- top search / command bar
- central map canvas
- major branch cards
- quick wins panel
- side quests panel
- shared-work pill or dock
- minimap
- legend
- zoom controls

Primary interactions:

- tap branch to zoom in
- pinch to zoom
- drag to pan
- tap side quest to park/promote/link
- tap shared-work pill to inspect overlap
- tap quick win to execute or schedule

### 8.2 Branch Detail

Purpose: show one major branch as a structured set of work areas.

Example: **Execution Core**

Required elements:

- breadcrumb path
- branch header
- progress bar
- on-track status card
- work area list
- quick-win strip
- map/list toggle

Rows should include:

- icon tile
- title
- short description
- progress
- status
- quick-win chips
- chevron

### 8.3 Sub-Branch Detail

Purpose: show a deeper capability area and reveal shared use.

Example: **Planning Engine**

Required elements:

- local tree context
- main capability list
- “also used by” badges
- shared map button
- tip / guidance card

Rows should show whether the capability is also used elsewhere.

### 8.4 Work Package Detail

Purpose: show a scoped deliverable with metadata, subtasks, owner, status, and overlap.

Example: **Plan Authoring**

Required elements:

- breadcrumb
- large work package header
- owner/status/progress/estimate/date metadata
- tabs: Subtasks, Details, Attachments, Activity, Risks, Notes
- right-side shared-with panel
- quick actions

### 8.5 Atomic Task Detail

Purpose: show the end of the decomposition chain.

Example: **Define Node Schema**

Required elements:

- atomic task label
- title
- description
- tags
- effort estimate
- priority
- subtasks/checklist
- execution mode selector
- dependency status
- progress history
- notes
- primary CTA: **Execute Next**

### 8.6 Daily View / Execution Train

Purpose: convert the tree into today’s work.

Required elements:

- horizontal time axis
- project lanes
- task cards
- active time marker
- side quests panel
- quick wins panel
- active agents panel
- focus mode card
- execution score

The daily view is where the map becomes lived execution.

### 8.7 Horizontal Tree View

Purpose: provide the “skill-tree” mental model in a clean native UI.

Required elements:

- left-to-right columns
- major goals on left
- sub-goals center
- side quests and quick wins right
- shared-work dock along bottom
- dotted shared-work lines
- filters and zoom controls

### 8.8 Vertical Tree View

Purpose: provide an outline-like hierarchy for dense review and editing.

Required elements:

- collapsible nested rows
- progress bars
- avatars/owners
- side quest markers
- quick status controls
- tree/board/timeline toggle

---

## 9. Zoom Interaction Model

### 9.1 Zoom states

| Zoom | View | User question answered |
|---|---|---|
| Z0 | Portfolio / all intents | What am I trying to advance overall? |
| Z1 | Project / intent | What makes up this goal? |
| Z2 | Major branch | Which workstream matters now? |
| Z3 | Capability / sub-branch | What functions compose this branch? |
| Z4 | Work package | What concrete deliverable needs to be built? |
| Z5 | Atomic task | What exactly can be executed next? |

### 9.2 Zoom requirements

Every zoomed-in screen must preserve:

- breadcrumb
- parent context
- back to parent
- zoom level indicator
- minimap or local context
- selected node state
- progress at current level

### 9.3 Zoom animation

Suggested behavior:

1. Selected card lifts and expands.
2. Non-selected siblings fade back.
3. Child nodes animate in from the selected node.
4. Breadcrumb updates.
5. Detail panel slides or morphs into place.
6. Shared-work lines redraw gently.

Keep animation smooth and useful, not decorative.

---

## 10. Shared Work Design

Shared work identifies where multiple branches can be advanced by one reusable task, pattern, artifact, or capability.

### 10.1 Visual treatments

| Element | Meaning |
|---|---|
| dotted blue line | cross-goal relation |
| chain-link badge | shared work |
| infinity badge | reusable pattern |
| shared-work dock | common foundational tasks |
| “also used by” pill | node contributes to another branch |
| subtle glow | active shared task |

### 10.2 Shared Work Inspector

When the user taps a shared-work indicator, show:

- connected goals
- reason for overlap
- affected tasks
- shared artifacts
- estimated leverage
- suggested grouping
- risk of merging
- actions: group, keep separate, split, dismiss

### 10.3 Microcopy

- “Solve once, advance many.”
- “Shared foundation detected.”
- “This work unlocks 4 branches.”
- “Group these tasks?”
- “Keep separate?”

---

## 11. Side Quests and Quick Wins

### 11.1 Side quests

Side quests are optional branches that may support, distract from, or eventually transform the main intent.

Possible actions:

- explore
- park
- promote
- link
- convert to project
- dismiss
- schedule

Visual treatment:

- purple accent
- dotted border
- floating/off-path placement
- optional connector only when relevant
- low visual priority by default

### 11.2 Quick wins

Quick wins are small, high-leverage tasks.

Fields:

- title
- estimated time
- impact
- connected goal
- suggested executor
- readiness

Visual treatment:

- lightning icon
- green/gold accent
- compact card
- one-click start/schedule

---

## 12. Agent UX

### 12.1 Assignment flow

```text
Open task
  → Review details
    → Choose Human / Agent / Hybrid / Autonomous
      → Configure context and permissions
        → Dry run or preview
          → Approve
            → Execute
              → Capture result
                → Update tree
```

### 12.2 Agent configuration panel

Show:

- selected agent
- task prompt/instructions
- context packet
- allowed tools
- allowed files/systems
- permissions
- approval requirements
- expected output
- dry-run toggle
- execution history

### 12.3 Agent statuses

| Status | Meaning |
|---|---|
| Ready | can accept work |
| Running | currently executing |
| Waiting Approval | needs user review |
| Blocked | missing context/tool/permission |
| Completed | output captured |
| Failed | run failed |
| Paused | user/system paused run |

### 12.4 Trust rules

- No destructive actions without approval.
- Always show context packet before execution.
- Always show proposed changes for write actions.
- Always capture output artifact.
- Always update node activity.
- Allow rollback/retry where relevant.

---

## 13. Daily View Design

The daily view should feel like a calm execution train.

### 13.1 Layout

- left sidebar
- top header: Today, date, status, execution score
- horizontal time axis
- project lanes
- task cards
- side quest panel
- quick wins panel
- active agents panel
- focus mode card

### 13.2 Project lanes

Example lanes:

1. Northstar Product Launch
2. IntentTree Platform
3. Personal Growth

Each lane contains scheduled or active cards.

### 13.3 Task cards

Each card should show:

- title
- time window
- progress
- status
- executor icon
- small project color
- dependency anchor if relevant

### 13.4 Connection lines

| Line | Meaning |
|---|---|
| solid | direct dependency |
| dotted | related/shared work |
| curved | cross-project influence |
| dashed gray | weak/speculative link |
| glowing blue/purple | active shared work |

### 13.5 Focus mode

Focus mode keeps:

- current task
- blockers
- next two tasks
- active agents
- highly relevant quick wins

Focus mode hides:

- unrelated lanes
- parked side quests
- passive dashboards
- low-value future tasks

---

## 14. Component Inventory

### Navigation

- Sidebar
- Breadcrumb
- Search/command bar
- View switcher
- Focus toggle
- Notification bell
- Workspace selector

### Tree components

- Intent hero card
- Major goal card
- Sub-goal card
- Work package row
- Atomic task card
- Milestone badge
- Side quest card
- Quick win card
- Shared work pill
- Dependency line
- Shared-work line
- Minimap
- Zoom controls

### Panels

- Detail panel
- Assignment panel
- Shared-work inspector
- Agent run panel
- Side quest panel
- Quick wins panel
- Daily focus panel
- Activity feed
- Artifact list
- Notes panel

### Actions

- Zoom in
- Zoom out
- Execute next
- Assign
- Add subtask
- Add side quest
- Add quick win
- Mark complete
- Block
- Link task
- Promote/demote
- Collapse/expand
- Filter
- Sort
- Export/share

---

## 15. State Model

### 15.1 Node status

```text
not_started
ready
in_progress
blocked
waiting_review
completed
deferred
archived
```

### 15.2 Node fields

```ts
type IntentNode = {
  id: string;
  parentId?: string;
  treeId: string;
  title: string;
  description?: string;
  type:
    | 'intent'
    | 'major_goal'
    | 'sub_goal'
    | 'work_package'
    | 'task_group'
    | 'atomic_task'
    | 'milestone'
    | 'side_quest'
    | 'quick_win'
    | 'shared_work'
    | 'agent_loop';
  status:
    | 'not_started'
    | 'ready'
    | 'in_progress'
    | 'blocked'
    | 'waiting_review'
    | 'completed'
    | 'deferred'
    | 'archived';
  executionMode?: 'human' | 'agent' | 'hybrid' | 'autonomous';
  progress?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  estimateMinutes?: number;
  ownerId?: string;
  agentId?: string;
  tags?: string[];
  dependencies?: string[];
  sharedWith?: string[];
  linkedArtifacts?: string[];
  acceptanceCriteria?: string[];
  definitionOfDone?: string;
  createdAt: string;
  updatedAt: string;
};
```

### 15.3 Edge fields

```ts
type IntentEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type:
    | 'parent_child'
    | 'dependency'
    | 'shared_work'
    | 'blocks'
    | 'suggests'
    | 'related'
    | 'side_quest_link';
  confidence?: number;
  reason?: string;
  createdBy: 'user' | 'agent' | 'system';
  createdAt: string;
};
```

---

## 16. Screen-to-Screen Flows

### 16.1 Tree zoom flow

```text
Project Map
  → Major Branch
    → Sub-Branch
      → Work Package
        → Task Group
          → Atomic Task
            → Execute
              → Review Result
                → Update Tree
```

### 16.2 Daily execution flow

```text
Tree State
  → Daily Train Generated
    → User Selects Current Task
      → Execute / Assign
        → Agent or Human Completes
          → Result Captured
            → Tree Updated
              → Next Task Recommended
```

### 16.3 Shared work flow

```text
Multiple branches contain similar work
  → System detects overlap
    → Shared Work Indicator appears
      → User opens Shared Work Inspector
        → User groups or keeps separate
          → Shared task advances multiple goals
```

### 16.4 Side quest flow

```text
New idea appears
  → Side Quest created
    → Park / Explore / Link / Promote
      → If useful, becomes branch or shared work
      → If not, remains optional or archived
```

### 16.5 Agent execution flow

```text
Atomic Task
  → Select execution mode
    → Review context packet
      → Configure agent/tools/permissions
        → Dry run
          → Review proposed action
            → Approve
              → Execute
                → Capture output
                  → Update task/tree/artifacts
```

---

## 17. AI-Assisted UX

AI should assist without taking away user trust.

### 17.1 Primary AI moments

1. Generate tree from intent
2. Decompose node into child tasks
3. Recommend next action
4. Detect shared work
5. Recommend side quests
6. Recommend quick wins
7. Recommend execution mode
8. Generate task context packet
9. Summarize progress
10. Update daily train
11. Merge duplicate tasks
12. Create after-action review

### 17.2 AI suggestion card

Every AI suggestion should include:

- title
- reason
- affected nodes
- confidence
- recommended action
- accept/edit/dismiss/explain controls

### 17.3 Shepherd assistant

The in-product assistant should be named **Shepherd** for MVP.

Shepherd’s role:

- clarify intent
- decompose work
- recommend next action
- identify overlap
- surface blockers
- maintain continuity
- help build today’s train

Tone:

- concise
- grounded
- operational
- low-drama
- encouraging but not cutesy

---

## 18. Empty States

### 18.1 Empty project map

Message:

> Start with an intent. We’ll turn it into an execution tree.

Actions:

- Add Intent
- Import Notes
- Generate from Prompt

### 18.2 Empty daily view

Message:

> Nothing scheduled yet. Pull today’s best tasks from your tree.

Actions:

- Build Today
- Add Task
- Ask Shepherd

### 18.3 Empty shared work

Message:

> No shared work detected yet. As your tree grows, common foundations will appear here.

Action:

- Scan for overlap

### 18.4 Empty agent view

Message:

> Agents will appear here when you assign work or connect tools.

Actions:

- Add Agent
- Configure Tools
- Learn About Execution Modes

---

## 19. Motion and Delight

### 19.1 Motion rules

- Animate for orientation.
- Preserve spatial context.
- Avoid excessive bounce.
- Respect reduced motion settings.
- Prefer calm line drawing, soft fades, and card morphs.

### 19.2 Recommended animations

- Zoom into node: card expands into new canvas.
- Shared work: dotted lines illuminate gently.
- Completion: small sparkle, checkmark, progress ripple.
- Side quest discovered: subtle slide-in.
- Quick win completed: lightning pulse.
- Agent running: breathing/pulse indicator.
- Milestone unlocked: restrained glow.

### 19.3 Easter eggs

Use lightly:

- small pixel tree mascot in sidebar
- tiny robot helper near agent tasks
- “You found me. Keep building.” tooltip
- “Solve once, advance many.” hint when shared work is detected
- progress tree grows leaves after meaningful completions

---

## 20. Accessibility

IntentTree must remain usable despite rich visuals.

Requirements:

- high contrast mode
- reduced motion mode
- keyboard navigation
- screen reader labels for nodes and edges
- status conveyed by icon/text, not color alone
- minimum 44px touch targets
- zoom controls independent of gestures
- readable text at all zoom levels
- outline/list equivalent for every graph
- table view for task relationships

Graph accessibility views:

- outline list
- dependency table
- next executable tasks list
- path summary
- blocked tasks list

---

## 21. Responsive Design

### 21.1 iPad landscape

Primary target.

- full sidebar
- canvas
- right detail panel
- minimap
- daily train
- high-value multi-panel layouts

### 21.2 iPad portrait

- sidebar collapses
- detail panel becomes bottom sheet
- map remains primary
- daily train becomes stacked timeline

### 21.3 Desktop web / Mac

- larger canvas
- floating inspectors
- keyboard shortcuts
- multi-select editing
- export/presentation mode

### 21.4 Mobile

Mobile should focus on execution, not full map editing.

Primary mobile surfaces:

- Today
- Inbox
- Atomic task
- Quick wins
- Agent runs
- Notifications
- Capture

---

## 22. MVP Scope

### 22.1 MVP must include

1. Project map
2. Zoom into branches
3. Work package detail
4. Atomic task detail
5. Daily train view
6. Horizontal tree view
7. Vertical tree view
8. Side quests
9. Quick wins
10. Shared-work indicators
11. Human / Agent / Hybrid assignment
12. Basic agent recommendation
13. Notes/artifacts attached to nodes
14. Progress tracking
15. Minimap / breadcrumbs
16. Basic onboarding

### 22.2 MVP can stub

- real agent execution
- external integrations
- automatic overlap detection
- sophisticated scheduling
- telemetry dashboards
- marketplace
- multiple themes

### 22.3 MVP should not include yet

- complex gamification
- public marketplace
- full enterprise admin console
- autonomous destructive changes
- deep mobile tree editing
- overbuilt reporting
- many visual themes

---

## 23. Implementation Notes

### 23.1 Recommended first prototype

Build an iPad/web prototype using static sample data.

Initial screens:

1. Project Map
2. Execution Core branch
3. Planning Engine sub-branch
4. Plan Authoring work package
5. Define Node Schema atomic task
6. Daily Train
7. Horizontal Tree
8. Vertical Tree

### 23.2 Suggested front-end stack

For fast prototyping:

- React or Next.js
- TypeScript
- Tailwind CSS
- Framer Motion
- Lucide icons
- React Flow or custom SVG/canvas layer for graph views

### 23.3 Graph rendering guidance

Use React Flow or a custom DAG renderer for MVP.

Requirements:

- pan
- zoom
- fit to view
- selectable nodes
- collapsible branches
- edge types
- minimap
- custom node cards
- keyboard navigation path

### 23.4 Data persistence

For early prototype:

- static JSON fixtures
- local storage for UI state
- optional file-based import/export

Later:

- SQLite/Postgres
- sync layer
- event log
- artifact store
- agent run store

### 23.5 Event log

Every important change should emit an event:

```ts
type IntentTreeEvent = {
  id: string;
  type: string;
  actorType: 'user' | 'agent' | 'system';
  actorId: string;
  nodeId?: string;
  treeId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
```

This enables timeline, review, telemetry, and future CCDash-style observability.

---

## 24. Success Metrics

### 24.1 Activation

- time to first tree
- time to first atomic task
- time to first completed task
- onboarding completion rate
- return next day rate

### 24.2 Execution quality

- tasks completed per week
- percentage of nodes with definition of done
- percentage of work decomposed to executable depth
- blockers resolved
- dormant projects reactivated

### 24.3 Agent utility

- agent-recommended tasks accepted
- agent/hybrid tasks completed
- human edits required after agent output
- failed/rejected agent runs
- average time saved

### 24.4 Shared work leverage

- shared work packages detected
- duplicate tasks merged
- branches advanced by shared work
- reusable patterns created

### 24.5 Cognitive load proxy

- number of times user asks “what next?”
- daily train usage rate
- weekly review completion rate
- focus mode usage
- side quests parked vs promoted

---

## 25. Design Risks and Mitigations

### Risk: the graph becomes overwhelming

Mitigations:

- focus mode
- vertical tree fallback
- filters
- minimap
- progressive disclosure
- daily train abstraction

### Risk: the app becomes too game-like

Mitigations:

- standard theme first
- optional persona themes later
- no heavy XP or noisy rewards in MVP
- delight only when it reinforces execution

### Risk: users do not trust AI recommendations

Mitigations:

- show reasoning
- show confidence
- show affected nodes
- allow edit before accepting
- require approval for meaningful changes

### Risk: side quests become distractions

Mitigations:

- parked by default
- visually separate from main path
- require explicit promotion
- show relationship to goals

### Risk: agent actions feel unsafe

Mitigations:

- dry run first
- visible context packets
- tool/permission display
- approval gates
- audit trail
- rollback options

---

## 26. Open Questions

1. Should the product be positioned personal-first, team-first, or agent-platform-first?
2. Should Today be the default home screen after onboarding?
3. Should side quests be primarily user-created, AI-suggested, or both?
4. How much automatic decomposition should occur before human review?
5. Should atomic tasks sync to GitHub Issues, Linear, Jira, or remain native first?
6. Should shared work be auto-merged or require explicit user approval?
7. Should agent execution be built in early or represented as export/handoff first?
8. Should “Execution OS” be the sample project or the actual first dogfood project?

---

## 27. North Star Experience

The user opens IntentTree and sees their ambition as a calm, navigable map.

They zoom into the branch that matters today.

The app shows:

- what this work means
- what it unlocks
- what depends on it
- whether it helps other goals
- who or what should do it
- what done means
- the next step

The user executes, delegates, or schedules it.

The tree updates.

The system learns.

The user keeps moving.

---

## 28. Design Summary

IntentTree should feel like an execution-native command center for ambitious work.

It combines:

- the clarity of a task manager
- the orientation of a map
- the motivation of a progression tree
- the structure of a project plan
- the intelligence of an agent orchestrator
- the memory of an execution system

The MVP should stay simple: one beautiful, usable, iPad-first glassmorphism experience that lets the user zoom from goal to atomic action and confidently execute the next step.

---

## 29. Research Foundations

IntentTree’s design is grounded in research from project management, human-computer interaction, graph visualisation, game progression systems, and gamified productivity tools.

### 29.1 Hierarchical decomposition: WBS and HTA

Work Breakdown Structure (WBS) practice supports the central IntentTree model: large goals should be decomposed into manageable hierarchical components, then into work packages that can be assigned and executed. Productive’s WBS guide describes WBS as a hierarchical blueprint that breaks complex projects into manageable components, starting with the main goal and branching into deliverables; it also identifies work packages as the smallest units that define specific tasks for accountability and execution【581685458378762†L186-L196】. The same source frames WBS as both visual and strategic, beginning from the project goal and branching through deliverables until specific work packages are reached【581685458378762†L211-L223】.

Hierarchical Task Analysis (HTA) reinforces the same UX premise: designers use HTA to organise user tasks into goals, subgoals, and steps, forming a task hierarchy that can reveal bottlenecks and streamline flows【638349825868239†L92-L113】. IntentTree turns that analysis method into a live product experience: the tree is not just a planning artifact, but the operating surface for execution.

### 29.2 Skill-tree design and meaningful choice

Skill-tree research and game-design commentary validate the motivational model but also warn against shallow gamification. A CivFanatics guide argues that a useful technology tree starts from themes and branches into pillars, but must eventually offer multiple interesting paths; it summarises the principle as “one choice = no choice” and warns against one dominant path that makes the rest of the tree underused【780552189301211†L142-L163】. It further argues that each tech should provide at least some universal benefit so the node is always better to have than not have【780552189301211†L188-L204】.

GDKeys’ “Keys to Meaningful Skill Trees” provides several directly applicable rules: skill trees should create meaningful, committing choices【493368889313097†L99-L113】, empower self-expression【493368889313097†L115-L123】, and avoid dull filler nodes that only provide stat bumps without changing behaviour【493368889313097†L145-L164】. Its rule of thumb that good skills include verbs—and great skills include unique verbs—maps cleanly to IntentTree’s atomic tasks: every executable task should begin with a concrete verb【493368889313097†L223-L239】.

### 29.3 Horizontal and vertical progression

Game progression research distinguishes horizontal progression, which gives players new options, from vertical progression, which increases scale or power. Game Developer defines horizontal progression as progress measured in “options”【762039458859954†L267-L288】 and vertical progression as progress measured in “scale”【762039458859954†L294-L314】. IntentTree should support both: zooming deeper into one branch provides vertical progress, while side quests, quick wins, and shared work create horizontal options.

Game Developer also defines progression as clearly stating goals and reinforcing how close or far the player is from the end goal【762039458859954†L219-L226】. That directly supports IntentTree’s core interaction model: every screen must answer where the user is, what progress has been made, and what action comes next.

### 29.4 Graph and tree visualisation UX

Graph visualisation research supports IntentTree’s progressive disclosure, minimap, and alternate view strategy. Cambridge Intelligence notes that graph UX succeeds when users can understand complex relationships, hierarchy, and flow, and when controls such as filtering, zooming, changing views, and expanding nodes feel intuitive【107871769564992†L102-L108】. It recommends defining the visualization’s purpose and audience, choosing the right format, using predictable layouts, and empowering users with essential tools without clutter【107871769564992†L284-L335】.

The same guidance calls out graph-specific problems—overcrowding, unclear labels, unfamiliar interactions, unclear hierarchy, and lack of groupings—and recommends progressive disclosure, interactive zooming, filtering, clustering, smart truncation, tooltips, and expandable groupings【107871769564992†L337-L363】. yWorks’ decision-tree guidance also warns that static trees become chaotic as all branches are shown, while interactivity can hide unexplored branches and reduce complexity; it specifically notes that new nodes and edges should be added without disturbing the user’s mental map【726258812406936†L24-L58】.

### 29.5 Glassmorphism and accessibility

Nielsen Norman Group describes glassmorphism as using translucency to create depth, but warns that overuse or poor visual-design fundamentals create accessibility and usability challenges【367255417241425†L62-L70】. Its best practices are directly adopted here: meet contrast requirements, use sufficient background blur when backgrounds are complex, and give users ways to reduce transparency or increase contrast【367255417241425†L190-L247】. IntentTree’s standard theme should therefore use glass sparingly for navigation, cards, and overlays, with a high-contrast mode and solid surfaces for dense data views.

### 29.6 Community tools and gamified productivity patterns

Skilltree demonstrates direct community interest in real-life skill-tree productivity. Its App Store listing describes a “video game skill tree for real life,” with habits, levels, XP, rewards, achievements, minimalist/gamified modes, analytics, routines, social features, and a skill tree for mental and physical habits【742690781730918†L65-L93】. Forest demonstrates a simpler focus metaphor: users plant a tree when they want to focus, it grows while they work, and it dies if they leave the app【642310976259223†L35-L56】.

IntentTree should learn from both without becoming a toy: use visible progress, small rewards, and delightful metaphors, but keep the main product oriented around real execution, agent delegation, work packages, and measurable outcomes.

## 30. Community Tool Landscape

| Tool / Pattern | What it proves | IntentTree implication |
|---|---|---|
| Skilltree | Real-life skill-tree metaphors can motivate self-improvement; gamified and minimalist modes can coexist.【742690781730918†L65-L80】 | Offer standard mode first, then alternate visual modes later. |
| Forest | A single vivid metaphor can make focus emotionally salient.【642310976259223†L35-L56】 | Use subtle progress metaphors: tree growth, leaves, small celebratory cues. |
| Jira / Linear / Asana / Todoist | Task hubs are effective for assignment and tracking, but usually flatten context into lists or boards. | IntentTree should integrate or export, not merely clone task lists. |
| Notion / Obsidian / Roam | Knowledge tools preserve context but rarely produce executable dependency graphs by default. | IntentTree should capture notes and convert them into nodes, tasks, and artifacts. |
| React Flow / yFiles / graph libraries | Interactive graphs need pan, zoom, minimap, fit-to-view, and custom node rendering. | Use a proven graph renderer for MVP rather than building layout primitives from scratch. |

## 31. Research-Derived Design Heuristics

1. **Every node must have a reason to exist.** Avoid filler tasks and vague labels.
2. **Every executable task starts with a verb.** “Define schema,” “Create fixture,” “Review output.”
3. **Show the forest before the trees, then zoom.** Users need context before action.
4. **Use multiple views for multiple questions.** Map for relationships, vertical tree for hierarchy, daily train for sequencing, board/list for bulk editing.
5. **Side quests should be visible but contained.** Let curiosity breathe without hijacking execution.
6. **Shared work should be first-class.** Show reuse and convergence explicitly.
7. **Glass is an accent, not the information architecture.** Legibility wins.
8. **Agent execution must be inspectable.** Show context, permissions, dry run, output, and tree update.
9. **Progress is motivational only when it is meaningful.** Avoid hollow percentages.
10. **Offer escape hatches.** List view, high contrast, reduced motion, collapse, search, filters, and “back to parent.”
