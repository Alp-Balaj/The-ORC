# pastRecords logging (mission log-why-pastrecords-in-records-ts-re)

`pastRecords()` in `src/main/records.ts` still never throws and returns `[]` when `readdirSync` fails,
but now logs one line first: `console.error("records: could not list <dir>; returning no past records:", err)`.
Same style as the other `console.error` calls in `src/main`. Not tested, per the brief.
