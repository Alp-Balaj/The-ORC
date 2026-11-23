# spaces-corrupt-log

`src/main/spaces.ts` Spaces constructor: the loader's empty `catch {}` now logs with `console.error`
(file path + error) on a read or JSON parse failure. ENOENT (first run) stays silent. A parsed value
that is not an array is also logged with the path. On any failure it falls back to defaults (no
spaces, default settings) and the next `save()` overwrites the corrupt file. Parsing of valid files is unchanged.
