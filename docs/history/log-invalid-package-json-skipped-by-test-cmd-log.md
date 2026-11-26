# log-invalid-package-json-skipped-by / test-cmd-log

`detectTestCommand` (src/main/onboarding.ts) used to return null silently when package.json could not be read or parsed. It now logs `detectTestCommand: skipping <path>: <message>` via `console.error` (same convention as `ownerStatusLine` in claude-launch.ts) and still returns null. A missing file (ENOENT) stays silent.
