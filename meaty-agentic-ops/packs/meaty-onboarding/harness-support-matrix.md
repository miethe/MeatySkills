# Harness support matrix — `meaty-onboarding`

Part of the onboarding-core member set (`MANIFEST.yaml`). Records, per harness, what "supported"
actually means today — not what it could mean once a gap closes. **"Reference-only" is stated in
the skill's own compatibility note — we do not claim support we haven't smoked.** A row is
promoted only after the gate in its own column has been run and passed; nothing here is upgraded
in anticipation of that happening.

| Harness | State | Discovery | Gate to promote |
|---|---|---|---|
| Claude Code | **Supported** | native skill loading | full route smokes |
| Codex | **Reference-only → Supported after `overlay_config` + first `.agents/` materialisation** | `.agents/` mirror; projection mechanism confirmed by code read, but `--apply-overlay` is fail-closed — it refuses any artifact without a verifiable per-artifact `overlay_config`, and no `.agents/` projection has ever actually run in-repo | author an `overlay_config`, materialise one real `.agents/` projection, THEN a route smoke via `codex exec` |
| Hermes | **Reference-only → Supported after validation** | deployed skill body via node context pack | one route read-through smoke on the node |
| Bob / Copilot | **Reference-only** | AGENTS.md pointer + skill body as plain markdown | prose-readability check only; promoted when a real consumption path is validated |

## Reading this table

- **Supported** means a real smoke has run and passed for that harness, on the mechanism named in
  "Discovery." Claude Code is the only row that clears this bar today.
- **Reference-only** means the harness can *see* the content (the discovery path resolves) but no
  consumption path has been exercised end to end. A reference-only harness is not broken — it is
  simply unproven, and the table says so instead of implying otherwise.
- The **Codex row is deliberately not "Supported."** The projection mechanism (`.agents/` mirror
  via `skillmeat deploy --profile codex --apply-overlay`) has been confirmed by reading the deploy
  code path, not by running it — `--apply-overlay` fail-closes on any artifact lacking a
  verifiable per-artifact `overlay_config`, and no onboarding-core artifact has one yet. An earlier
  pass asserted Codex support from that code read alone; this row was downgraded because support
  had been claimed from a path that had never actually run. **Do not quietly restore it** — the
  gate column above is what re-earns "Supported," not a second code read.
- Promotion for any row is a one-way, gate-passed transition, recorded by editing this file (and
  bumping the member group's currency note) — never inferred from "it should work by now."

## Where this matrix is consumed

Stated as measured on 2026-08-02, not as intended — an earlier draft of this section claimed
consumers that did not yet cite this file, which is the same decorative-claim failure the member
group exists to avoid.

**Actually cites this file today (one consumer):**

- `aos-onboarding`'s `SKILL.md` (`agentic_meta_dev/.claude/skills/aos-onboarding/SKILL.md`) — its
  Harness-Portability section defers per-harness support state here rather than restating it, and
  the path is in its Key References so check 9 resolves it.

**Does NOT cite this file yet — do not assume these inherit an edit made here:**

- **Route W** (`.claude/skills/aos-onboarding/routes/workflows.md`) — route bodies carry no harness
  state; the skill-level section above is the only path in.
- **The onboarding-skill template's Harness-Portability Checklist**
  (`agentic_meta_dev/.claude/skills/skill-dev/templates/onboarding-skill-template.md`) — it is the
  per-skill *authoring* checklist and currently points nowhere. Wiring it here is what would make
  this the cross-project support-state record for every skill stamped from the template, rather than
  for the one skill that happens to link it. Tracked, not done.

So: editing a support state here updates exactly one consumer today. Until the template is wired,
"every onboarding skill points at one table" is the goal, not the state.
