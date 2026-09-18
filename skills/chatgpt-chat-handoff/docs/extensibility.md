# Extensibility, freshness and reference publishing

## Separate five kinds of change

**Protocol/schema:** field or meaning changes. Unknown core fields fail, so use a major
version for incompatible meaning/removal. Add a migration, schema tests and new renderer
coverage. Namespaced extensions can carry optional AOS adapter metadata without altering
core fields. Required extension semantics must still be explicitly agreed, not silently ignored.

**Capability facts:** edit `registry/capabilities.json`, preserve exact source URLs, record
verification date and raw publication/update labels, and mark unknowns honestly. Recheck
current official product docs and the operator's UI; the two are different evidence types.
Do not hardcode UI labels, allowances, quotas, context windows or batch limits into SKILL.md.

**Design profile:** edit the owned token/profile record and its version. Keep user-preference
presets distinct from official templates. A breaking visual change gets a new profile ID
or version and an explicit migration. Asset-bound profiles must retain actual file hashes.

**Operator settings:** exact subscription tier, allowed data, preferred effort, batch sizes
and enabled tools. These can change without changing the protocol. Never infer precise plan
allowances from “Pro” alone. Record a check date; null/unknown is a valid honest observation.

**Implementation:** renderer, validator, bootstrap, examples or tests. Preserve compatibility
and human edits; test all routes after changes. Do not hand-edit generated upload copies.

## Currency policy

The release chooses a 14-day review interval for capability facts. That interval is an operator
policy, not a product guarantee. A stale snapshot warns during validation and must be rechecked
before relying on an unstable feature. UI state is checked per run; an old screenshot cannot
prove current availability. A capability that is unknown is not automatically unavailable.

Dependency checking returns current/installed, stale-or-missing, or cannot-determine. The
shipped locator/verifier requires `CGH_SKILL_ROOT` set to the loaded skill directory and works
at arbitrary install paths. A missing environment/root is cannot-determine, not missing.
Reference verification is local integrity verification; it does not browse or inspect Chat.

## Publishing both halves

1. Edit canonical skill docs, schemas or registry; bump the skill version/changelog as required
   by skill-dev. Keep schema/reference semantic versions independently explicit.
2. Run unit and mutation tests and official authoring validation.
3. Run `scripts/publish_reference.py --out NEW_EXPORT_DIR` to build reference-manifest and
   companion readable source files. This updates generated reference metadata in the upstream
   tree; review the diff. Never run it against an unreviewed deployed copy to bless drift.
4. Recreate affected example manifests using the new snapshot digest; validate/render/bundle.
5. Deploy through SkillMeat and replace superseded Project sources explicitly. Keep old source
   exports in the local release archive, not as competing active sources with the same ID.
6. Record installed reference version, uploaded version and actually observed loading separately.

The publisher refuses an existing export destination. The reference digest binds the canonical
source docs/schemas/design records; the capability snapshot has its own identity and date.
A matching name is insufficient: compare version and digest. If the receiver cannot inspect
bytes, record the version it could read rather than claim a cryptographic verification.

## Additional capabilities

Add capability enum → payload schema → UI route → procedural template → receiver instructions
→ positive and negative fixtures → a live acceptance test. Example candidates include audio,
video and other approved tools. Do not add tool-specific secrets or UI automation to this skill.
An integration adapter should call the current installed AOS/SkillMeat contracts rather than
inventing commands. The supported first-release transport remains human relay.
