# Local adoption, duplicate gate and Chat Project setup

## 1. What this release is and is not

This release is a staged implementation, not a deployment into Nick's local ecosystem.
The supplied `skill-dev` contract governs. The package uses its required frontmatter,
headings, changelog, optional pinned dependency, and co-shipped `.claude/` Key References.
The normative SPEC permits those relative paths even though the older template says
absolute-only. No author-home absolute paths are fabricated.

The supplied canonical `validate_skill.py`, its fixture suite, current repository contents,
SkillMeat catalog and running local CLI were not provided to this build. Their gates remain
pending. Supplemental release tests must not be described as that official validator.

## 2. Duplicate gate before copying or registering

Prior context names possible adjacent artifacts: `aos-handoff-packet`,
`chatgpt_pro_human_relay`, `gpt55pro_review_packet_builder`, and `asdlc-cross-model-handoff`.
These are lookup candidates, not assertions that they are currently deployed.
Search local skill descriptions and the catalog, for example:

```bash
rg -n -i 'chatgpt|handoff|human.relay|review.packet' .claude/skills \
  "$HOME/.claude/skills" --glob SKILL.md
skillmeat search "chatgpt handoff"
skillmeat search "human relay"
```

Extend the upstream skill if it already owns this exact job. The proposed distinction is:
“Chat-only typed capability briefs + matching Project receiver references + image-safe
multi-turn and artifact return contracts,” not a second generic transport or packet schema.
If a parent AOS packet exists, embed/link this adapter in its extension surface and preserve
its IDs, provenance, routing and writebacks. Do not claim compatibility with an unseen schema.
Record the extend/new decision and owning edit point in the local adoption receipt.

## 3. Stage and validate

After the duplicate decision, copy or merge the authored tree into the selected upstream:
`.claude/skills/chatgpt-chat-handoff/`. Never hand-create the Codex mirror.
Use an isolated environment; the bootstrap script itself needs only Python's standard library.

```bash
export CGH_SKILL_ROOT="$PWD/.claude/skills/chatgpt-chat-handoff"
python3 -m venv .venv-cgh
. .venv-cgh/bin/activate
python3 -m pip install -r "$CGH_SKILL_ROOT/requirements.txt"
python3 -m unittest discover -s "$CGH_SKILL_ROOT/tests" -v
python3 "$CGH_SKILL_ROOT/scripts/handoff.py" reference --verify --snapshot cgh-reference-v1.0.0
python3 "$SKILL_DEV_ROOT/scripts/validate_skill.py" "$CGH_SKILL_ROOT" --strict
```

Set `SKILL_DEV_ROOT` to the actually installed canonical skill-dev location. If it cannot
be found, report cannot-determine; do not pretend its validation succeeded. Run its own
fixture suite using its installed instructions as well. Check local Python/harness versions.

## 4. Registration and harness projection

Follow the current installed `skillmeat-cli` instructions. The supplied authoring contract
specifies this creation sequence; recheck current CLI syntax before making changes:

```bash
SKILLMEAT_EDITION=local skillmeat add skill .claude/skills/chatgpt-chat-handoff --yes
skillmeat deploy chatgpt-chat-handoff --type skill
```

Declare the artifact in `.claude/aos-artifacts.yaml` and its upstream edit point in
`docs/ARTIFACT-UPSTREAM-REGISTRY.md`, preserving the actual local schemas. In the skillmeat
repository, also perform its additive SPEC/index registration. Do not insert an invented
YAML registration structure. Supporting-file changes require SkillMeat's generated Codex
overlay where used: `skillmeat deploy chatgpt-chat-handoff --profile codex --apply-overlay`.
Confirm deployment with the actual registry/deployment evidence, not the command text.

## 5. Additive AGENTS.md / CLAUDE.md bootstrap

Once the canonical skill exists at the target, preview:

```bash
python3 "$CGH_SKILL_ROOT/scripts/bootstrap.py" --target "$PWD"
```

The proposed blocks point at the skill and its usage boundary. Review then add `--apply`.
Unrelated text is preserved; original files are backed up on change. Identical reruns do
nothing. A hand-edited managed block is not overwritten. Apparent generated instruction
files are blocked: patch their compiler/source input instead. The script never touches
`.agents/` or executes SkillMeat, git, package installers, browser actions or account writes.

## 6. Chat Project setup

Keep using **Chat mode**. Upload these three files from the companion pack as Project sources:
`CGH_REFERENCE_v1.0.0.md`, `CGH_CAPABILITIES_2026-09-17.md`, and
`CGH_DESIGN_PROFILES_v1.0.0.md`. Alternatively upload the combined
`CGH_ALL_SOURCES_v1.0.0.md` instead of those three, never both. Separate files make changing
capability facts cheaper without replacing the stable protocol. ZIP is a delivery container,
not a substitute for these readable Project sources.

Append/merge `PROJECT_INSTRUCTIONS.md` into the Project's existing instructions. Optionally
merge `GLOBAL_CUSTOM_INSTRUCTIONS_APPEND.md` into global customization. These are additive
snippets; do not replace unrelated existing preferences. They cannot edit OpenAI's actual
system/developer instructions. No settings or sources are changed automatically by this release.

Project instructions apply within their project and can override global custom instructions
[OAI-03]. Therefore include the invocation router in each Project that should handle these
packs. The global snippet is a lightweight fallback, not an assumed cross-project installation.

Do not upload credentials, internal source paths, sensitive client material or redaction maps.
A work-themed graphic does not authorize using enterprise data in a personal subscription.
Use the approved IBM/internal route for sensitive work; generic sanitized assets may be prepared
here only within actual policy/approval. Privacy settings do not create enterprise approval.

## 7. First-run acceptance

Use the sanitized examples. Verify the UI shows Chat; check the chosen model/thinking/tool
separately. Run a simple search, one image, and a small return import before a large workflow.
Record observed capabilities and dates locally. Mark a route operationally validated only after
an actual round trip, and retain any limitations. No live round-trip evidence is claimed here.
