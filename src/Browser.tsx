/**
 * Browser — two-pane mode: file sidebar (left) + reader (right).
 *
 * Minimum-viable iteration:
 *  - j/k or arrow keys move selection in the sidebar.
 *  - The reader always shows the currently selected file's contents.
 *  - q / ctrl+c quit.
 *
 * Deferred to next iteration: focus model, reader scrolling via j/k,
 * sidebar collapse with `\`, help overlay.
 */

import { SyntaxStyle } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useAtomValue, useAtomSet } from "@effect/atom-react"
import { Effect } from "effect"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { buildCommands } from "./commands/buildCommands.ts"
import { clampSelectedIndex, filterCommands } from "./commands/score.ts"
import { CommandPalette } from "./CommandPalette.tsx"
import { filterFiles } from "./discovery/filter.ts"
import { type FileEntry } from "./discovery/walk.ts"
import { Footer, FOOTER_HEIGHT } from "./Footer.tsx"
import { Header, HEADER_HEIGHT } from "./Header.tsx"
import { HelpOverlay } from "./HelpOverlay.tsx"
import { readFileText } from "./io/readFile.ts"
import { browserBindings, type BrowserCtx } from "./keymap/browser.ts"
import { dispatch } from "./keymap/keymap.ts"
import {
	canFitInline,
	defaultPreferredWidth,
	initialShownForAuto,
	resolveSidebarWidth,
	shouldShowHeader,
} from "./layout/resolve.ts"
import { openInBrowser } from "./serve/openBrowser.ts"
import { startServer, type ServerHandle } from "./serve/server.ts"
import { colors, setActiveTheme } from "./theme/colors.ts"
import { themeAtom } from "./theme/atom.ts"
import { themeDefinitions, getThemeDefinition } from "./theme/registry.ts"

export type SidebarMode = "auto" | "on" | "off"

export interface BrowserProps {
	readonly files: readonly FileEntry[]
	readonly initialIndex?: number
	/** Cap the rendered markdown's width at N columns. Null = fill the pane. */
	readonly maxWidth?: number | null
	/** Persistent footer indicator (e.g. "indexing… 42"). Pass null/undefined
	 *  when discovery has finished; the indicator clears. */
	readonly discoveryStatus?: string | null
	/** Initial sidebar visibility (`--sidebar` flag). `auto` consults the
	 *  launch viewport bucket once; subsequent visibility goes through `s`. */
	readonly sidebarMode?: SidebarMode
	readonly onQuit?: () => void
	/** Test seam: replaces the file reader. */
	readonly readFile?: (path: string) => Promise<string>
	/** Optional one-shot footer toast surfaced on first appearance (e.g. the
	 *  "update available" nudge). Shown with an extended TTL so the user has
	 *  time to read it; subsequent transient toasts (theme cycle, etc.)
	 *  preempt it via the same single-slot channel. Null disables. */
	readonly updateNotice?: string | null
	/** TTL (ms) for the update-notice toast. Exposed so tests can use a small
	 *  value instead of sleeping for the production 10s window. */
	readonly updateNoticeTtlMs?: number
}

const defaultReadFile = (path: string): Promise<string> => Effect.runPromise(readFileText(path))

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Bindings the help overlay lets through. Single source of truth for both
 *  the keyboard early-return and the footer hint filter. `palette.open`
 *  passes through so users can jump from help into the palette in one
 *  keystroke — `openPalette` closes help on its way in. */
const HELP_ALLOWED_IDS: ReadonlySet<string> = new Set([
	"help.toggle",
	"theme.next",
	"theme.prev",
	"theme.toneToggle",
	"palette.open",
])

export const Browser = ({
	files,
	initialIndex = 0,
	maxWidth = null,
	discoveryStatus = null,
	sidebarMode = "auto",
	onQuit,
	readFile = defaultReadFile,
	updateNotice = null,
	updateNoticeTtlMs = 10000,
}: BrowserProps) => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const theme = useAtomValue(themeAtom)
	const setTheme = useAtomSet(themeAtom)
	const syntaxStyle = useMemo(() => SyntaxStyle.fromStyles(colors.syntax), [theme])

	const [selectedIndex, setSelectedIndex] = useState(() =>
		clamp(initialIndex, 0, Math.max(0, files.length - 1)),
	)
	const [loaded, setLoaded] = useState<{ path: string; content: string } | null>(null)
	const [error, setError] = useState<string | null>(null)
	// `shown` is the user's sticky preference. Visibility is derived:
	// `visible = shown || focus === "sidebar"`. See DESIGN.md §7.1.
	//
	// Launch consults the viewport bucket once for `--sidebar=auto`. The
	// useState initializer pins this to the first render — buckets are
	// launch-only by design, so resize must NOT re-evaluate.
	const [shown, setShown] = useState<boolean>(() => {
		switch (sidebarMode) {
			case "on":
				return true
			case "off":
				return false
			case "auto":
				return initialShownForAuto(width)
		}
	})
	const [focus, setFocus] = useState<"sidebar" | "reader">(() => (shown ? "sidebar" : "reader"))
	const [sidebarScroll, setSidebarScroll] = useState<number>(0)
	const [helpVisible, setHelpVisible] = useState<boolean>(false)
	const [filterOpen, setFilterOpen] = useState<boolean>(false)
	const [filterQuery, setFilterQuery] = useState<string>("")
	const [paletteOpen, setPaletteOpen] = useState<boolean>(false)
	const [paletteQuery, setPaletteQuery] = useState<string>("")
	const [paletteIndex, setPaletteIndex] = useState<number>(0)
	// Synchronous mirrors for the keyboard handler — same reason filterOpenRef
	// exists. Modal input can arrive in one React batch (e.g. ctrl+p, Down,
	// Return), so every palette field read by later keys must update its ref
	// before React state commits.
	const paletteOpenRef = useRef(false)
	const paletteQueryRef = useRef("")
	const paletteIndexRef = useRef(0)
	// Mirror filter state into refs so the keyboard handler sees synchronous
	// updates even when multiple keys arrive in a single React batch (the
	// first key opens the filter; subsequent keys in the same tick would
	// otherwise still observe filterOpen=false through closure).
	const filterOpenRef = useRef(false)
	const filterQueryRef = useRef("")
	// Snapshot the query at filter-open so Esc reverts edits but commit (Return)
	// keeps them. Layout snapshots are no longer needed — focus drives drawer
	// dismissal under the §7.1 visibility rule.
	const priorFilterQueryRef = useRef("")
	const [footerNotice, setFooterNoticeState] = useState<{
		readonly text: string
		readonly ttlMs: number
	} | null>(null)
	const pushFooterNotice = (text: string, ttlMs = 2000): void =>
		setFooterNoticeState({ text, ttlMs })
	const serverRef = useRef<ServerHandle | null>(null)

	// Stop the preview server on unmount so re-mounts (tests) and clean
	// shutdowns don't leak a listening socket.
	useEffect(() => {
		return () => {
			void serverRef.current?.stop()
			serverRef.current = null
		}
	}, [])

	// Single-slot notice with a per-message TTL. A new notice cancels the
	// pending timer so the latest message gets its own full window. The TTL
	// travels with the message so a long-lived nudge (update available) and a
	// transient toast (theme cycle) can share one slot without one stealing
	// the other's display window.
	useEffect(() => {
		if (footerNotice === null) return
		const timer = setTimeout(() => setFooterNoticeState(null), footerNotice.ttlMs)
		return () => clearTimeout(timer)
	}, [footerNotice])

	// Push the update-available nudge once, when it arrives from the parent
	// (the registry probe resolves asynchronously after boot). 10s gives the
	// user time to read it before it auto-clears; the quit-time stderr print
	// is the durable record they can copy from scrollback.
	const updateNoticeSeenRef = useRef<string | null>(null)
	useEffect(() => {
		if (!updateNotice) return
		if (updateNoticeSeenRef.current === updateNotice) return
		updateNoticeSeenRef.current = updateNotice
		pushFooterNotice(updateNotice, updateNoticeTtlMs)
	}, [updateNotice, updateNoticeTtlMs])

	const cycleTheme = (delta: 1 | -1) => {
		const idx = themeDefinitions.findIndex((d) => d.id === theme.id)
		const next = themeDefinitions[(idx + delta + themeDefinitions.length) % themeDefinitions.length]
		if (!next) return
		setActiveTheme(next, theme.tone)
		setTheme({ id: next.id, tone: theme.tone })
		pushFooterNotice(`theme: ${next.name}`)
	}

	const toggleTone = () => {
		const nextTone = theme.tone === "dark" ? "light" : "dark"
		const def = getThemeDefinition(theme.id)
		if (def) setActiveTheme(def, nextTone)
		setTheme({ id: theme.id, tone: nextTone })
		pushFooterNotice(`tone: ${nextTone}`)
	}

	const displayedFiles = useMemo(() => filterFiles(files, filterQuery), [files, filterQuery])
	// When the filtered list shrinks, keep selectedIndex valid. The reset to 0
	// on every query change happens in the keystroke handler, not here, so a
	// no-op rerender doesn't snap the cursor back to the top.
	useEffect(() => {
		if (selectedIndex >= displayedFiles.length) {
			setSelectedIndex(displayedFiles.length === 0 ? 0 : displayedFiles.length - 1)
		}
	}, [displayedFiles.length, selectedIndex])

	const selected = displayedFiles[selectedIndex]

	// Track the path whose content is currently rendered. Updated lazily via
	// a debounce: rapid j/k presses don't trigger a load+<markdown>-reflow
	// per keystroke. The reflow is the synchronous, main-thread-blocking
	// step inside opentui's host commit — useDeferredValue can't yield once
	// the host begins it. A real debounce gates the load itself.
	const [renderedPath, setRenderedPath] = useState<string | null>(selected?.path ?? null)

	useEffect(() => {
		const target = selected?.path ?? null
		if (target === renderedPath) return
		const timer = setTimeout(() => setRenderedPath(target), 80)
		return () => clearTimeout(timer)
	}, [selected?.path, renderedPath])

	useEffect(() => {
		if (!renderedPath) {
			setLoaded(null)
			return
		}
		let cancelled = false
		readFile(renderedPath).then(
			(text) => {
				if (!cancelled) {
					setLoaded({ path: renderedPath, content: text })
					setError(null)
				}
			},
			(err: unknown) => {
				if (!cancelled) {
					setLoaded(null)
					setError(`Cannot read ${renderedPath}: ${String(err)}`)
				}
			},
		)
		return () => {
			cancelled = true
		}
	}, [renderedPath, readFile])

	// One BrowserCtx per render, reused by the keyboard handler and the
	// footer's `when`-evaluation. Keeping a single object eliminates the
	// drift risk between the two consumers as BrowserCtx grows.
	//
	// `files` in ctx refers to the *displayed* list (post-filter) so that
	// keymap when-clauses like `haveFiles` and selection-index actions
	// operate on what the user actually sees.
	const ctx: BrowserCtx = {
		files: displayedFiles,
		focus,
		sidebarShown: shown,
		helpVisible,
		filterOpen,
		paletteOpen,
		setFocus,
		setSelectedIndex,
		toggleShown: () => {
			// Per DESIGN.md §7.1 s-behavior table:
			//   shown=true,  focus=sidebar → shown=false, focus=reader
			//                                (otherwise the drawer would
			//                                 immediately re-appear)
			//   shown=true,  focus=reader  → shown=false, focus=reader
			//   shown=false, focus=reader  → shown=true,  focus=sidebar
			//   shown=false, focus=sidebar → shown=true,  focus=sidebar
			if (shown) {
				setShown(false)
				if (focus === "sidebar") setFocus("reader")
			} else {
				setShown(true)
				if (focus === "reader") setFocus("sidebar")
			}
		},
		setHelpVisible,
		openFilter: () => {
			// Focus the sidebar so the filter input has a home. Under §7.1's
			// `visible = shown || focus==="sidebar"` rule, focus alone makes
			// the sidebar visible (as a drawer when `shown=false`), so we no
			// longer need to mutate `shown` here.
			priorFilterQueryRef.current = filterQueryRef.current
			if (focus !== "sidebar") setFocus("sidebar")
			filterOpenRef.current = true
			setFilterOpen(true)
		},
		openPalette: () => {
			// Close help if it was open — palette is the active modal now.
			// Reset query/index so each open starts fresh (no stale state from
			// the previous session).
			if (helpVisible) setHelpVisible(() => false)
			paletteQueryRef.current = ""
			setPaletteQuery("")
			paletteIndexRef.current = 0
			setPaletteIndex(0)
			paletteOpenRef.current = true
			setPaletteOpen(true)
		},
		cycleTheme,
		toggleTone,
		serveCurrent: () => {
			const file = displayedFiles[selectedIndex]
			if (!file) return
			let handle = serverRef.current
			if (!handle) {
				try {
					handle = startServer({ path: file.path })
					serverRef.current = handle
					openInBrowser(handle.url)
					pushFooterNotice(`serving at ${handle.url}`)
				} catch (err) {
					pushFooterNotice(`serve failed: ${String(err)}`)
				}
				return
			}
			if (handle.currentTarget() !== file.path) {
				handle.setTarget(file.path)
			}
			// Always re-open: if the user closed the tab, retargeting alone
			// would leave them with nothing visible. `open`/`xdg-open` focus
			// an existing tab on the same URL when one is open, so this is
			// idempotent for the common case.
			openInBrowser(handle.url)
			pushFooterNotice(`serving ${file.relativePath} at ${handle.url}`)
		},
		quit: () => {
			if (onQuit) {
				onQuit()
				return
			}
			renderer?.destroy()
			process.exit(0)
		},
	}

	useKeyboard((key) => {
		// Filter modal: capture keystrokes for the input. Esc closes and
		// clears; Return closes, clears, and focuses the reader (open the
		// match); Backspace edits; Up/Down navigate the filtered list;
		// printable characters extend the query and reset selection to 0.
		// Everything else is swallowed so normal bindings (j/k as nav,
		// `s`, `t`, …) don't fire while the user is typing. This sits
		// outside the data-driven keymap for the same reason the help
		// branch does — see DESIGN.md §12.
		if (filterOpenRef.current) {
			// One close path used by both Esc and Return. Closing the filter
			// restores the full list; translating the highlighted match to
			// its index in `files` keeps the cursor on whatever the user was
			// looking at when they hit the key, instead of landing on a
			// random file at the same numeric position in a now-different
			// list. `focusReader=true` is the Return semantic (open the
			// match); false is Esc (cancel, stay in sidebar).
			//
			// Centralized so the dual filterOpenRef / filterOpen invariant
			// only has to be maintained in one place (plus `openFilter`).
			const closeFilter = (commit: boolean) => {
				const picked = displayedFiles[selectedIndex] ?? null
				// Return on a zero-match list has nothing to commit. Treat it
				// as Esc so the user isn't stranded in an "applied filter with
				// no visible files" state they'd have to back out of manually.
				const effectiveCommit = commit && picked !== null
				filterOpenRef.current = false
				setFilterOpen(false)
				if (effectiveCommit) {
					// Return keeps the query. selectedIndex is already a valid
					// position in the (still-filtered) displayedFiles list, so
					// no translation is needed.
				} else {
					// Esc reverts the query to its pre-session value. After the
					// revert, displayedFiles may change shape — translate the
					// cursor by path so it stays on whatever the user was
					// looking at, instead of snapping to a numerically-equivalent
					// row in the restored list.
					const before = priorFilterQueryRef.current
					filterQueryRef.current = before
					setFilterQuery(before)
					if (picked) {
						const restored = before === "" ? files : filterFiles(files, before)
						const idx = restored.findIndex((f) => f.path === picked.path)
						if (idx >= 0) setSelectedIndex(() => idx)
					}
				}
				// Where focus lands depends on layout intent (DESIGN.md §7.1):
				//   commit (Return on a real pick) → reader, always. The user
				//     asked to open the match; show them what they picked.
				//   cancel (Esc, or Return with no pick) → if the sidebar is
				//     inline (shown && fits), keep focus there so j/k keeps
				//     walking the list; if the sidebar was only up as a drawer
				//     (shown=false), dismiss focus to the reader so the drawer
				//     disappears under the §7.1 visibility rule.
				if (effectiveCommit) {
					setFocus("reader")
				} else {
					setFocus(shown && canFitInline(width) ? "sidebar" : "reader")
				}
			}
			if (key.name === "escape") {
				closeFilter(false)
				return
			}
			if (key.name === "return") {
				closeFilter(true)
				return
			}
			if (key.name === "backspace" || key.name === "delete") {
				// Pressing backspace/delete with no query left removes the
				// leading `/` — i.e. closes the modal. Equivalent to Esc:
				// reverts to the pre-session query (so an applied filter
				// survives a "I changed my mind" tap).
				if (filterQueryRef.current.length === 0) {
					closeFilter(false)
					return
				}
				filterQueryRef.current = filterQueryRef.current.slice(0, -1)
				setFilterQuery(filterQueryRef.current)
				setSelectedIndex(() => 0)
				return
			}
			if (key.name === "up") {
				setSelectedIndex((i) => Math.max(0, i - 1))
				return
			}
			if (key.name === "down") {
				setSelectedIndex((i) => Math.min(Math.max(0, displayedFiles.length - 1), i + 1))
				return
			}
			if (key.ctrl || key.meta) return
			let char: string | null = null
			if (key.name === "space") char = " "
			else if (typeof key.name === "string" && key.name.length === 1) {
				char = key.shift ? key.name.toUpperCase() : key.name
			}
			if (char !== null) {
				filterQueryRef.current = filterQueryRef.current + char
				setFilterQuery(filterQueryRef.current)
				setSelectedIndex(() => 0)
			}
			return
		}
		// Command palette modal: capture keystrokes for the query input and
		// list navigation. Esc closes (single press, regardless of query —
		// #70 Q7a). Return runs the selected command. Up/Down navigate.
		// Backspace edits the query and is a no-op on empty (#70 Q7b —
		// intentionally diverges from the filter modal, which closes on
		// empty-backspace, because accidental close feels worse in the
		// palette). Printable characters extend the query and snap selection
		// to 0 (#70 Q7c). Ctrl/Meta-modified keys are swallowed except
		// ctrl+p, which toggles the palette closed (matches help-toggle's
		// re-press-to-close behavior).
		if (paletteOpenRef.current) {
			const closePalette = () => {
				paletteOpenRef.current = false
				paletteQueryRef.current = ""
				paletteIndexRef.current = 0
				setPaletteOpen(false)
				setPaletteQuery("")
				setPaletteIndex(0)
			}
			const setPaletteIndexSync = (next: number) => {
				paletteIndexRef.current = next
				setPaletteIndex(next)
			}
			const allCommands = buildCommands(ctx)
			const filtered = filterCommands(allCommands, paletteQueryRef.current)
			if (key.name === "escape") {
				closePalette()
				return
			}
			if (key.name === "return") {
				const picked = filtered[clampSelectedIndex(paletteIndexRef.current, filtered)]
				closePalette()
				picked?.run()
				return
			}
			if (key.name === "up") {
				setPaletteIndexSync(Math.max(0, paletteIndexRef.current - 1))
				return
			}
			if (key.name === "down") {
				setPaletteIndexSync(Math.min(Math.max(0, filtered.length - 1), paletteIndexRef.current + 1))
				return
			}
			if (key.name === "backspace" || key.name === "delete") {
				if (paletteQueryRef.current.length === 0) return
				paletteQueryRef.current = paletteQueryRef.current.slice(0, -1)
				setPaletteQuery(paletteQueryRef.current)
				setPaletteIndexSync(0)
				return
			}
			// ctrl+p again closes — matches help-toggle behavior.
			if (key.ctrl && !key.meta && key.name === "p") {
				closePalette()
				return
			}
			if (key.ctrl || key.meta) return
			let char: string | null = null
			if (key.name === "space") char = " "
			else if (typeof key.name === "string" && key.name.length === 1) {
				char = key.shift ? key.name.toUpperCase() : key.name
			}
			if (char !== null) {
				paletteQueryRef.current = paletteQueryRef.current + char
				setPaletteQuery(paletteQueryRef.current)
				setPaletteIndexSync(0)
			}
			return
		}
		// While help is open, swallow most keys: only ? (toggle), esc
		// (close), and the theme bindings pass through. Theme keys stay live
		// so users can preview palette changes against the overlay itself —
		// it is the largest theme-painted surface in the app. Everything else
		// is suppressed so the user can read without driving the UI behind.
		// This is the one place we step outside the data-driven keymap; the
		// alternative — adding `when: !c.helpVisible` to every other binding
		// — would clutter the array. See DESIGN.md §12 (keymap composition).
		if (helpVisible) {
			if (key.name === "escape") {
				setHelpVisible(() => false)
				return
			}
			const allowed = browserBindings.filter((b) => HELP_ALLOWED_IDS.has(b.id))
			// Defensive: stub quit even though no allowed binding currently
			// calls it. Keeps the invariant local to this branch instead of
			// relying on a future maintainer remembering not to add quit-ish
			// bindings to HELP_ALLOWED_IDS.
			dispatch(allowed, { ...ctx, quit: () => {} }, key)
			return
		}
		dispatch(browserBindings, ctx, key)
	})

	// Sidebar width is a pure function of viewport (DESIGN.md §7.1). Until
	// persistent config (#13) lands, `preferred` is derived from viewport,
	// matching the pre-#22 inline math.
	const sidebarWidth = resolveSidebarWidth(width, defaultPreferredWidth(width))
	const sidebarActive = focus === "sidebar"
	const readerActive = focus === "reader"
	// Visibility = shown OR sidebar-focused. When visible-because-focused
	// only, render as a drawer (absolute) on top of the reader. We also
	// fall back to drawer rendering when the viewport is too narrow for
	// the inline two-pane layout even with `shown=true` (Q2 in DESIGN.md
	// §7.1) — preserves the user's preference without squeezing the reader
	// below READER_MIN_WIDTH.
	const sidebarVisible = shown || sidebarActive
	const sidebarAsDrawer = sidebarVisible && (!shown || !canFitInline(width))
	const sidebarInline = sidebarVisible && !sidebarAsDrawer
	// Currently-selected file shown in the Header (which replaced the
	// per-pane border title that used to carry this information).
	const currentFile = selected?.relativePath ?? null
	const content = loaded?.path === renderedPath ? loaded.content : ""

	// Sidebar virtualization: render only the visible window. Without this,
	// every keystroke re-renders all N file rows even though only the bg of
	// two of them changed (old + new selected). On a 195-file vault that
	// dominates the per-keystroke cost.
	// Borderless sidebar: header eats HEADER_HEIGHT (when shown), footer
	// eats FOOTER_HEIGHT, the filter row eats one more cell when files
	// are present *or* while discovery is in flight (allocates the row
	// up front so it doesn't pop in when the first file arrives).
	const discoveryActive = discoveryStatus !== null && discoveryStatus.length > 0
	const filterRowVisible = files.length > 0 || discoveryActive
	const headerVisible = shouldShowHeader(height)
	const sidebarBodyHeight = Math.max(
		1,
		height - FOOTER_HEIGHT - (headerVisible ? HEADER_HEIGHT : 0) - (filterRowVisible ? 1 : 0),
	)
	const maxScroll = Math.max(0, displayedFiles.length - sidebarBodyHeight)
	const desiredScroll = (() => {
		let s = sidebarScroll
		if (selectedIndex < s) s = selectedIndex
		else if (selectedIndex >= s + sidebarBodyHeight) s = selectedIndex - sidebarBodyHeight + 1
		return clamp(s, 0, maxScroll)
	})()
	useEffect(() => {
		if (desiredScroll !== sidebarScroll) setSidebarScroll(desiredScroll)
	}, [desiredScroll, sidebarScroll])
	const visibleFiles = displayedFiles.slice(desiredScroll, desiredScroll + sidebarBodyHeight)
	// Available width for sidebar text rows: pane width minus 1-cell left
	// padding and 1-cell right border (the divider rule).
	const sidebarTextWidth = Math.max(4, sidebarWidth - 2)
	// Right-anchored truncation: keep the filename visible, lose the prefix
	// with a leading ellipsis when the path is too long.
	const truncatePath = useCallback(
		(s: string): string =>
			s.length <= sidebarTextWidth ? s : "…" + s.slice(s.length - sidebarTextWidth + 1),
		[sidebarTextWidth],
	)

	// Filter row content + color. Three reachable states:
	//   editing  — filterOpen=true              → /<query>▏  in textStrong
	//   applied  — !filterOpen && query !== ""  → /<query>   in text
	//   idle     — !filterOpen && query === ""  → "/ filter…" in textMuted
	const filterRowFg = filterOpen
		? colors.textStrong
		: filterQuery.length > 0
			? colors.text
			: colors.textMuted
	const filterRowRaw = filterOpen
		? `/${filterQuery}▏`
		: filterQuery.length > 0
			? `/${filterQuery}`
			: "/ filter…"
	// Editing keeps the cursor visible — anchor the right edge with a leading
	// ellipsis when the query overflows. Applied/idle anchor the left edge
	// (lose the tail) so the leading `/` always reads as a filter marker.
	const filterRowContent =
		filterRowRaw.length <= sidebarTextWidth
			? filterRowRaw
			: filterOpen
				? "…" + filterRowRaw.slice(filterRowRaw.length - sidebarTextWidth + 1)
				: filterRowRaw.slice(0, sidebarTextWidth - 1) + "…"

	// While help is open, the `?` key closes the overlay — relabel its hint
	// so the footer accurately describes what pressing the key will do.
	// Memoized: `helpVisible` changes rarely; `browserBindings` and
	// `HELP_ALLOWED_IDS` are module-level constants.
	const footerBindings = useMemo(
		() =>
			helpVisible
				? browserBindings
						.filter((b) => HELP_ALLOWED_IDS.has(b.id))
						.map((b) => (b.id === "help.toggle" ? { ...b, hint: "close" } : b))
				: browserBindings,
		[helpVisible],
	)

	// One sidebar element is reused for inline and drawer rendering; only
	// the wrapper differs (flex sibling vs absolute-positioned). The body is
	// identical so file rows / filter row don't drift between modes.
	const sidebarBody = (
		<>
			{filterRowVisible && (
				<text content={filterRowContent} wrapMode="none" style={{ fg: filterRowFg }} />
			)}
			{displayedFiles.length === 0 ? (
				<text
					content={
						files.length === 0
							? discoveryActive
								? "(scanning…)"
								: "(no markdown files)"
							: "(no matches)"
					}
					style={{ fg: colors.textMuted }}
				/>
			) : (
				visibleFiles.map((file, idx) => {
					const realIdx = desiredScroll + idx
					const isSelected = realIdx === selectedIndex
					const display = truncatePath(file.relativePath)
					if (!isSelected) {
						return (
							<text key={file.path} content={display} wrapMode="none" style={{ fg: colors.text }} />
						)
					}
					const bg = sidebarActive ? colors.selectedBg : colors.selectedBgInactive
					return (
						<text
							key={file.path}
							content={display}
							wrapMode="none"
							style={{ fg: colors.textStrong, bg }}
						/>
					)
				})
			)}
		</>
	)

	return (
		<box style={{ width, height, flexDirection: "column", backgroundColor: colors.background }}>
			{headerVisible && <Header width={width} currentFile={currentFile} />}
			<box
				style={{
					flexDirection: "row",
					flexGrow: 1,
					flexShrink: 1,
					backgroundColor: colors.background,
				}}
			>
				{sidebarInline && (
					<box
						style={{
							// Right edge is the divider rule between sidebar and reader.
							// Drawn in a neutral color regardless of focus — the active
							// pane is signaled by the sidebar's bg tint instead.
							border: ["right"],
							borderColor: colors.border,
							width: sidebarWidth,
							flexShrink: 0,
							flexDirection: "column",
							paddingLeft: 1,
							// Sidebar-only focus tint: surface when active, background
							// when not. Reader stays on background either way so code
							// blocks (which use the surface token) keep their contrast.
							backgroundColor: sidebarActive ? colors.surface : colors.background,
						}}
					>
						{sidebarBody}
					</box>
				)}
				<box
					style={{
						padding: 1,
						flexGrow: 1,
						flexShrink: 1,
						backgroundColor: colors.background,
					}}
				>
					{error ? (
						<text content={error} style={{ fg: colors.error }} />
					) : (
						<scrollbox
							style={{
								scrollY: true,
								scrollX: false,
								flexGrow: 1,
								flexShrink: 1,
								backgroundColor: colors.background,
							}}
							// opentui's scrollbox consumes arrow keys at the focused-element
							// level *before* useKeyboard fires, so a modal that handles
							// arrow keys itself (palette nav, help dismissal) would still
							// see the reader scroll alongside its own action. Unfocus the
							// scrollbox while any blocking modal is up — useKeyboard's
							// modal branches own the keys in that state. Filter is not
							// listed because it force-focuses the sidebar (readerActive
							// is already false).
							focused={readerActive && !paletteOpen && !helpVisible}
						>
							<markdown
								key={renderedPath ?? "empty"}
								content={content}
								syntaxStyle={syntaxStyle}
								fg={colors.text}
								bg={colors.background}
								conceal
								style={{ width: maxWidth ?? "100%" }}
							/>
						</scrollbox>
					)}
				</box>
			</box>
			{sidebarAsDrawer && (
				// Drawer overlays the reader; sits below the Header (which carries
				// the current filename) when the Header is shown. No top border —
				// the Header above and Footer below box it in vertically. Right
				// edge carries the divider rule.
				<box
					position="absolute"
					left={0}
					top={headerVisible ? HEADER_HEIGHT : 0}
					width={sidebarWidth}
					height={Math.max(1, height - FOOTER_HEIGHT - (headerVisible ? HEADER_HEIGHT : 0))}
					zIndex={5}
					style={{
						border: ["right"],
						borderColor: colors.border,
						flexDirection: "column",
						paddingLeft: 1,
						// Drawer is the sidebar; tint it surface so the focused state
						// reads the same as the inline sidebar.
						backgroundColor: sidebarActive ? colors.surface : colors.background,
					}}
				>
					{sidebarBody}
				</box>
			)}
			<Footer
				bindings={footerBindings}
				ctx={ctx}
				width={width}
				notice={footerNotice?.text ?? null}
				discoveryStatus={discoveryStatus}
				filterQuery={!filterOpen && filterQuery.length > 0 ? filterQuery : null}
			/>
			{helpVisible && (
				<HelpOverlay bindings={browserBindings} viewportWidth={width} viewportHeight={height} />
			)}
			{paletteOpen && (
				<CommandPalette
					commands={filterCommands(buildCommands(ctx), paletteQuery)}
					query={paletteQuery}
					selectedIndex={paletteIndex}
					viewportWidth={width}
					viewportHeight={height}
				/>
			)}
		</box>
	)
}
