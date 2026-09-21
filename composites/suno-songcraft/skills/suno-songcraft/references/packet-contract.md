# Local song packet contract

Use `assets/song.packet.schema.json` only when reusable files or a tracked comparison help. A short creative reply needs no JSON. This format is **not a Suno API** and is never sent to Suno automatically.

## Fields

| Field | Purpose |
|---|---|
| `schema_version` | Local format version, currently `1.0` |
| `title`, `mode` | Working title and workflow scope |
| `platform` | Target model, factual verification date, explicit Style ceiling/basis, optional confirmed lyric ceiling |
| `brief` | Premise, language, edit permission, audio availability, genre responsibilities, groove, cast, instruments, constraints, assumptions |
| `artist_references` | User-reference-to-trait mapping and limited alias dictionary for linting; not a paste field |
| `lyrics` | Source sung text/section labels, current tagged text, protected exact lines, substantive edit notes |
| `variants` | ID, purpose, changed axis, constants, Style and exact counts, optional lyric override, Exclude, edit brief, reference mode, caveats |
| `evaluation` | Whether audio was actually reviewed and what remains untested |

Keep `lyrics.original` when supplied lyrics are edited. Remove old production directions from the source copy only when they are clearly nonsung; never erase intended ad-libs. The unchanged source words and punctuation remain available for comparison.

Set `brief.lyric_edit_level` to `none` for a preserve-words task. The checker then compares the ordered nonempty sung lines, ignoring standalone bracketed cues and outer line whitespace, against `lyrics.original`. In `light` or `rewrite` mode, `locked_lines` must still appear exactly in every applicable lyric version. This is an occurrence check, not proof that every repeat of a hook is identical; review section-level changes manually.

Store tempo beat-unit assumptions rather than quietly changing the user's number. Model is a string so future versions do not require schema changes. A future verification date is flagged; an old snapshot is a refresh warning. Neither is an automatic online verification.

## Variants

Require a unique ID. A descriptive variant must not include any artist alias listed in the brief in its paste-ready fields. A surname-shorthand variant must carry an acceptance caveat; full multiword aliases are rejected by the local shorthand contract. This is a project export rule, not a platform moderation emulator.

A null `lyrics_override` uses the shared lyrics. A string override is a fully paired lyric version. Record the primary changed axis and hypothesis even if the comparison is just reference encoding. A first baseline is expected; later alternatives should not masquerade as new baselines.

## Commands

```bash
python3 <skill-dir>/scripts/songcheck.py count style.txt --limit 1000 --json
python3 <skill-dir>/scripts/songcheck.py check song.packet.json --json
python3 <skill-dir>/scripts/songcheck.py render song.packet.json --output song.copy.md
```

`count` reads the exact UTF-8 file contents, including any final newline or CRLF; it never strips whitespace. It reports code points and UTF-16 code units. `check` validates the schema subset actually used by this bundled schema, counts, locks, cue layout, aliases, IDs, and selected contradictions. It exits nonzero on errors; warnings require judgment. It does not hear music, infer scansion, certify rights, or predict moderation.

`render` refuses invalid packets and existing output files unless `--overwrite` is explicitly supplied. It puts measured counts and caveats outside the copy-ready fields. Use Python 3.10+; scripts have no third-party runtime dependencies or network access.

`--as-of YYYY-MM-DD` on `check`/`render` makes the freshness comparison reproducible. A 30-day warning threshold is a pack maintenance heuristic, not a statement about Suno's release cadence. Every claim of “latest” still requires current verification when used.

For exact general-purpose JSON Schema validation in another tool, use the schema as supplied. `songcheck.py` intentionally implements only the keyword set used here; it is not a generic JSON Schema library. Extending the schema requires extending its tests/checker too.
