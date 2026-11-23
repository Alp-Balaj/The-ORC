# Main sessions start fresh (fresh-main)

Per-repo main (coordinator) sessions no longer resume. Every launch (Start button, and `restore()` at
app launch when `wanted` is saved) gives `MainSession` a new `randomUUID` session id and launches with
`resume: false`. `wanted` is still persisted so a session running at quit comes back, as a new one.
Removed the `launched` flag and the `resumed` field of `MainSessionView`; the old `launched` key in
saved JSON is ignored. UI text: button is always "Start", tooltips no longer promise a kept conversation.
Mission/team-lead resume is untouched.
