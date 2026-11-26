# onboarding git() probe logging

`git()` in `src/main/onboarding.ts` used to swallow every error and return null, so `scanRepo`
read a failed git call as "not a repo" / "no default branch". The catch now logs
`onboarding: git <args> failed in <cwd>; treating it as no result:` plus the error (message,
stderr, exit code) via `console.error`, and still returns null, so behavior is unchanged.
A genuine non-repo also logs (exit 128), which is expected: the line names the command and reason.
