# Changelog — model-playbook

## 1.3 — 2026-10-16

- ICA refresh (Nick, 2026-10-16): `routes/ica-lanes.md` gains the refresh table and probe facts;
  `routes/anthropic-claude.md` records the ICA lanes for `claude-sonnet-5-5[1m]` (default ICA Sonnet) and the free
  `claude-haiku-5-5[1m]`; `routes/openai-gpt.md` gains `gpt-6-luna` and `gpt-6.1-sol` sections (ICA lanes) and marks
  the 5.6 ICA ids legacy (Terra has no replacement); `SKILL.md` routing table lists the new keys. Documents routing
  facts only; the Claude-Code-via-`ica-gpt`-shim defect is recorded, not fixed.

## 1.2 — 2026-10-03

- Add the missing sibling changelog required by the skill authoring contract. Publish it as part of the complete artifact bundle so governed deployments carry it alongside all route files.
- Record the personal Codex account procedure: Secondary (`codex_secondary`) is the default; Primary (`codex_primary`) is explicitly selected. Both preserve personal Claude primary / `claude1x` work, privacy, and permission eligibility, while task, model, effort, sandbox, and gates remain independent.
- Account unavailability returns to the routing owner for an explicit decision; automatic account rotation is forbidden. ICA remains a separate provider and privacy boundary. Both personal accounts require explicit model and effort pins.
- Reconcile the already-served Claude route reference to GPT-6.1 Sol, preserving the catalog's GPT-6.1 substitution for the earlier GPT-6 Sol raw-strength reference.
- Preserve the existing route content except for the GPT-6.1 Sol reference correction above and the added personal Codex account procedure. This release documents routing policy; it does not change resolver, authentication, or dispatch implementation.
