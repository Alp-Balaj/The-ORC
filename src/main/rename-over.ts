import { renameSync } from 'node:fs'

/** renameSync over an existing file, retried briefly: on Windows replacing a file that another
 *  process (a reader, the virus scanner) has open fails with EPERM/EBUSY/EACCES for a moment. */
export function renameOver(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      return renameSync(from, to)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (process.platform !== 'win32' || attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
}
