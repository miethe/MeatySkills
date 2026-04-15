# Output Mode Decision Rules

Every structured `ccdash` subcommand accepts `--output {human|json|markdown}` (with `--json` and `--md` shortcuts). Pick the mode up-front — do not re-run the command just to swap rendering.

## Rules

1. **`--output json`** (agent reasoning).
   Use whenever the result feeds into further reasoning, chaining, or tool calls. JSON preserves IDs and types. Default for: `status project` (agent), `workflow failures`, all `feature *`, all `session *` (except where narrative is explicitly requested).

2. **`--output markdown`** (user narrative).
   Use when the output will be rendered verbatim to the user as prose. Default for `report aar` and `report feature`; both produce a curated narrative that should not be re-summarized.

3. **`--output human`** (operator terminal).
   Use when the caller is an operator inspecting values in a terminal (target setup, doctor, manual spot-checks). Not for agent reasoning — fields are formatted for humans and may omit keys.

## Decision Shortcuts

| Caller | Intent | Mode |
|---|---|---|
| Agent | Triage, forensics, chaining | `json` |
| Agent | Rendering an AAR or narrative verbatim | `markdown` |
| Operator | Setup, doctor, `target list` | `human` |
| Operator | "show me a report" (they'll read it) | `markdown` |
| Either | Parsing into another tool | `json` |

## Anti-Patterns

- **Do not** read `--output human` in an agent then try to re-parse — call `--output json` instead.
- **Do not** dump large JSON to the user — that wastes their screen. Use JSON for reasoning; summarize the relevant fields to the user in natural language.
- **Do not** re-render a `markdown` report as a bullet summary. Render it verbatim; if the user wants a shorter summary, run a new command (or just a synthesized paragraph from the JSON variant of the same feature).

## Interaction With Global `--output`

`ccdash --output json <cmd>` sets the default for the whole invocation. Per-command `--output` or `--json` / `--md` overrides it. Prefer explicit per-command flags in recipes — easier to grep and explain.
