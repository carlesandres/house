# Catalog-driven footer option controls

Working plan for declaring footer-visible options in `@house/options` and
rendering them as clickable footer chrome (generalizing today’s wrap `W`
indicator).

**Status:** first slice shipped — `footer` metadata on `@house/options`,
`footerControlsFromSession` in House, wrap migrated. Theme/tone/order footer
opt-in and remaining open decisions below are still open.

## Goal

Let any session-mutable option opt into the footer as a compact, clickable
control — the way wrap’s `W` indicator works today — declared next to the
option in `@house/options` / `houseOptions`, not hand-wired in `Browser.tsx`.

## Current state

- **`@house/options`** (`packages/options`) is framework-free: catalog specs →
  layered resolve → runtime `Session`. Spec fields today: `type`, `default`,
  `persist?`, plus type-specific constraints (`choices`, `min`/`max`,
  `integer`).
- House declares scalars in `apps/house/src/config/options.ts` (`wrap`,
  `width`, `theme`, `tone`, `focus`, `defaultRoot`, `order`).
- Wrap’s footer `W` is **not** a keymap hint. It is a hand-built
  `StatusIndicator` in `Browser.tsx` → `Footer` `indicators`, with
  `onMouseUp: toggleWrap` and `active: wrapEnabled`. The `w` binding has
  **no** `hint`.
- Footer already mixes left-side chrome kinds: discovery warning `!`, custom
  `indicators`, then discovery status text / keymap hints. Notices replace the
  hint row but keep indicators.
- DESIGN.md treats the footer as **essential operational chrome**, not a second
  settings panel. Most actions stay in the command palette.
- Theme/tone already mutate through the same session (`persist: "file"`);
  cycle/toggle push a short footer notice. Order exists in the catalog but is
  not yet a runtime chrome control in the same shape as wrap.

## Terminology (candidate for CONTEXT.md)

| Term | Meaning |
| --- | --- |
| **Option** | Typed catalog entry resolved from CLI/env/file/default and held in a Session |
| **Footer control** | Compact, clickable chrome chip in the footer that reflects and mutates one Option |
| **Footer opt-in** | Catalog declaration that an Option should appear as a Footer control |
| **Activate** | Primary click/interaction on a Footer control (toggle, cycle, or open a change mechanism) |

Keep distinct from: keymap **hints** (`hint` on `KeyBinding`),
**StatusIndicator** (generic icon chip; footer controls may render *as*
these), floating **StatusPopover**.

## Proposal

### Where the opt-in lives

Extend `@house/options` `OptionSpec` with optional, UI-agnostic presentation
metadata:

```ts
footer?: {
	/** Single-cell (or short) glyph shown in chrome. */
	icon: string
	/**
	 * How Activate advances the value when the consumer does not supply
	 * a custom handler. Default derived from type:
	 * boolean → "toggle"; string with choices → "cycle"; else omitted / invalid.
	 */
	activate?: "toggle" | "cycle"
}
```

Why in the package (not only House):

- Catalog support for “this option appears in the footer.”
- The package stays React/TOML-free: this is data, not rendering.
- House (or tests) can derive footer-facing keys from `specs` alone.

Why not a bare `footer: true`:

- Icon is presentation but still declaration-time (wrap → `W`); without it
  every consumer invents a parallel map.
- Activate policy belongs next to type/choices so invalid combos fail in one
  place.

**Open naming tension:** DESIGN.md says the package must not grow
House-specific UI. A literal `footer` field couples the catalog to one chrome
surface. Alternatives under discussion:

1. `footer: { icon, activate? }` — matches day-to-day writing; accepts coupling
2. `chrome: { icon, activate? }` — UI-agnostic name; House maps chrome → footer
3. House-only parallel map — package stays pure
4. Split — package flag only (`exposeInChrome: true`); icons live in House

**Working recommendation:** put opt-in on the spec (option 1 or 2); do not
maintain a parallel House-only registry of which keys appear.

**Guardrails in the package:**

- Reject (or type-exclude) `footer` / `chrome` on options that cannot Activate
  safely without a custom mechanism: numbers without an activate strategy,
  strings without `choices` when `activate: "cycle"`.
- Do **not** put React components, colors, or keymap ids in the package.

### House rendering & wiring

Replace the hard-coded wrap indicator with a small House helper, e.g.
`footerControlsFromSession(houseOptions, session, handlers?)`:

1. Walk `houseOptions.specs` in declaration order; keep keys with footer
   opt-in.
2. For each, build a `StatusIndicator`-compatible descriptor:
   - `id` = option key
   - `icon` = declared icon
   - `active` = type-appropriate (boolean: current value; choice/string: TBD)
   - `onMouseUp` → Activate
3. Pass that list as `Footer` `indicators` (discovery warning still prepended
   by Footer today).

**Default Activate semantics:**

| Spec shape | Activate |
| --- | --- |
| `boolean` + `activate: "toggle"` (default) | `set(key, !get(key))` |
| `string` + `choices` + `activate: "cycle"` (default) | next choice in `choices`, wrap around |
| Anything else with footer opt-in | **must** supply a House `onActivate` override, or declaration is invalid |

House-specific side effects (theme apply, tone apply, order → navigator,
notices) stay in Browser via optional per-key hooks — the catalog does not
know about themes.

```ts
// sketch — final icon glyphs TBD
wrap: {
	type: "boolean",
	default: false,
	persist: "session",
	footer: { icon: "W" },
},
tone: {
	type: "string",
	default: "dark",
	persist: "file",
	choices: ["dark", "light"],
	footer: { icon: "◐" },
},
theme: {
	type: "string",
	default: "opencode",
	persist: "file",
	choices: themeDefinitions.map((t) => t.id),
	footer: { icon: "✦" },
},
order: {
	type: "string",
	default: "recently-modified",
	choices: FILE_NAVIGATOR_ORDERS,
	footer: { icon: "O" },
},
// width, focus, defaultRoot: no footer opt-in
```

### Interaction & density

- **Click** = Activate (same as today’s wrap `onMouseUp`).
- **Keyboard** remains on existing bindings (`w`, `t`, …); footer controls do
  not steal keys. Focusable footer strip is out of scope unless demanded.
- **Overflow**: indicators already budget `length * 3` before hints. Keep
  declaration order as priority; do not auto-grow footer height in this work.
- **Notices**: keep today’s pattern for theme/tone (toast confirms multi-value
  cycles). Booleans can stay silent like wrap.
- **“Mechanism to change”** for non-cycle values (e.g. free-form width):
  defer. First slice only supports toggle/cycle; opening a prompt/palette from
  a footer chip is a follow-up when a real option needs it.

### What stays out of `@house/options`

- Rendering (`StatusIndicator`, mouse handlers as React props)
- Persistence IO (`persistHouseOption`)
- Keymap / command palette ids
- Theme registry side effects

The package may export pure helpers:

- `footerKeys(specs)` / `isFooterOption(spec)` (names follow chosen field)
- `nextCycledValue(spec, current)` / `toggledValue(spec, current)`

## Docs alignment

- Update DESIGN.md §7 (footer = hints **plus** catalog-driven option controls)
  and §9.1 (`@house/options` presentation metadata).
- Preserve “footer is essential chrome” — opt-in is deliberate; not every
  option gets a chip.
- README: user-facing click behavior only, not catalog internals.
- CONTEXT.md: add **Option** / **Footer control** / **Activate** once grilling
  resolves wording.

## Implementation slices (PR-shaped)

1. **`@house/options`**: extend types; validation; pure cycle/toggle helpers;
   tests.
2. **House catalog**: mark wrap (migrate off hard-wire); optionally
   tone/theme/order when Activate hooks are ready.
3. **`footerControlsFromSession` + Browser**: derive indicators; keep per-key
   side-effect hooks; delete hard-coded wrap indicator.
4. **Tests**: package unit tests; footer/browser tests that clicking derived
   controls mutates session (reuse mockMouse patterns from `footer.test.tsx`
   / wrap browser tests).
5. **Docs**: DESIGN + CHANGELOG `[Unreleased]`.

## Non-goals

- Clickable keymap hints (`q quit`, etc.)
- Footer editing of number options / free strings
- Reverse-cycle on right-click or shift-click
- Moving `StatusIndicator` into `@house/ui` (optional later; not required)
- Making the footer keyboard-focusable

## Open decisions

1. Package field name: `footer` vs `chrome` vs House-only map vs split flag.
2. Active-state rule for non-booleans (always lit vs lit when ≠ default vs show
   value glyph).
3. Whether theme belongs in the footer given long `choices` and existing `t` /
   notice UX.
4. Icon / label convention (single Latin letter vs symbolic).
5. Strictness: type-level exclusion of invalid footer+type combos vs runtime
   validate-on-define.
6. Shipping order: wrap-only migration first vs wrap+tone+theme+order together.

## Recommendation summary

Put footer/chrome opt-in metadata on the option spec in `@house/options`,
derive Footer `indicators` from the live Session in House, default Activate to
**toggle / cycle**, keep side effects in Browser hooks, and only opt in options
that are truly essential chrome — starting from wrap and other session-mutable
candidates chosen during design grilling.
