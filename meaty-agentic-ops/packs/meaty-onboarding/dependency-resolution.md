# Dependency resolution — `meaty-onboarding`

Part of the onboarding-core member set (`MANIFEST.yaml`). This is the same dependency-resolution
convention the onboarding-skill template carries at the per-skill level
(`agentic_meta_dev/.claude/skills/skill-dev/templates/onboarding-skill-template.md`, §"Dependency
Resolution") — mirrored here, not reinvented, so a project consuming this member group and a
project authoring a single onboarding skill from the template read the same three states and the
same honesty rule.

**What check 13 actually validates — and what it does not.** `depends_on:` (on a skill) and the
member entries in this pack's `MANIFEST.yaml` (on a member group) are **declarations**, nothing
more. `skill-dev`'s validator check 13 (`depends_on_wellformed`) validates only a skill's own
`depends_on:` **shape** — a well-formed `id` (`type:name`) and exactly one currency carrier.
**There is no resolver anywhere in this toolchain** — not for a skill's `depends_on:`, and not for
this manifest's `members:`. Nothing here installs, discovers, or auto-verifies an entry.
Resolution and currency-checking are a procedure the **consumer supplies**, carried as two fields
per entry it defines for itself:

- **locator** — the concrete command or path that decides **installed vs missing** for an entry
  (e.g. `test -d <snapshot-dir>`, or `git log -1 --format=%H -- <path>` returning non-empty).
- **verifier** — the concrete command that decides **current vs stale-vs-pin** for an entry's
  carrier (e.g. `make-snapshot.py verify <label>` for a `snapshot:` carrier; a `git log` SHA
  compared against a pinned `provenance_sha:` for the other).

**An entry with no filled-in locator/verifier is not usable** — those two states have nothing to
attach to. This manifest's own locator/verifier commands are listed in `MANIFEST.yaml`'s "How to
verify this manifest" footer rather than as a field on every entry, because they are shared across
members (the same `diff` triple and the same `make-snapshot.py verify v4.1` cover all three
doctrine members at once) — but the obligation is identical: run them before treating any member
as current.

Before answering anything that depends on a `meaty-onboarding` member, run that member's locator,
then its verifier:

| State | Reachable because | Required behavior |
|---|---|---|
| **installed** | locator finds the entry AND verifier confirms it is current | Use it normally, citing the resolved source (the upstream path, or the snapshot path for a `snapshot:`-carried member). |
| **missing** | locator finds nothing — path moved, snapshot directory absent, commit no longer reachable | **Visibly state degraded mode** — e.g. "`doctrine:execution-doctrine` did not resolve; this answer is unverified against its pin." Never fall back to a paraphrase from memory. |
| **stale-vs-pin** | locator finds the entry but verifier reports a mismatch | Same visible-degraded posture as missing — name the mismatch explicitly (e.g. "pinned to `workflow-set-v4.1`, `make-snapshot.py verify v4.1` reports drift" or "`provenance_sha` no longer matches the last commit touching this path") rather than silently using whichever content is newer. |

**Absolute rule, carried from the template unchanged:** never silently paraphrase canonical content
in place of stating which of these three states applies — say so, out loud, in the answer.

## Why this group has two currency shapes, not one

`skill:aos-onboarding` and `skill:skill-dev` carry `provenance_sha:` because neither has a
workflow-set snapshot (`skill:skill-dev` is deliberately excluded from workflow-set membership —
see its note in `MANIFEST.yaml`; `skill:aos-onboarding` postdates the v4.1 cut). The three
`doctrine:*` members carry `snapshot: workflow-set-v4.1` because they are excerpts of members that
*are* in that snapshot (`skill:planning`, `skill:dev-execution`), so their currency check is the
snapshot's own `verify`, not a bespoke commit comparison. Both are real, checkable carriers; neither
is decorative. Per the plan's rubric: nothing here claims a version that nothing produces.
