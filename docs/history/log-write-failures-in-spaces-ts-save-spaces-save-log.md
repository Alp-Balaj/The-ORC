# spaces.ts save(): log write failures

`Spaces.save()` in `src/main/spaces.ts` used an empty `catch {}` around the tmp write + `renameOver()`.
It now does `console.error(`spaces: could not save ${this.file}`, err)`, mirroring `AppRunner.persist()`.
Still never throws; write/rename logic and the load-side corrupt-file handling are unchanged.
