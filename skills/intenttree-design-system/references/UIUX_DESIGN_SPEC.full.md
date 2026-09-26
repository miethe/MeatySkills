# IntentTree UI/UX Design Specification

**Version:** 0.2 (2026‑05‑02)

**Overview:**  This specification translates the high‑level design of the **IntentTree** execution platform into concrete UI and UX guidelines, incorporating findings from game design, project management, data‑visualisation and mobile UI research.  It is meant to guide developers and designers during prototype and MVP development.

## 1. Product Purpose

IntentTree is a visual execution system.  It converts broad goals into an evolving tree of work that users can explore, decompose, assign and complete.  The system’s key differentiators are its zoomable map, its blend of human and agent execution, its discovery of shared work across goals, and its calm, premium aesthetic.

## 2. Research‑Driven Principles

- **Clarity through hierarchy:**  Following work‑breakdown and hierarchical task analysis, break goals into nested nodes (L0–L5) to improve planning, resource allocation and risk management【581685458378762†L186-L223】【638349825868239†L94-L113】.  Each zoom level answers a distinct question—“What am I trying to achieve?”, “What makes up this goal?”, “What can I do next?”—and preserves context with breadcrumbs and minimaps.

- **Meaningful branching:**  Skill‑tree research underscores that users value trees that demand thoughtful choices, avoid wasted nodes, and offer multiple viable paths【780552189301211†L137-L204】.  The UI should surface alternate branches, shared‑work links and optional side quests so that users consciously choose their path rather than passively follow a linear list.

- **Horizontal + vertical progression:**  Game‑progression theory differentiates between horizontal progression (unlocking new options) and vertical progression (getting stronger or deeper)【762039458859954†L269-L299】.  IntentTree supports both: users can deepen a branch or advance multiple goals via shared tasks.  Goals must be clearly stated and progress visibly reinforced【762039458859954†L221-L226】.

- **Progressive disclosure:**  Graph‑visualisation guidelines stress hiding irrelevant branches and revealing details on demand【107871769564992†L284-L335】.  Expand only the necessary portion of the tree, and maintain the mental map when nodes expand or collapse【726258812406936†L24-L56】.  Use filters, search and minimaps to manage complexity.

- **Accessible glassmorphism:**  Glassmorphic elements provide depth and delight, but they must maintain text contrast, use sufficient blur and offer high‑contrast/low‑transparency modes【367255417241425†L190-L247】.  Avoid over‑decorating; use translucency sparingly and pair it with solid surfaces where necessary.

- **Gamified motivation, not distraction:**  Apps like Skilltree and Forest show that game metaphors can motivate productivity【742690781730918†L66-L93】【642310976259223†L40-L56】.  Borrow elements like progress bars, unlock animations and small mascots, but ensure they reinforce execution rather than distract.  Avoid XP systems or loot boxes in the MVP.

## 3. Core Flows

### 3.1 Tree Zoom Flow

1. **Project Map (Z1):**  Display all L1 major goals as cards on a map.  The user taps a card or double‑clicks to zoom in.
2. **Branch View (Z2–Z3):**  Show sub‑goals or work packages.  Provide progress bars, status icons, and show if nodes are shared with other branches.  Allow horizontal navigation across siblings.
3. **Work Package (Z4):**  Present tasks grouped into task groups.  Show metadata (owner, priority, status) and quick actions: assign, schedule, convert to side quest.
4. **Atomic Task (Z5):**  Reveal the checklist, execution mode selector (human/agent/hybrid), context packet and dependencies.  Include an **Execute Next** button.
5. **Execute → Review:**  For agent tasks, open the agent configuration panel; for human tasks, launch an appropriate tool (e.g., note editor).  After completion, present a review summary and update the tree.

### 3.2 Daily Execution Train

The daily train translates the tree into a horizontal timeline of tasks for the current day.  It shows project lanes, scheduled tasks, quick wins and side quests.  It should:

- Pull tasks with high priority or due soon; allow the user to reorder.
- Highlight shared tasks that advance multiple goals.
- Display optional side quests in a separate panel; connecting lines indicate shared dependencies.
- Provide a focus mode that isolates the current task, the next two tasks and any active agents.

### 3.3 Shared Work Flow

When the system detects duplicate or reusable tasks across branches, display a dotted line and chain‑link badge.  Tapping the badge opens a **Shared Work Inspector** showing affected goals, the reason for overlap, and actions (group, keep separate, split).  This encourages “solve once, advance many.”

### 3.4 Side Quest Flow

Users or AI can create side quests from ideas or captured notes.  Side quests appear off the main path with a purple accent and dotted outline.  Users can park them for later, explore to reveal details, promote them to become a branch, link them to existing nodes, or dismiss them.  Keep them visually distinct to prevent accidental distraction.

### 3.5 Agent Execution Flow

1. **Select execution mode:**  At the atomic task level, choose human, agent, hybrid or autonomous.
2. **Configure agent:**  For agent modes, show the selected agent, tools, permissions, context packet and expected output.  Provide a dry‑run preview.  All destructive actions must require approval.
3. **Execute and capture:**  After approval, run the task and capture the output artifact (e.g., summarised notes, code patch, updated wiki page).  Display status (running, waiting approval, completed, failed).
4. **Update tree and log:**  Record an event, update node status and progress, attach the artifact, and, if appropriate, recommend the next task.

## 4. Screen Specifications

### 4.1 Project Map

| Element | Description |
|---|---|
| **Sidebar** | Houses global navigation: Overview, Tree, Today, Tasks, Agents, Inbox, Settings.  Collapses on portrait or mobile. |
| **Map Canvas** | Displays major goals as glass cards.  Cards show title, progress ring, and an indicator if the goal has shared work or pending side quests.  Support pan and pinch‑to‑zoom. |
| **Minimap & Breadcrumbs** | Provide orientation by showing the location within the tree and a breadcrumb path (e.g., *Intent → Execution Core → Planning Engine*). |
| **Legend & Filters** | Explain color semantics and allow filtering by status, execution mode, priority or owner. |
| **Quick Win Dock** | A tray showing quick‑win tasks; tapping executes them directly. |
| **Side Quest Panel** | A collapsible area listing side quests with impact estimates. |

### 4.2 Branch & Sub‑Branch Views

Present branch content in a split‑pane layout:

- **Header:** title, progress bar, status (on track, blocked, at risk), description and due date.
- **List/Grid of child nodes:** each row shows icon, title, description, progress bar and badges for shared work, quick wins or blockers.  Provide inline actions to expand, assign or convert to side quests.
- **Shared Work Bar:** optional bar summarising tasks shared with other branches.  Tapping reveals more details.

### 4.3 Work Package & Task Group Views

The work package screen emphasises planning and context:

- **Overview panel:** owner avatar, effort estimate, priority, current status and expected completion.  Provide edit actions.
- **Tabs:** Subtasks (task groups), Details (requirements, acceptance criteria), Attachments (documents, prompts, artifacts), Activity (event log), Risks, Notes.
- **Right rail:** display shared work connections, side quests, quick wins and recommended AI actions.

Task groups function as collapsible checklists with metadata (owner, due date, execution mode).  Completed items animate gently and collapse.

### 4.4 Atomic Task View

- **Label & Title:** show the leaf status (atomic task) and the node’s title.  Use a compact card with a clear call to action.
- **Execution Mode Selector:** human, agent, hybrid or autonomous.  Default to the recommended mode but allow override.
- **Context Packet:** summarised inputs, dependencies, relevant notes and related artifacts.
- **Checklist/Subtasks:** micro‑steps; checking them off updates progress.  Provide an “execute now” button when ready.
- **Dependency & Status Indicators:** highlight blocked tasks with warning icons and tooltips.  Show upstream dependencies.
- **Notes & History:** allow adding notes and reviewing event log entries for this task.

### 4.5 Daily Train

Depict the day as a horizontal timeline with lanes for each active project.  Each lane contains task cards sized proportionally to their estimated duration.  Use connection lines to show dependencies and shared tasks.  Provide a “focus mode” toggle that zooms in on the current task and hides other lanes.  A side panel lists quick wins and side quests.  Agents running tasks appear as pulsing icons with status indicators.

## 5. Visual Design System

**Color palette:**

- **Blue:** primary execution (selected state, core paths)
- **Green:** complete or ready
- **Purple:** agents, intelligence, side quests
- **Teal:** knowledge, memory, wiki context
- **Orange:** quick wins, priority
- **Red:** blockers, risk, failure
- **Gold:** milestones, achievements
- **Gray:** inactive, speculative or parked

**Typography:**  Use SF Pro or system UI typefaces with clear hierarchy.  Page titles should be large and confident; section headings medium; body text legible at small sizes.  Avoid long paragraphs inside node cards; summarise and link to detailed notes instead.

**Iconography:**  Employ crisp line icons for concepts such as Intent, Goal, Task, Agent, Shared Work, Quick Win, Side Quest, Milestone and Risk.  Each icon sits within a soft rounded square with a color accent matching its type.

**Surfaces:**  Base surfaces are muted gradients or dark navy.  Cards, panels and inspectors use translucent glass layers with subtle blur and soft borders.  Elevated cards cast gentle shadows.  Provide a high‑contrast alternative theme using solid surfaces.

**Motion:**  Animations should orient the user: cards expand to reveal details, dotted lines animate when shared work is detected, and small sparkles accent completed tasks.  Support reduced motion preferences.

**Accessibility:**  All UI elements must meet WCAG contrast ratios【367255417241425†L190-L247】.  Provide keyboard navigation, accessible labels for nodes and edges, high‑contrast mode, reduced transparency mode and non‑color indicators for status.  Always accompany color with icons or text.

## 6. Metrics and Success Criteria

1. **Engagement:** time to first tree, tasks completed per week, return rate, daily train usage.
2. **Execution depth:** percentage of work decomposed to atomic tasks, ratio of completed tasks to quick wins and side quests, blockers resolved.
3. **Agent adoption:** number of agent‑executed tasks, acceptance rate of AI suggestions, human edits required per agent run.
4. **Shared work leverage:** number of shared tasks detected, branches advanced by shared work, duplicate tasks merged.
5. **Cognitive load:** user queries about “what next?”, focus mode usage, review completion rates.

## 7. Future Considerations

Beyond the MVP, explore advanced features such as:

- Real‑time collaboration and multiplayer editing of trees.
- Integration with external platforms (GitHub, Jira, calendar) to synchronise tasks and artifacts.
- Template marketplace for common project types (product launch, research paper, home renovation).
- Adaptive themes (fantasy, sci‑fi) that change the tree’s visual metaphor.
- AI‑driven after‑action reviews and recommendation of new skills or agents based on historical performance.

## 8. Appendix: Design Language Infographic

The following infographic summarises the product vision, core principles, research influences and key interface components.  It can serve as a quick reference for onboarding new team members.
