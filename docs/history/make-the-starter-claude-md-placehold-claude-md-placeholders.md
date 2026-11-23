# Starter CLAUDE.md placeholders

`createStarterClaudeMd` (src/main/onboarding.ts) now uses one marker style, `[fill in: <what>, e.g. <example>]`,
for every placeholder (install command, test command, conventions). Raw `TODO:` text is gone. Detected values
(npm/pnpm/yarn/cargo/go) are unchanged; placeholders appear only when no package manager is detected.
Verified by running the generator on an empty temp dir; `pnpm typecheck` passes.
