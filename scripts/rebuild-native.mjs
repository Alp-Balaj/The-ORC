// Rebuilds node-pty against Electron's headers. On Windows, node-pty ships N-API prebuilds
// (prebuilds/win32-*) that Electron loads as-is, and a source build needs Visual Studio plus
// winpty's batch scripts, so it is skipped there.
import { spawnSync } from 'node:child_process'

if (process.platform === 'win32') {
  console.log('rebuild-native: Windows uses node-pty prebuilds, skipping electron-rebuild')
  process.exit(0)
}
const r = spawnSync('electron-rebuild', ['-f', '-w', 'node-pty'], { stdio: 'inherit', shell: true })
process.exit(r.status ?? 1)
