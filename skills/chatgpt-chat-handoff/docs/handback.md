# Return contract, interruption recovery and promotion

## 1. Capture actual outputs

The receiver returns the expected artifacts and, in a non-image-only turn, `handback.json`.
Use stable output IDs from the manifest. Generated image names can differ from requested
names: record the mapping and save the actual selected variant. Retain originals separately
from crops or resized derivatives. Do not replace missing files with invented sandbox links.

A handback records protocol/version, pack ID, exact manifest digest, completion status,
completed turn IDs, files, findings, deviations, gaps and model/tool observations. Report
model identity as unknown unless exposed/observed; an operator-requested model is not proof.
For each file, include its actual relative return path and measured SHA-256, or null when
not measured. Never make up a hash. The local importer computes the authoritative local hash.

## 2. Source and decision preservation

Research returns should include sources and claims in durable fields as well as rendered
citations. Code returns include environment/test evidence. Image sets include output-ID
mappings, variant selection and QA issues. Artifact builds state what is editable and what
remains raster. Distinguish actual work performed from suggested next steps.

Preserve the original handoff and raw Chat response/export. Keep a record of live amendments
and fallbacks. Do not promote a recommendation to FROZEN merely because a frontier model
said it confidently. Return decisions as proposals unless authority was explicitly delegated.

## 3. Status and resumability

`complete`: all expected outputs delivered; substantive acceptance is still locally pending.
`partial`: some useful outputs exist, with precise gaps. `blocked`: no contracted progress
can continue without named input/capability/authorization. Completed turn IDs must match the
plan and form a dependency-closed set. A failed turn can be retried with a revised prompt;
record which output supersedes which original rather than erasing the earlier attempt.

Do not restart an entire multi-turn image series after a single failed image. Carry forward
approved assets by ID/hash and repair only the failed outputs. For new chats, provide the
reference, current turn, frozen decisions and required actual upstream files. Do not depend
on memory for precision. No future/background work is promised by this manual relay.

## 4. Local ingestion

Put actual returned files and `handback.json` in a separate return directory. Run:

```bash
python3 "$CGH_SKILL_ROOT/scripts/handoff.py" ingest PACK RETURN_DIR NEW_QUARANTINE
```

The utility checks the original frozen pack, return schema/identity, output IDs, safe paths,
completion claims and file hashes. It copies declared files into a new quarantine directory
and writes `INGESTION_RECEIPT.json`. Unknown stray files are not imported. Existing quarantine
destinations are refused. Failed checks cause no promotion; inspect the error and repair.

The receipt's `acceptance` remains `pending_local_review`. No returned code is run; no patches,
repo files, registry objects, project sources or memory are modified. Hash verification is
integrity evidence, not proof of trustworthy origin or semantic correctness.

## 5. Promotion gates

Review evidence and deviations, compare against the expected contract, run appropriate local
tests/rendering, inspect source claims, and obtain required approval. Then create a writeback
candidate for the owning repository/document. Use existing AOS/SkillMeat/IntentTree/CCDash
contracts when installed; record generic links through namespaced extensions otherwise.
This release invents no commands for those integration surfaces.
