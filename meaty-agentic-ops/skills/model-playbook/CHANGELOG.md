# Changelog — model-playbook

## 1.2 — 2026-10-03

- Add the missing sibling changelog required by the skill authoring contract. Publish it as part of the complete artifact bundle so governed deployments carry it alongside all route files.
- Record the personal Codex account procedure: Secondary (`codex_secondary`) is the default; Primary (`codex_primary`) is explicitly selected. Both preserve personal Claude primary / `claude1x` work, privacy, and permission eligibility, while task, model, effort, sandbox, and gates remain independent.
- Account unavailability returns to the routing owner for an explicit decision; automatic account rotation is forbidden. ICA remains a separate provider and privacy boundary. Both personal accounts require explicit model and effort pins.
- Reconcile the already-served Claude route reference to GPT-6.1 Sol, preserving the catalog's GPT-6.1 substitution for the earlier GPT-6 Sol raw-strength reference.
- Preserve the existing route content except for the GPT-6.1 Sol reference correction above and the added personal Codex account procedure. This release documents routing policy; it does not change resolver, authentication, or dispatch implementation.
