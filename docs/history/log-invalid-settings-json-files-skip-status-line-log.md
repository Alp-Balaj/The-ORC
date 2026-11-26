# log-invalid-settings-json-files-skip / status-line-log

`ownerStatusLine` (src/main/claude-launch.ts) reads the user, project and local settings files.
Its catch used to swallow every failure. Now a missing file (`ENOENT`) is still skipped silently;
any other read or JSON parse error is logged with `console.error` (file path plus error message)
and the file is skipped as before.
