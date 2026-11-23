# use-the-local-date-for-mission-note / local-date

`src/main/records.ts`: mission note date is now the local calendar day (YYYY-MM-DD) instead of UTC.
A small `localDate(ms)` helper (getFullYear/getMonth+1/getDate, zero-padded) feeds the note filename
(`recordPath`), the `created:` frontmatter, the AI-generated comment and the `# <date> - Mission` heading.
The shape is unchanged, so the `pastRecords()` filename regex still matches. Section timestamps
(`## heading (YYYY-MM-DD HH:MM)`) were left as UTC.
