# Routing Eval Scenarios

Fixture for manual routing-accuracy checks (PRD success metrics: ≥90% routing accuracy, ≥95% precision against negatives). 20 scenarios: 10 positive (skill should fire), 10 negative (skill should NOT fire).

Run-by-hand: take each prompt, ask whether the skill would fire and to which `router-table.json` intent, compare to `expected` below.

## Positive — skill should fire

| # | Prompt | Expected intent id | Expected command |
|---|---|---|---|
| P1 | "What's the state of this project?" | `project-status` | `ccdash status project --json` |
| P2 | "Summarize FEAT-123 for me." | `report-feature` | `ccdash report feature FEAT-123 --md` |
| P3 | "Give me the AAR for FEAT-123." | `report-aar` | `ccdash report aar --feature FEAT-123 --md` |
| P4 | "Which workflows are failing in this project?" | `workflow-failures` | `ccdash workflow failures --json` |
| P5 | "Show me the sessions linked to FEAT-456." | `feature-sessions` | `ccdash feature sessions FEAT-456 --json` |
| P6 | "Search the sessions for 'TLS handshake'." | `session-search` | `ccdash session search "TLS handshake" --json` |
| P7 | "Drilldown session SESS-abc for scope drift." | `session-drilldown` | `ccdash session drilldown SESS-abc --concern scope_drift --json` |
| P8 | "List all sessions sharing root SESS-xyz's root." | `session-family` | `ccdash session family SESS-xyz --json` |
| P9 | "Install ccdash and point it at staging." | `install-setup` + `target-add` | install recipe + `ccdash target add staging ...` |
| P10 | "ccdash just threw 'connection refused'." | (doctor) | `ccdash doctor` then `recipes/unreachable-server.md` |

## Negative — skill should NOT fire

| # | Prompt | Why not |
|---|---|---|
| N1 | "Write a React component for a login form." | UI work, unrelated to CCDash. |
| N2 | "Run `pytest` and fix the first failing test." | Generic test fix, not CCDash observability. |
| N3 | "Summarize this paper for me." | No CCDash context. |
| N4 | "Show the status of my Vercel deployment." | Different platform. |
| N5 | "List my Linear tickets in the INGEST project." | Different system (Linear). |
| N6 | "Set up Clerk auth for my Next.js app." | Different tool (Clerk). |
| N7 | "Generate a PRD for a new feature." | Planning skill, not CCDash CLI. |
| N8 | "Explain what SQLAlchemy does." | Unrelated explanation. |
| N9 | "Fix the TypeScript compile error in App.tsx." | Code fix, not CCDash CLI. |
| N10 | "Create a new CCDash backend endpoint for sessions." | Authoring code, explicitly out of scope per PRD. |

## Measuring

- **Accuracy** = `#correct_intent_on_positives / 10`.
- **Precision** = `1 - (#false_fires_on_negatives / 10)`.

PRD targets: accuracy ≥ 0.90, precision ≥ 0.95.

## How To Update

When a new intent ships, add one positive row here and consider one new negative row to catch over-firing. Keep the list at 10+10 — not growing without bound. Rotate out scenarios that have been "easy" for 3 CLI releases in a row.
