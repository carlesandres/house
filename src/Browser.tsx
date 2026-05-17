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
import { filterFiles } from "./discovery/filter.ts"
import { type FileEntry } from "./discovery/walk.ts"
import { Footer, FOOTER_HEIGHT } from "./Footer.tsx"
import { HelpOverlay } from "./HelpOverlay.tsx"
import { readFileText } from "./io/readFile.ts"
import { browserBindings, type BrowserCtx } from "./keymap/browser.ts"
import { dispatch } from "./keymap/keymap.ts"
import { openInBrowser } from "./serve/openBrowser.ts"
import { startServer, type ServerHandle } from "./serve/server.ts"
import { colors, setActiveTheme } from "./theme/colors.ts"
import { themeAtom } from "./theme/atom.ts"
import { themeDefinitions, getThemeDefinition } from "./theme/registry.ts"

export interface BrowserProps {
	readonly files: readonly FileEntry[]
	readonly title?: string
	readonly initialIndex?: number
	/** Cap the rendered markdown's width at N columns. Null = fill the pane. */
	readonly maxWidth?: number | null
	readonly onQuit?: () => void
	/** Test seam: replaces the file reader. */
	readonly readFile?: (path: string) => Promise<string>
}

const defaultReadFile = (path: string): Promise<string> => Effect.runPromise(readFileText(path))

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Bindings the help overlay lets through. Single source of truth for both
 *  the keyboard early-return and the footer hint filter. */
const HELP_ALLOWED_IDS: ReadonlySet<string> = new Set([
	"help.toggle",
	"theme.next",
	"theme.prev",
	"theme.toneToggle",
])

export const Browser = ({
	files,
	title = "house",
	initialIndex = 0,
	maxWidth = null,
	onQuit,
	readFile = defaultReadFile,
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
	const [focus, setFocus] = useState<"sidebar" | "reader">("sidebar")
	const [sidebarVisible, setSidebarVisible] = useState<boolean>(true)
	const [sidebarScroll, setSidebarScroll] = useState<number>(0)
	const [helpVisible, setHelpVisible] = useState<boolean>(false)
	const [filterOpen, setFilterOpen] = useState<boolean>(false)
	const [filterQuery, setFilterQuery] = useState<string>("")
	// Mirror filter state into refs so the keyboard handler sees synchronous
	// updates even when multiple keys arrive in a single React batch (the
	// first key opens the filter; subsequent keys in the same tick would
	// otherwise still observe filterOpen=false through closure).
	const filterOpenRef = useRef(false)
	const filterQueryRef = useRef("")
	// State captured when the filter opens, used to undo the session on Esc
	// (restore prior query) and to restore the prior layout if the user
	// cancelled without typing anything. `userTyped` flips true on the
	// first character or backspace inside the modal; once true, closing
	// the filter leaves the sidebar visible (committing to filter implies
	// wanting to see what you filtered).
	const priorSidebarVisibleRef = useRef(true)
	const priorFilterQueryRef = useRef("")
	const userTypedDuringFilterRef = useRef(false)
	const [footerNotice, setFooterNotice] = useState<string | null>(null)
	const serverRef = useRef<ServerHandle | null>(null)

	// Stop the preview server on unmount so re-mounts (tests) and clean
	// shutdowns don't leak a listening socket.
	useEffect(() => {
		return () => {
			void serverRef.current?.stop()
			serverRef.current = null
		}
	}, [])

	// Single-slot notice with a 2s TTL. A new notice cancels the pending
	// timer so the latest message gets its own full window.
	useEffect(() => {
		if (footerNotice === null) return
		const timer = setTimeout(() => setFooterNotice(null), 2000)
		return () => clearTimeout(timer)
	}, [footerNotice])

	const cycleTheme = (delta: 1 | -1) => {
		const idx = themeDefinitions.findIndex((d) => d.id === theme.id)
		const next = themeDefinitions[(idx + delta + themeDefinitions.length) % themeDefinitions.length]
		if (!next) return
		setActiveTheme(next, theme.tone)
		setTheme({ id: next.id, tone: theme.tone })
		setFooterNotice(`theme: ${next.name}`)
	}

	const toggleTone = () => {
		const nextTone = theme.tone === "dark" ? "light" : "dark"
		const def = getThemeDefinition(theme.id)
		if (def) setActiveTheme(def, nextTone)
		setTheme({ id: theme.id, tone: nextTone })
		setFooterNotice(`tone: ${nextTone}`)
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
		sidebarVisible,
		helpVisible,
		filterOpen,
		setFocus,
		setSelectedIndex,
		setSidebarVisible,
		setHelpVisible,
		openFilter: () => {
			// Auto-open the sidebar and focus it so the filter input has a
			// natural home regardless of where the user pressed `/`. The
			// prior visibility is restored on Esc-with-no-typing; see the
			// closeFilter branch in the keyboard handler.
			// TODO(#22): replace direct setSidebarVisible with a
			// resolveLayout.ensureSidebarVisible() intent once #22 lands.
			priorSidebarVisibleRef.current = sidebarVisible
			priorFilterQueryRef.current = filterQueryRef.current
			userTypedDuringFilterRef.current = false
			if (!sidebarVisible) setSidebarVisible(true)
			if (focus !== "sidebar") setFocus("sidebar")
			filterOpenRef.current = true
			setFilterOpen(true)
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
					setFooterNotice(`serving at ${handle.url}`)
				} catch (err) {
					setFooterNotice(`serve failed: ${String(err)}`)
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
			setFooterNotice(`serving ${file.relativePath} at ${handle.url}`)
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
				const cancelledWithoutTyping = !effectiveCommit && !userTypedDuringFilterRef.current
				filterOpenRef.current = false
				setFilterOpen(false)
				if (effectiveCommit) {
					// Return keeps the query. selectedIndex is already a valid
					// position in the (still-filtered) displayedFiles list, so
					// no translation is needed.
					if (picked) setFocus("reader")
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
				// Esc with no user input restores the prior sidebar visibility —
				// the modal was a no-op, so the layout should be too.
				if (cancelledWithoutTyping && !priorSidebarVisibleRef.current) {
					setSidebarVisible(false)
					setFocus("reader")
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
			if (key.name === "backspace") {
				userTypedDuringFilterRef.current = true
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
				userTypedDuringFilterRef.current = true
				filterQueryRef.current = filterQueryRef.current + char
				setFilterQuery(filterQueryRef.current)
				setSelectedIndex(() => 0)
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

	// Min/max-clamped percentage of viewport: narrow terminals stay readable,
	// wide terminals get more room without wasting space at extremes.
	// User-configurable width is deferred — see DESIGN.md §12.
	const sidebarWidth = Math.max(28, Math.min(60, Math.floor(width * 0.25)))
	const sidebarActive = focus === "sidebar"
	const readerActive = focus === "reader"
	const sidebarTitle = sidebarActive ? " ▸ files " : "   files "
	const readerLabel = selected?.relativePath ?? title
	const readerTitle = readerActive ? ` ▸ ${readerLabel} ` : `   ${readerLabel} `
	const content = loaded?.path === renderedPath ? loaded.content : ""

	// Sidebar virtualization: render only the visible window. Without this,
	// every keystroke re-renders all N file rows even though only the bg of
	// two of them changed (old + new selected). On a 195-file vault that
	// dominates the per-keystroke cost.
	// Sidebar box adds top/bottom borders (2); footer eats FOOTER_HEIGHT;
	// the filter row eats one more cell when files are present.
	const filterRowVisible = files.length > 0
	const sidebarBodyHeight = Math.max(1, height - 2 - FOOTER_HEIGHT - (filterRowVisible ? 1 : 0))
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
	// Available width for sidebar text rows: box width minus 1-cell border on each side.
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

	return (
		<box style={{ width, height, flexDirection: "column", backgroundColor: colors.background }}>
			<box
				style={{
					flexDirection: "row",
					flexGrow: 1,
					flexShrink: 1,
					backgroundColor: colors.background,
				}}
			>
				{sidebarVisible && (
					<box
						title={sidebarTitle}
						titleAlignment="left"
						style={{
							border: true,
							borderColor: sidebarActive ? colors.borderActive : colors.border,
							width: sidebarWidth,
							flexShrink: 0,
							flexDirection: "column",
							backgroundColor: colors.surface,
						}}
					>
						{filterRowVisible && (
							<text content={filterRowContent} wrapMode="none" style={{ fg: filterRowFg }} />
						)}
						{displayedFiles.length === 0 ? (
							<text
								content={files.length === 0 ? "(no markdown files)" : "(no matches)"}
								style={{ fg: colors.textMuted }}
							/>
						) : (
							visibleFiles.map((file, idx) => {
								const realIdx = desiredScroll + idx
								const isSelected = realIdx === selectedIndex
								const display = truncatePath(file.relativePath)
								if (!isSelected) {
									return (
										<text
											key={file.path}
											content={display}
											wrapMode="none"
											style={{ fg: colors.text }}
										/>
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
					</box>
				)}
				<box
					title={readerTitle}
					titleAlignment="left"
					style={{
						border: true,
						borderColor: readerActive ? colors.borderActive : colors.border,
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
							focused={readerActive}
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
			<Footer bindings={footerBindings} ctx={ctx} width={width} notice={footerNotice} />
			{helpVisible && (
				<HelpOverlay bindings={browserBindings} viewportWidth={width} viewportHeight={height} />
			)}
		</box>
	)
}
