# Roadmap

Planned work for house is tracked in GitHub milestones — see [milestones](https://github.com/carlesandres/house/milestones) for the authoritative list. This file groups items by bucket for orientation; the milestone column is the source of truth for *when*.

Architectural rationale, UX rules, and key reservations live in `DESIGN.md`. Project terminology (such as the meaning of the `beta` release state) is defined where it is introduced.

★ marks a confirmed competitive gap (mdcat / frogmouth / mdr — see issue #16).

Beta shipped with v0.4.0. The unified browser model has landed. The public launch goal is now intentionally narrow: only daily-driver essentials stay in scope.

## Next up — current focus

These are the next tasks to work on, in order:

1. Persist the active theme to project or global config.
2. Improve how paths are displayed in the sidebar.
3. Improve theme transformation so bundled themes look right in our UI.
4. Wrap long text lines in the markdown viewer.

## Public launch — daily-driver essentials

An item belongs here only if its absence is a clear blocker or papercut for regular use.

| Theme | Item | Issue |
|---|---|---|
| Sidebar | Sidebar enhancements (usability fixes only) | — |
| Theming | Theming tweaks (fixes only) | — |
| Chrome | UI polish | — |

## Far future — spikes and nice-to-haves

These are intentionally not the next things to work on.

| Theme | Item | Issue |
|---|---|---|
| Navigation | Search follow-up spikes — full-text search ([#202](https://github.com/carlesandres/house/issues/202)) and fuzzy title/content search ([#203](https://github.com/carlesandres/house/issues/203)) | |

## Future ideas

No commitment to ship. Tracked to remember.

### File-level

| Item | Issue |
|---|---|
| Delete current file with confirmation | [#20](https://github.com/carlesandres/house/issues/20) |

### Navigation

| Item | Issue |
|---|---|
| Navigation history stack (back/forward) ★ | [#29](https://github.com/carlesandres/house/issues/29) |
| Heading jump / in-document TOC panel ★ | [#30](https://github.com/carlesandres/house/issues/30) |
| Per-file bookmarks ★ (depends on #13) | [#33](https://github.com/carlesandres/house/issues/33) |

### Sidebar

| Item | Issue |
|---|---|
| Tree-style sidebar with collapsible folders | [#14](https://github.com/carlesandres/house/issues/14) |

### Config

| Item | Issue |
|---|---|
| File-settable options (`width`, `sort`, `show`, `port`, `sidebarWidth`) | [#63](https://github.com/carlesandres/house/issues/63) |
| Hierarchical config file (project-local config, if still needed) | [#13](https://github.com/carlesandres/house/issues/13) |

### Theming

| Item | Issue |
|---|---|
| Theming v2 — user stylesheets, named theme sets | [#34](https://github.com/carlesandres/house/issues/34) |
| Persist active theme to project or global config | [#73](https://github.com/carlesandres/house/issues/73) |

### Tooling

| Item | Issue |
|---|---|
| One-command release flow (`bun run release`) | [#121](https://github.com/carlesandres/house/issues/121) |

### Distribution

| Item | Issue |
|---|---|
| Active auto-update command (depends on #100) | [#12](https://github.com/carlesandres/house/issues/12) |
| Standalone binary (no Bun-on-PATH) — epic | [#2](https://github.com/carlesandres/house/issues/2) |
| Split `src/standalone.ts` entrypoint for fast `--version`/`--help` | [#131](https://github.com/carlesandres/house/issues/131) |
| Bundle published source via `dev/build-cli.ts` + `prepack` hook | [#132](https://github.com/carlesandres/house/issues/132) |
| `dev/build-standalone.ts` (`bun build --compile --bytecode`, per-platform) | [#133](https://github.com/carlesandres/house/issues/133) |
| Per-platform binary npm packages via `dev/build-npm-packages.ts` | [#134](https://github.com/carlesandres/house/issues/134) |
| `bin/house.js` Node shim with binary-package resolver + Bun fallback | [#135](https://github.com/carlesandres/house/issues/135) |
| Distribute via Homebrew tap | [#51](https://github.com/carlesandres/house/issues/51) |
| Windows support (epic; see also #128 PATHEXT) | [#129](https://github.com/carlesandres/house/issues/129) |

### File handling

| Item | Issue |
|---|---|
| Read markdown from stdin (`house -`) | [#23](https://github.com/carlesandres/house/issues/23) |
| Cross-file link following | [#24](https://github.com/carlesandres/house/issues/24) |
| Fetch markdown from URL / `github.com/owner/repo` shorthand ★ | [#26](https://github.com/carlesandres/house/issues/26) |
| Live reload on file change | [#27](https://github.com/carlesandres/house/issues/27) |
| Consider opening files with other extensions | [#48](https://github.com/carlesandres/house/issues/48) |
| PDF preview action for markdown files | [#82](https://github.com/carlesandres/house/issues/82) |

### Rendering

| Item | Issue |
|---|---|
| Markdown → HTML rendering investigation | [#18](https://github.com/carlesandres/house/issues/18) |
| Line numbers toggle | [#28](https://github.com/carlesandres/house/issues/28) |
| Inline images (iTerm2 / Kitty / Sixel) ★ | [#31](https://github.com/carlesandres/house/issues/31) |
| OSC 8 hyperlinks for markdown links ★ | [#32](https://github.com/carlesandres/house/issues/32) |
| Codeblock syntax highlighting (design complete; implementation deferred) | [#72](https://github.com/carlesandres/house/issues/72) |

### Command palette follow-ons

| Item | Issue |
|---|---|
| Drift check between browserBindings ids and palette annotations | [#90](https://github.com/carlesandres/house/issues/90) |
| Category grouping with headers (empty-query orientation) | [#91](https://github.com/carlesandres/house/issues/91) |
| Migrate to atom-driven command registry (ghui-style) | [#92](https://github.com/carlesandres/house/issues/92) |
| Show disabled commands with reasons | [#93](https://github.com/carlesandres/house/issues/93) |
| Reveal file in OS file manager | [#94](https://github.com/carlesandres/house/issues/94) |
| Copy file path to clipboard | [#95](https://github.com/carlesandres/house/issues/95) |
| Recency-first ordering with persisted history | [#96](https://github.com/carlesandres/house/issues/96) |

### Sidebar & layout follow-ons

| Item | Issue |
|---|---|
| Extract `Sidebar.tsx` from `Browser.tsx` | [#66](https://github.com/carlesandres/house/issues/66) |
| Mouse interaction on the sidebar filter row | [#67](https://github.com/carlesandres/house/issues/67) |
| Filter-row behaviour in the tight viewport bucket | [#68](https://github.com/carlesandres/house/issues/68) |
| Enter from reader returns to sidebar (extra key on `reader.back`) | [#78](https://github.com/carlesandres/house/issues/78) |

### Discovery

| Item | Issue |
|---|---|
| Nested `.gitignore` cannot re-include files via negation | [#54](https://github.com/carlesandres/house/issues/54) |
| Discovery traversal cap (`--max-files`, max depth) | [#80](https://github.com/carlesandres/house/issues/80) |
| Investigate third-party walker for discovery | [#81](https://github.com/carlesandres/house/issues/81) |

### Chrome (follow-ons)

| Item | Issue |
|---|---|
| Footer responsive behavior on tight viewports | [#37](https://github.com/carlesandres/house/issues/37) |
| Investigate reusing the spinner for other in-progress states | [#170](https://github.com/carlesandres/house/issues/170) |

### Config

| Item | Issue |
|---|---|
| Address remaining gaps from adversarial review | [#62](https://github.com/carlesandres/house/issues/62) |

### Theming & keymap

| Item | Issue |
|---|---|
| Extract reusable keymap package (`@ghui/keymap` style) | [#35](https://github.com/carlesandres/house/issues/35) |

### Reader internals

| Item | Issue |
|---|---|
| Replace opentui focused scrollbox with imperative scroll control (ghui-style) | [#97](https://github.com/carlesandres/house/issues/97) |

### Search infrastructure

| Item | Issue |
|---|---|
| Evaluate `/` as the full-text search key | [#40](https://github.com/carlesandres/house/issues/40) |

### Test infrastructure

| Item | Issue |
|---|---|
| Add targeted PTY tests using tuistory harness | [#124](https://github.com/carlesandres/house/issues/124) |

## Unscoped — needs design pass before filing

- **Custom per-file actions** — `DESIGN.md §5.3`. Mechanism (config-driven? plugin?) unclear.
- **Mouse polish** — `DESIGN.md §5.3`. Partially concrete: mouse on sidebar filter row tracked in [#67](https://github.com/carlesandres/house/issues/67); revisit broader scope now that layout v2 (#22) has landed.
