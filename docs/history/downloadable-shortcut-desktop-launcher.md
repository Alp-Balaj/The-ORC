# Desktop shortcut (downloadable-shortcut / desktop-launcher)

Launch The ORC from an icon instead of a terminal. Both shortcuts run `scripts/orc-app.sh` (the
stable copy of main, see `scripts/orc-app.sh`), so they start, and first-time build, the owner's daily app.

## Desktop shortcut

- **Linux:** `scripts/install-shortcut.sh` writes `~/.local/share/applications/the-orc.desktop`
  (and `~/Desktop/the-orc.desktop` if the folder exists, marked executable and `gio` trusted).
  `Exec` is `scripts/orc-launch.sh`, `Terminal=false`, `Icon` is `build/icon.png`. Paths are
  resolved from the script's location, so re-run it if the checkout moves.
- **Windows:** `powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1` creates
  `The ORC.lnk` on the Desktop and in the Start menu (icon `build/icon.ico`). The shortcut runs
  `wscript.exe scripts\orc-launch.vbs`, which finds Git Bash (`ORC_GIT_BASH`, then
  `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%LocalAppData%\Programs`) and runs
  `bash -lc ./scripts/orc-launch.sh` with a hidden window (`CHERE_INVOKING=1` keeps cwd in the repo).
- **Logs:** `orc-launch.sh` appends everything (build output included; electron's own output is
  discarded by orc-app.sh) to `~/.local/state/the-orc/launch.log`, truncated past 1 MB. `ORC_LAUNCH_LOG` overrides.
- Only one ORC can run on the app data, so a second launch while it runs exits at once.

## Icon

`build/icon.svg` is the source (dark rounded square, amber open ring, centre dot).
`node build/make-icons.mjs` regenerates `icon.png` (512px) and `icon.ico` (16-256px) with no
dependencies. `src/main/index.ts` sets the `BrowserWindow` icon (`.ico` on Windows, `.png` elsewhere)
from `../../build/` relative to `out/main`, so the taskbar shows it in dev and in the stable copy.

Verified by syntax check only (`bash -n`, PowerShell parser); no shortcuts were created.
