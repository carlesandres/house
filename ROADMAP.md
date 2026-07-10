# Roadmap

Planned work for house is tracked in GitHub milestones — see [milestones](https://github.com/carlesandres/house/milestones) for the authoritative list. This file groups items by bucket for orientation; the milestone column is the source of truth for *when*.

Architectural rationale, UX rules, and key reservations live in `DESIGN.md`. Project terminology (such as the meaning of the `beta` release state) is defined where it is introduced.

★ marks a confirmed competitive gap (mdcat / frogmouth / mdr — see issue #16).

Beta shipped with v0.4.0. The unified browser model has landed. The public launch goal is now intentionally narrow: only daily-driver essentials stay in scope. Binary distribution is the current distribution initiative because npm install/runtime friction is now a real user-facing problem, not just a future nice-to-have.

## Current focus — binary distribution

Goal: make `house` installable and runnable without requiring Bun on `PATH`.

Done: the lightweight standalone entrypoint, host standalone build path, npm binary
package prep, main package bin shim, and bundled published source have landed
([#131](https://github.com/carlesandres/house/issues/131), [#132](https://github.com/carlesandres/house/issues/132), [#133](https://github.com/carlesandres/house/issues/133), [#134](https://github.com/carlesandres/house/issues/134), [#135](https://github.com/carlesandres/house/issues/135)).

These are the remaining distribution tasks to work on, in order:

1. Add Homebrew distribution after the binary pipeline is proven ([#51](https://github.com/carlesandres/house/issues/51)).

Tracked by the `binary distribution` milestone and the standalone binary epic ([#2](https://github.com/carlesandres/house/issues/2)). Windows support remains separate and blocked on the Windows support epic ([#129](https://github.com/carlesandres/house/issues/129)).

## Public launch — next daily-driver fixes

Once the binary distribution path is moving, return to the remaining public-launch polish:

1. Preserve alpha colours from bundled themes so muted/border tokens keep their intended contrast ([#189](https://github.com/carlesandres/house/issues/189)).
2. Make footer status-indicator layout display-width aware ([#220](https://github.com/carlesandres/house/issues/220)).

## Public launch — daily-driver essentials

An item belongs here only if its absence is a clear blocker or papercut for regular use.

| Theme | Item | Issue |
|---|---|---|
| Sidebar | Sidebar display-width polish | [#207](https://github.com/carlesandres/house/issues/207) |
| Theming | Theme fidelity fixes | [#189](https://github.com/carlesandres/house/issues/189) |
| Chrome | Footer/status layout polish | [#220](https://github.com/carlesandres/house/issues/220) |
| Browser preview | Relative assets for local README previews | [#75](https://github.com/carlesandres/house/issues/75) |

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
| Opt out of automatic theme persistence | [#206](https://github.com/carlesandres/house/issues/206) |

### Tooling

| Item | Issue |
|---|---|
| One-command release flow (`bun run release`) | [#121](https://github.com/carlesandres/house/issues/121) |

### Distribution

| Item | Issue |
|---|---|
| Active auto-update command (depends on #100) | [#12](https://github.com/carlesandres/house/issues/12) |
| Standalone binary distribution — current initiative | [#2](https://github.com/carlesandres/house/issues/2) |
| Distribute via Homebrew tap after binaries land | [#51](https://github.com/carlesandres/house/issues/51) |
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
| Decide whether `Copy file contents` deserves a direct shortcut | [#216](https://github.com/carlesandres/house/issues/216) |

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
