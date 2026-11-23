# question-banner

Terminal strip in `App.tsx` shows a one-line amber banner (`data-testid="question-banner"`, full text in `title`) between `terminal-head` and `TerminalView` when `agent.question` is set. Styled by `.question-banner` in `app.css` using the existing `--color-needs` token. It is a flex-shrink-0 sibling, so TerminalView's container still fills the remaining height and its resize handling refits when the banner appears or disappears.
