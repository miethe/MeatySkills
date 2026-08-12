Leave a star ⭐ if you like it 😘

# Codex Integration for Claude Code

## Purpose
Enable Claude Code to invoke the Codex CLI (`codex exec` and session resumes) for automated code analysis, refactoring, and editing workflows.

## Prerequisites
- `codex` CLI installed and available on `PATH`.
- Codex configured with valid credentials and settings.
- Confirm the installation by running `codex --version`; resolve any errors before using the skill. Verified against `codex-cli 0.144.0-alpha.4`.

## Installation

Store the skill in `~/.claude/skills/codex` (or symlink it from your skills launchpad).

## Usage

### Important: Thinking Tokens
By default, this skill suppresses thinking tokens (stderr output) using `2>/dev/null` to avoid bloating Claude Code's context window. If you want to see the thinking tokens for debugging or insight into Codex's reasoning process, explicitly ask Claude to show them.

### Example Workflow

**User prompt:**
```
Use codex to analyze this repository and suggest improvements for my claude code skill.
```

**Claude Code response:**
Claude will activate the Codex skill and:
1. Default to `gpt-5.6-terra` (workhorse) and ask which model to use only if you want to override (e.g. `gpt-5.6-sol` for the hardest reasoning / frontier SOTA, `gpt-5.6-luna` for cheaper·faster lighter work). `gpt-5.5`/`-pro` are superseded.
2. Ask which reasoning effort level — Light/Medium/High/Extra High = `low`/`medium`/`high`/`xhigh`, plus `ultra` (Sol/Terra only), and `none`/`minimal` below Light — unless already specified in your prompt.
3. Select an appropriate sandbox mode (defaults to `read-only` for analysis; `workspace-write` when edits are needed — `--full-auto` no longer exists).
4. Run a command like:
```bash
codex exec -m gpt-5.6-terra \
  --config model_reasoning_effort="high" \
  --sandbox read-only \
  --skip-git-repo-check \
  "Analyze this Claude Code skill repository comprehensively..." 2>/dev/null
```

**Result:**
Claude will summarize the Codex analysis output, highlighting key suggestions and asking if you'd like to continue with follow-up actions.

### Detailed Instructions
See `SKILL.md` for complete operational instructions, CLI options, the current model lineup, and workflow guidance.
