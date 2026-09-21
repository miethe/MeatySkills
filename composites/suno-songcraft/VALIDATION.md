# Validation report

Build: **1.0.0** · Checked: **2026-09-14**

## Executed checks

| Check | Result |
|---|---|
| Song packet checker and renderer unit tests | **58 passed** |
| Installer tests in temporary directories | **11 passed** |
| Total automated unit tests | **69 passed; zero failures** |
| Skill frontmatter and UI metadata | Both skills passed name, description, field, and prompt checks |
| SKILL.md size | Both entrypoints remain under 500 lines |
| Local Markdown references | 19 relative links resolved |
| Markdown fences | Balanced in all Markdown files |
| Runtime Python syntax | Parsed using Python 3.10 grammar |
| JSON Schema | Checked with Draft 2020-12 validator during development |
| Worked packets | Both passed independent JSON Schema and custom semantic checks |
| Copy-ready example rendering | Both matched their packet-generated text exactly |
| Installer dry run | Completed without creating user skill directories |

## Measured Style lengths

| Worked example | Variant A | Variant B | Variant C |
|---|---:|---:|---:|
| Carolina Rain | 961 | 951 | 975 |
| After Hours Circuit | 439 | 508 | Not applicable |

All example Style strings are ASCII, so their Unicode code-point and UTF-16 counts are identical. All fit the 1,000-character project ceiling. The final newline separating a Markdown fence is not part of the stored Style string; a standalone text-file count includes every actual newline in that file.

## Expected warnings

Carolina Rain retains warnings for unavailable source audio, unperformed audio testing, and unverified acceptance of optional surname shorthand. It also produces three instrument-scope review warnings because each variant excludes "trap drums" while drums remain desired: this is an intentional narrower exclusion, not a request to remove all drums. The instrumental example retains the unperformed-audio-test warning. These warnings remain visible for review; they are not suppressed errors.

## What these checks do not establish

**No songs were generated, listened to, or tested inside Suno during this build.** No credit expenditure, account access, or publication occurred. The tests do not establish exact singer identity, harmony execution, tempo/melody preservation, moderation acceptance, lyric originality clearance, or listening quality.

The pack includes **28 behavioral acceptance briefs** for a future agent evaluation. They are explicitly marked **not executed**. Structural/unit-test success is not equivalent to demonstrated Codex task performance across those cases.

## Tooling notes

Runtime scripts use only the Python standard library. PyYAML and jsonschema were used for additional development-time verification; users do not need them for installation or the bundled checker. The bundled checker implements the keyword subset used in its supplied schema rather than a general JSON Schema engine.

Source claims were checked against the dated primary-source registers. Sources and current account UI must be revisited when time-sensitive guidance is used; this report does not make the snapshot permanently current.
