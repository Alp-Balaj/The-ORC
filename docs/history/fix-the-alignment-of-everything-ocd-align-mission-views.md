# Alignment pass: mission views

Small, pixel-level fixes (no restyle):
- tree-layout.ts: `rowW` 120 -> 114 so stacked rows' right edge matches their lead card (was 6px overhang).
- MissionTree: card status/token line indented `pl-3.5` to sit under the name; "+N done" chip uses the row's `pl-2.5 pr-2` so its dot lines up with row dots.
- AgentCard: stop/dismiss icons both `size-3.5`; merged/conflict lines `mt-1.5` like the other blocks; merge icon shrink-0; done-summary icon offset `mt-px`.
- DiffView: hunk/note rows no extra vertical padding (rows stay on the 1.5 line grid); file label chip `leading-4`.
Feed and MissionScreens audited: offsets already on scale (`ml-5` = icon 14 + gap 6). Not checked in the hidden replay.
