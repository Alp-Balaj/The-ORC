# orc-icon-swap

Replaced the placeholder ring icon with the owner's orc SVG. `build/icon.svg` = original glyph paths
(untouched) in `<g id="orc-icon" transform="translate(6 9) scale(0.5)" fill="#6fae3a">` on a `#16181d` rounded square.
`build/make-icons.mjs` now parses icon.svg itself (rect colour/radius, group transform/fill, M/L/Z polygon
paths, even-odd for the skull) instead of hard-coded ring geometry, so editing the SVG and rerunning
`node build/make-icons.mjs` is enough. Only M/L/Z paths are supported.
Author/license are unknown (no metadata in the file): see the TODO in `build/ICON-CREDITS.md`.
