# remove-the-orc-tag-on-header: header-orc-symbol

The header's green "ORC" text tag in `App.tsx` is replaced by `<OrcMark className="h-6 w-6 shrink-0 text-primary" />`
(`src/renderer/src/components/OrcMark.tsx`). It is an inline SVG of the glyph paths from `build/icon.svg`
(paths untouched, group transform dropped), viewBox `100 120 800 760`, `fill="currentColor"` so it follows the
accent color, `aria-hidden`. The "The ORC" wordmark text stays.
