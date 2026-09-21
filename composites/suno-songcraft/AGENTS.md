# Suno Songcraft skill pack

Maintain two independently installable skills: `suno-songcraft` for Suno production briefs and `genre-lyricist` for lyrics. Keep their entrypoints lean and move detail into the references they explicitly link.

- Preserve user-approved lyrics, hooks, narrative facts, and musical anchors before improving anything else.
- Treat platform facts as dated evidence; treat musical recipes as creative heuristics. Never turn a previous assistant claim into product documentation.
- Use the primary-source records in each skill. Refresh time-sensitive facts when relevant. Do not treat surnames as a documented moderation exception.
- Keep the Carolina example opt-in. Do not impose its region, decade, instruments, voices, tempo, gender configuration, or redemption theme on unrelated songs.
- Keep Style, Lyrics, Exclude, and conversational edit instructions separate. The default Style ceiling of 1,000 characters is this pack's user-requested constraint, not a certified universal Suno UI limit.
- Keep runtime scripts standard-library-only and side-effect-free unless explicitly asked to write, render, or install. Do not add Suno API endpoints, credential handling, browser automation, purchasing, or automatic generation.
- Never claim a track was heard, rendered in Suno, or musically validated from a text-only check.
- Do not copy this file over a user's existing AGENTS.md. Merge project guidance only when explicitly requested.

## Validation

From this bundle root:

```bash
python3 -m unittest discover -s skills/suno-songcraft/scripts -p 'test_*.py' -v
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 skills/suno-songcraft/scripts/songcheck.py check skills/suno-songcraft/assets/carolina-rain.packet.json
```

Treat the JSON acceptance cases as unexecuted behavioral tests until an agent actually runs them. They are not listening results.
