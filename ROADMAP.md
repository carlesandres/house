# Roadmap

Planned work for house is tracked in GitHub milestones — see [milestones](https://github.com/carlesandres/house/milestones) for the authoritative list. This file groups items by theme for orientation; the milestone column is the source of truth for *when*.

Architectural rationale, UX rules, and key reservations live in `DESIGN.md`. Glossary terms (e.g. `beta`) live in `CONTEXT.md`.

★ marks a confirmed competitive gap (mdcat / frogmouth / mdr — see issue #16).

Beta shipped with v0.4.0. The remaining work below is split across the `1.0` and `backlog` milestones.

## 1.0 — daily-driver release

An item belongs here if its absence is a visible papercut or a table-stakes capability a daily driver expects. See `CONTEXT.md` §1.0 for the bar.

| Theme | Item | Issue |
|---|---|---|
| Bugs | Pane focus and selected sidebar row are hard to distinguish in many themes | [#71](https://github.com/carlesandres/house/issues/71) |
| Bugs | Relative assets (images, etc.) don't load in browser preview | [#75](https://github.com/carlesandres/house/issues/75) |
| Bugs | Filter chip can crowd out key hints when query is long | [#86](https://github.com/carlesandres/house/issues/86) |
| Bugs | Reader keys act on content occluded by the persistent drawer | [#87](https://github.com/carlesandres/house/issues/87) |
| Architecture | Unify single-file and directory modes (epic) | [#118](https://github.com/carlesandres/house/issues/118) |
| Architecture | `defaultRoot` config + `--root` flag | [#109](https://github.com/carlesandres/house/issues/109) |
| Architecture | Spinner component + indexing-status integration | [#110](https://github.com/carlesandres/house/issues/110) |
| Architecture | Debounced filter (50ms) with flush points | [#111](https://github.com/carlesandres/house/issues/111) |
| Architecture | Sticky first-match auto-select | [#112](https://github.com/carlesandres/house/issues/112) |
| Architecture | Browser accepts `initialQuery` prop | [#113](https://github.com/carlesandres/house/issues/113) |
| Architecture | CLI positional → filter query; delete `App` (breaking) | [#114](https://github.com/carlesandres/house/issues/114) |
| Architecture | Sidebar empty-state copy | [#116](https://github.com/carlesandres/house/issues/116) |
| Architecture | Docs sweep for unified model | [#117](https://github.com/carlesandres/house/issues/117) |
| File-level | Delete current file with confirmation | [#20](https://github.com/carlesandres/house/issues/20) |
| Navigation | Search — filename, full-text, fuzzy | [#25](https://github.com/carlesandres/house/issues/25) |
| Navigation | Navigation history stack (back/forward) ★ | [#29](https://github.com/carlesandres/house/issues/29) |
| Navigation | Heading jump / in-document TOC panel ★ | [#30](https://github.com/carlesandres/house/issues/30) |
| Navigation | Per-file bookmarks ★ (depends on #13) | [#33](https://github.com/carlesandres/house/issues/33) |
| Sidebar | Tree-style sidebar with collapsible folders | [#14](https://github.com/carlesandres/house/issues/14) |
| Config | Hierarchical config file (prereq for several deferred features) | [#13](https://github.com/carlesandres/house/issues/13) |
| Config | Expand file-settable options (`width`, `sort`, `all`, `port`, `sidebarWidth`) | [#63](https://github.com/carlesandres/house/issues/63) |
| Theming | Theming v2 — user stylesheets, named theme sets | [#34](https://github.com/carlesandres/house/issues/34) |
| Theming | Persist active theme to project or global config | [#73](https://github.com/carlesandres/house/issues/73) |
| Distribution | Standalone binary (no Bun-on-PATH) — epic | [#2](https://github.com/carlesandres/house/issues/2) |
| Distribution | Split `src/standalone.ts` entrypoint for fast `--version`/`--help` | [#131](https://github.com/carlesandres/house/issues/131) |
| Distribution | Bundle published source via `dev/build-cli.ts` + `prepack` hook | [#132](https://github.com/carlesandres/house/issues/132) |
| Distribution | `dev/build-standalone.ts` (`bun build --compile --bytecode`, per-platform) | [#133](https://github.com/carlesandres/house/issues/133) |
| Distribution | Per-platform binary npm packages via `dev/build-npm-packages.ts` | [#134](https://github.com/carlesandres/house/issues/134) |
| Distribution | `bin/house.js` Node shim with binary-package resolver + Bun fallback | [#135](https://github.com/carlesandres/house/issues/135) |
| Tooling | One-command release flow (`bun run release`) | [#121](https://github.com/carlesandres/house/issues/121) |

## Backlog

No commitment to ship. Tracked to remember.

### Distribution

| Item | Issue |
|---|---|
| Active auto-update command (depends on #100) | [#12](https://github.com/carlesandres/house/issues/12) |
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
| Runtime toggle + config option for hidden/gitignored files | [#69](https://github.com/carlesandres/house/issues/69) |
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
