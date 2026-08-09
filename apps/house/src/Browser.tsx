/**
 * Browser — two-pane mode: file sidebar (left) + reader (right).
 *
 * Minimum-viable iteration:
 *  - j/k or arrow keys move selection in the sidebar.
 *  - The reader always shows the currently selected file's contents.
 *  - q / ctrl+c quit.
 *
 * Deferred to next iteration: focus model, reader scrolling via j/k,
 * sidebar collapse with `\`.
 */

import { SyntaxStyle } from "@opentui/core"
import type { BorderSides } from "@opentui/core"
import {
	type DiscoveryPolicy,
	type Diagnostic,
	type FileNavigatorHandle,
	type FileNavigatorSnapshot,
} from "@house/ui/file-navigator"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useAtomValue, useAtomSet } from "@effect/atom-react"
import { Effect } from "effect"
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react"
import { buildCommands } from "./commands/buildCommands.ts"
import { clampSelectedIndex, filterCommands } from "./commands/score.ts"
import { CommandPalette, orderCommandsForPalette } from "./CommandPalette.tsx"
import { parseFrontmatter } from "./markdown/frontmatter.ts"
import { BRAND, BRAND_NAME } from "./brand.ts"
import { Footer, type FooterProps } from "./Footer.tsx"
import { Header } from "./Header.tsx"
import { copyTextToClipboard } from "./io/clipboard.ts"
import { openInEditor, resolveEditor } from "./io/editor.ts"
import { readFileText } from "./io/readFile.ts"
import { browserBindings, type BrowserCtx } from "./keymap/browser.ts"
import { dispatch } from "./keymap/keymap.ts"
import { canFitInline, defaultPreferredWidth, resolveSidebarWidth } from "./layout/resolve.ts"
import { Sidebar } from "./Sidebar.tsx"
import { StatusPopoverPanel } from "./StatusPopover.tsx"
import { buildReaderEmptyStateTips, pickTipByRotation } from "./tips.ts"
import { openInBrowser } from "./serve/openBrowser.ts"
import { startServer, type ServerHandle } from "./serve/server.ts"
import { colors, setActiveTheme } from "./theme/colors.ts"
import { themeAtom } from "./theme/atom.ts"
import { themeDefinitions, getThemeDefinition } from "./theme/registry.ts"
import { saveThemePreference } from "./config/save.ts"

export type StartupFocus = "sidebar" | "reader" | "filter"

export interface BrowserProps {
	readonly root: string
	readonly policy?: DiscoveryPolicy
	readonly watch?: boolean
	readonly initialIndex?: number
	/** Initial applied filter query seeded from the CLI positional. */
	readonly initialQuery?: string
	/** Reader wrap width used when wrapping is enabled. */
	readonly wrapWidth?: number
	/** Initial reader wrap mode. Runtime toggles are session-only. */
	readonly initialWrap?: boolean
	/** Canonical discovery root label used anywhere the UI names the scan scope. */
	readonly rootLabel?: string
	/** Persistent footer indicator (e.g. "indexing… 42"). Pass null/undefined
	 *  when discovery has finished; the indicator clears. */
	readonly discoveryStatus?: string | null
	/** Test seam: override the footer discovery spinner speed. */
	readonly discoverySpinnerIntervalMs?: number
	readonly discoverySpinnerInitialFrameIndex?: number
	/** Test seam: deterministic footer spinner driver. */
	readonly discoverySpinnerRegisterTick?: ((tick: () => void) => void) | null
	/** Test seam: override filter debounce timing. */
	readonly filterDebounceMs?: number
	/** Test seam: override rendered-path debounce timing. */
	readonly renderedPathDebounceMs?: number
	/** Test seam: disable reader-empty-state tip rotation effect. */
	readonly disableReaderEmptyStateRotation?: boolean
	readonly onQuit?: () => void
	/** Test seam: replaces the file reader. */
	readonly readFile?: (path: string) => Promise<string>
	/** Test seam: replaces the system clipboard writer. */
	readonly copyToClipboard?: (text: string) => Promise<void>
	/** Optional one-shot footer toast surfaced on first appearance (e.g. the
	 *  "update available" nudge). Shown with an extended TTL so the user has
	 *  time to read it; subsequent transient toasts (theme cycle, etc.)
	 *  preempt it via the same single-slot channel. Null disables. */
	readonly updateNotice?: string | null
	/** TTL (ms) for the update-notice toast. Exposed so tests can use a small
	 *  value instead of sleeping for the production 10s window. */
	readonly updateNoticeTtlMs?: number
	/** Test seam: disable footer-notice auto-clear timers. */
	readonly disableFooterNoticeAutoClear?: boolean
	/** Flip the parent's discovery vocabulary (#145). Browser doesn't need
	 *  to know which categories are currently on — the toggle is opaque
	 *  from this side; we just snapshot the selected path so it can be
	 *  restored across the re-walk the parent triggers. */
	readonly onToggleAll?: () => void
	/** Startup pane/input target. `filter` opens the sidebar filter prompt on
	 *  mount so the user can type immediately. */
	readonly startupFocus?: StartupFocus | null
}

const defaultReadFile = (path: string): Promise<string> => Effect.runPromise(readFileText(path))

const defaultDiscoveryPolicy: DiscoveryPolicy = {
	revision: "house-markdown",
	ignoreFiles: [".gitignore"],
	includeFile: (path) => /\.(md|markdown)$/i.test(path),
}

let nextReaderEmptyStateTipRotation = 0

export const resetReaderEmptyStateTipRotationForTests = () => {
	nextReaderEmptyStateTipRotation = 0
}

export const setReaderEmptyStateTipRotationForTests = (next: number) => {
	nextReaderEmptyStateTipRotation = next
}

const FILTER_DEBOUNCE_MS = 50
const RENDERED_PATH_DEBOUNCE_MS = 80

const isPartialDiscoveryWarning = (status: string | null | undefined): boolean =>
	status?.trimStart().startsWith("scan incomplete:") ?? false

type FloatingOverlay =
	| { readonly kind: "none" }
	| { readonly kind: "command-palette" }
	| { readonly kind: "status-popover"; readonly content: string }

type FloatingOverlayAction =
	| { readonly type: "close" }
	| { readonly type: "open-command-palette" }
	| { readonly type: "toggle-status-popover"; readonly content: string }
	| { readonly type: "update-status-popover"; readonly content: string }

const noFloatingOverlay: FloatingOverlay = { kind: "none" }

const floatingOverlayReducer = (
	state: FloatingOverlay,
	action: FloatingOverlayAction,
): FloatingOverlay => {
	switch (action.type) {
		case "close":
			return noFloatingOverlay
		case "open-command-palette":
			return { kind: "command-palette" }
		case "toggle-status-popover":
			return state.kind === "status-popover"
				? noFloatingOverlay
				: { kind: "status-popover", content: action.content }
		case "update-status-popover":
			return state.kind === "status-popover"
				? { kind: "status-popover", content: action.content }
				: state
	}
}

export const Browser = ({
	root,
	policy = defaultDiscoveryPolicy,
	watch = true,
	initialIndex = 0,
	initialQuery = "",
	wrapWidth = 80,
	initialWrap = false,
	rootLabel = "current root",
	discoveryStatus = null,
	discoverySpinnerIntervalMs,
	discoverySpinnerInitialFrameIndex,
	discoverySpinnerRegisterTick = null,
	filterDebounceMs = FILTER_DEBOUNCE_MS,
	renderedPathDebounceMs = RENDERED_PATH_DEBOUNCE_MS,
	disableReaderEmptyStateRotation = false,
	onQuit,
	readFile = defaultReadFile,
	copyToClipboard = copyTextToClipboard,
	updateNotice = null,
	updateNoticeTtlMs = 10000,
	disableFooterNoticeAutoClear = false,
	onToggleAll,
	startupFocus = null,
}: BrowserProps) => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const theme = useAtomValue(themeAtom)
	const setTheme = useAtomSet(themeAtom)
	const syntaxStyle = useMemo(() => SyntaxStyle.fromStyles(colors.syntax), [theme])

	const [wrapEnabled, setWrapEnabled] = useState(initialWrap)
	const [loaded, setLoaded] = useState<{ path: string; content: string; epoch: number } | null>(
		null,
	)
	const [error, setError] = useState<string | null>(null)
	const readFileRef = useRef(readFile)
	readFileRef.current = readFile
	// `shown` is the user's sticky interactive preference. The sidebar starts
	// visible; after launch, `s`/`tab`/`/` may hide or reveal it. Visibility is
	// derived: `visible = shown || focus === "sidebar"`. See DESIGN.md §7.1.
	const [shown, setShown] = useState<boolean>(true)
	const startInFilter = startupFocus === "filter"
	const initialFocus: "sidebar" | "reader" =
		startupFocus === null
			? shown
				? "sidebar"
				: "reader"
			: startupFocus === "reader"
				? "reader"
				: "sidebar"
	// `filter` mirrors `openFilter`'s focus rule: the filter input lives in
	// the sidebar, so opening it on mount also forces sidebar focus regardless
	// of the current interactive visibility state (§7.1's visibility derivation
	// surfaces the sidebar via focus even when `shown` is false). Plain
	// `sidebar` startup shares the same pane focus without opening the prompt.
	// When omitted, preserve the legacy Browser behavior: initial focus follows
	// visibility.
	const [focus, setFocus] = useState<"sidebar" | "reader">(() => initialFocus)
	const [filterOpen, setFilterOpen] = useState<boolean>(startInFilter)
	const [filterInput, setFilterInput] = useState<string>(initialQuery)
	const navigatorRef = useRef<FileNavigatorHandle | null>(null)
	const [navigatorSnapshot, setNavigatorSnapshot] = useState<FileNavigatorSnapshot>(() => ({
		root,
		files: [],
		filteredFiles: [],
		appliedQuery: initialQuery,
		selectedFile: null,
		selectedIndex: null,
		scanning: true,
		watching: false,
		error: null,
		diagnostics: [],
	}))
	const [discoveryErrorStatus, setDiscoveryErrorStatus] = useState<string | null>(null)
	const liveSnapshot = navigatorRef.current?.getSnapshot() ?? navigatorSnapshot
	const displayedFiles = liveSnapshot.filteredFiles
	const selected = liveSnapshot.selectedFile
	const initialIndexRef = useRef(initialIndex)
	const readerEpochRef = useRef(0)
	const [renderedPath, setRenderedPath] = useState<string | null>(selected?.absolutePath ?? null)
	const activeReaderPathRef = useRef<string | null>(renderedPath)
	const selectedReaderPathRef = useRef<string | null>(selected?.absolutePath ?? null)
	const pendingReaderInvalidationsRef = useRef(new Set<string>())
	const readerRootRef = useRef(root)
	const [readerRequest, setReaderRequest] = useState<{ path: string; epoch: number } | null>(null)
	const advanceReaderEpoch = (): number => {
		readerEpochRef.current += 1
		return readerEpochRef.current
	}
	const requestReaderRead = (path: string, epoch = advanceReaderEpoch()): void => {
		setReaderRequest({ path, epoch })
	}
	const syncSnapshot = (next: FileNavigatorSnapshot): FileNavigatorSnapshot => {
		setNavigatorSnapshot(next)
		return next
	}
	const navigatorAction = <T,>(action: (handle: FileNavigatorHandle) => T): T | null => {
		const handle = navigatorRef.current
		if (!handle) return null
		return action(handle)
	}
	const navigator = {
		getSnapshot: () => navigatorRef.current?.getSnapshot() ?? navigatorSnapshot,
		flushSearch: (query: string) =>
			syncSnapshot(navigatorAction((handle) => handle.flushQuery(query)) ?? navigatorSnapshot),
		selectIndex: (index: number) =>
			syncSnapshot(navigatorAction((handle) => handle.selectIndex(index)) ?? navigatorSnapshot),
		selectFirst: () =>
			syncSnapshot(navigatorAction((handle) => handle.selectFirst()) ?? navigatorSnapshot),
		selectLast: () =>
			syncSnapshot(navigatorAction((handle) => handle.selectLast()) ?? navigatorSnapshot),
		moveBy: (delta: number) =>
			syncSnapshot(navigatorAction((handle) => handle.moveBy(delta)) ?? navigatorSnapshot),
		selectPath: (path: string) =>
			syncSnapshot(navigatorAction((handle) => handle.selectPath(path)) ?? navigatorSnapshot),
	}
	const skippedDiagnostics = liveSnapshot.diagnostics.filter((diagnostic) =>
		diagnostic.error.message.startsWith("skipped directory:"),
	)
	const diagnosticStatus =
		skippedDiagnostics.length > 0
			? `scan incomplete: skipped ${skippedDiagnostics.length} ${
					skippedDiagnostics.length === 1 ? "directory" : "directories"
				}${skippedDiagnostics.length === 1 ? `: ${skippedDiagnostics[0]!.error.message.slice(19)}` : ""}`
			: liveSnapshot.error
				? "scan failed: unable to read discovery root"
				: null
	const handleSelectionChange = (file: FileNavigatorSnapshot["selectedFile"]) => {
		pendingReaderInvalidationsRef.current.clear()
		selectedReaderPathRef.current = file?.absolutePath ?? null
		advanceReaderEpoch()
		const next = navigatorRef.current?.getSnapshot()
		if (next) {
			setNavigatorSnapshot(next)
			return
		}
		setNavigatorSnapshot((current) => ({
			...current,
			selectedFile: file,
			selectedIndex: file === null ? null : current.filteredFiles.indexOf(file),
		}))
	}
	const invalidateSelectedReader = (file: NonNullable<FileNavigatorSnapshot["selectedFile"]>) => {
		const epoch = advanceReaderEpoch()
		if (file.absolutePath === activeReaderPathRef.current) {
			pendingReaderInvalidationsRef.current.delete(file.absolutePath)
			requestReaderRead(file.absolutePath, epoch)
			return
		}
		if (file.absolutePath === selectedReaderPathRef.current) {
			pendingReaderInvalidationsRef.current.add(file.absolutePath)
		}
	}
	const [floatingOverlay, dispatchFloatingOverlayState] = useReducer(
		floatingOverlayReducer,
		noFloatingOverlay,
	)
	const floatingOverlayRef = useRef<FloatingOverlay>(noFloatingOverlay)
	const dispatchFloatingOverlay = (action: FloatingOverlayAction): void => {
		const next = floatingOverlayReducer(floatingOverlayRef.current, action)
		floatingOverlayRef.current = next
		dispatchFloatingOverlayState(action)
	}
	const closeFloatingOverlay = (): void => dispatchFloatingOverlay({ type: "close" })
	const paletteOpen = floatingOverlay.kind === "command-palette"
	const activeStatusPopover = floatingOverlay.kind === "status-popover" ? floatingOverlay : null
	const effectiveDiscoveryStatus = discoveryStatus ?? discoveryErrorStatus ?? diagnosticStatus
	const discoveryWarningStatus = isPartialDiscoveryWarning(effectiveDiscoveryStatus)
		? effectiveDiscoveryStatus
		: null
	const [paletteQuery, setPaletteQuery] = useState<string>("")
	const [paletteIndex, setPaletteIndex] = useState<number>(0)
	// Synchronous mirrors for the keyboard handler — same reason filterOpenRef
	// exists. Modal input can arrive in one React batch (e.g. ctrl+p, Down,
	// Return), so every palette field read by later keys must update its ref
	// before React state commits.
	const paletteQueryRef = useRef("")
	const paletteIndexRef = useRef(0)
	const [readerEmptyStateTipRotation, setReaderEmptyStateTipRotation] = useState(
		() => nextReaderEmptyStateTipRotation,
	)
	const readerEmptyStateVisibleRef = useRef(false)
	// Mirror filter state into refs so the keyboard handler sees synchronous
	// updates even when multiple keys arrive in a single React batch (the
	// first key opens the filter; subsequent keys in the same tick would
	// otherwise still observe filterOpen=false through closure).
	const filterOpenRef = useRef(startInFilter)
	const filterInputRef = useRef(initialQuery)
	const focusRef = useRef<"sidebar" | "reader">(focus)
	const restoreFilterOnSidebarFocusRef = useRef(startInFilter)
	const [footerNotice, setFooterNoticeState] = useState<{
		readonly text: string
		readonly ttlMs: number
	} | null>(null)
	const pushFooterNotice = (text: string, ttlMs = 2000): void =>
		setFooterNoticeState({ text, ttlMs })
	const serverRef = useRef<ServerHandle | null>(null)
	// #145 selection preservation across an `all` re-walk. When the user
	// toggles, we snapshot the currently selected path; once the new file set
	// streams in, we restore selection by path. If the path isn't present in
	// the new set (e.g. it was a hidden file and `all` just went off), the
	// ref stays armed so toggling back later re-selects it. Any user-driven
	// selection move (j/k/g/G/click) clears it — user intent has moved on.
	const pendingSelectionPathRef = useRef<string | null>(null)

	useLayoutEffect(() => {
		if (readerRootRef.current === root) return
		readerRootRef.current = root
		advanceReaderEpoch()
		selectedReaderPathRef.current = null
		activeReaderPathRef.current = null
		pendingReaderInvalidationsRef.current.clear()
		setRenderedPath(null)
		setReaderRequest(null)
		setLoaded(null)
		setError(null)
	}, [root])

	useLayoutEffect(
		() => () => {
			advanceReaderEpoch()
		},
		[],
	)

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
		closeFloatingOverlay()
		if (disableFooterNoticeAutoClear) return
		const timer = setTimeout(() => setFooterNoticeState(null), footerNotice.ttlMs)
		return () => clearTimeout(timer)
	}, [disableFooterNoticeAutoClear, footerNotice])

	useEffect(() => {
		if (discoveryWarningStatus === null) {
			if (floatingOverlay.kind === "status-popover") closeFloatingOverlay()
			return
		}
		if (
			floatingOverlay.kind === "status-popover" &&
			floatingOverlay.content !== discoveryWarningStatus
		) {
			dispatchFloatingOverlay({ type: "update-status-popover", content: discoveryWarningStatus })
		}
	}, [discoveryWarningStatus, floatingOverlay])

	// Push the update-available nudge once, when it arrives from the parent
	// (the registry probe resolves asynchronously after boot). 10s gives the
	// user time to read it before it auto-clears; the quit-time stderr print
	// is the durable record they can copy from scrollback.
	const updateNoticeSeenRef = useRef<string | null>(null)
	useEffect(() => {
		focusRef.current = focus
	}, [focus])

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
		void saveThemePreference({ theme: next.id, tone: theme.tone }).catch((err) => {
			pushFooterNotice("theme not saved")
			process.stderr.write(
				`house: failed to save theme preference: ${err instanceof Error ? err.message : String(err)}\n`,
			)
		})
		pushFooterNotice(`theme: ${next.name}`)
	}

	const toggleTone = () => {
		const nextTone = theme.tone === "dark" ? "light" : "dark"
		const def = getThemeDefinition(theme.id)
		if (def) setActiveTheme(def, nextTone)
		setTheme({ id: theme.id, tone: nextTone })
		void saveThemePreference({ theme: theme.id, tone: nextTone }).catch((err) => {
			pushFooterNotice("theme not saved")
			process.stderr.write(
				`house: failed to save theme preference: ${err instanceof Error ? err.message : String(err)}\n`,
			)
		})
		pushFooterNotice(`tone: ${nextTone}`)
	}

	const filterHasNoMatches = filterInput.length > 0 && displayedFiles.length === 0

	// #145 selection restoration. Runs whenever the displayed file list
	// changes (re-walk batches, filter changes). If the user has a path
	// armed (set by toggleAll) and it now appears in the displayed subset,
	// restore selection to that index and disarm. If the path is not
	// present, keep the ref armed — toggling back later (or future stream
	// batches in the same toggle) will find it.
	useEffect(() => {
		const target = pendingSelectionPathRef.current
		if (target === null) return
		if (displayedFiles.some((file) => file.absolutePath === target)) {
			const snapshot = navigator.selectPath(target)
			if (snapshot.selectedFile?.absolutePath !== target) return
			pendingSelectionPathRef.current = null
		}
	}, [displayedFiles, liveSnapshot.files])

	useEffect(() => {
		if (liveSnapshot.scanning || initialIndexRef.current === 0) return
		navigator.selectIndex(initialIndexRef.current)
		initialIndexRef.current = 0
	}, [liveSnapshot.scanning])

	// Track the path whose content is currently rendered. Updated lazily via
	// a debounce: rapid j/k presses don't trigger a load+<markdown>-reflow
	// per keystroke. The reflow is the synchronous, main-thread-blocking
	// step inside opentui's host commit — useDeferredValue can't yield once
	// the host begins it. A real debounce gates the load itself.
	useEffect(() => {
		const target = selected?.absolutePath ?? null
		if (target === renderedPath) return
		const timer = setTimeout(() => {
			const epoch = advanceReaderEpoch()
			if (target) pendingReaderInvalidationsRef.current.delete(target)
			activeReaderPathRef.current = target
			setRenderedPath(target)
			if (target) requestReaderRead(target, epoch)
			else {
				setReaderRequest(null)
				setLoaded(null)
			}
		}, renderedPathDebounceMs)
		return () => clearTimeout(timer)
	}, [selected?.absolutePath, renderedPath, renderedPathDebounceMs])

	useEffect(() => {
		if (!readerRequest) return
		let cancelled = false
		const { path, epoch } = readerRequest
		readFileRef.current(path).then(
			(text) => {
				if (
					!cancelled &&
					epoch === readerEpochRef.current &&
					path === activeReaderPathRef.current
				) {
					setLoaded({ path, content: text, epoch })
					setError(null)
				}
			},
			(err: unknown) => {
				if (
					!cancelled &&
					epoch === readerEpochRef.current &&
					path === activeReaderPathRef.current
				) {
					setLoaded(null)
					setError(`Cannot read ${path}: ${String(err)}`)
				}
			},
		)
		return () => {
			cancelled = true
		}
	}, [readerRequest])

	// One BrowserCtx per render, reused by the keyboard handler and the
	// footer's `when`-evaluation. Keeping a single object eliminates the
	// drift risk between the two consumers as BrowserCtx grows.
	//
	// `files` in ctx refers to the *displayed* list (post-filter) so that
	// keymap when-clauses like `haveFiles` and selection-index actions
	// operate on what the user actually sees.
	const ctx: BrowserCtx = {
		files: displayedFiles,
		hasSelected: selected != null,
		focus,
		sidebarShown: shown,
		filterOpen,
		restoreFilterOnSidebarFocus: restoreFilterOnSidebarFocusRef.current,
		filterQuery: filterInput,
		paletteOpen,
		wrapEnabled,
		setFocus,
		// Wrapped so any keymap-driven selection move (j/k/g/G/[/], reader
		// prev/next) clears the pending-restore ref from #145. Internal
		// callers that should NOT clear pending (filter-modal movement and
		// restoration) deliberately call the controller directly.
		moveSelectionBy: (delta) => {
			pendingSelectionPathRef.current = null
			navigator.moveBy(delta)
		},
		selectFirst: () => {
			pendingSelectionPathRef.current = null
			navigator.selectFirst()
		},
		selectLast: () => {
			pendingSelectionPathRef.current = null
			navigator.selectLast()
		},
		toggleShown: () => {
			// Two layout shapes, two behaviors:
			//   wide  → flip the sticky `shown` preference. Per DESIGN.md §7.1
			//           s-behavior table: also nudge focus so the visibility
			//           rule (`visible = shown || focus==="sidebar"`) reflects
			//           the user's intent instead of forcing the sidebar back
			//           on via focus.
			//   narrow → swap which screen is up (focus is the source of truth
			//           for render). Sync `shown` to the new screen so a later
			//           resize to wide opens with the right pane visible.
			if (!canFitInline(width)) {
				const next = focus === "sidebar" ? "reader" : "sidebar"
				setFocus(next)
				setShown(next === "sidebar")
				return
			}
			if (shown) {
				setShown(false)
				if (focus === "sidebar") setFocus("reader")
			} else {
				setShown(true)
				if (focus === "reader") setFocus("sidebar")
			}
		},
		openFilter: () => {
			closeFloatingOverlay()
			// Focus the sidebar so the filter input has a home. In wide,
			// §7.1's visibility rule (`shown || focus === "sidebar"`) brings
			// the inline sidebar back on screen if it was hidden. In narrow,
			// focusing the sidebar swaps to the sidebar screen. Either way
			// no need to mutate `shown`.
			focusRef.current = "sidebar"
			if (focus !== "sidebar") setFocus("sidebar")
			restoreFilterOnSidebarFocusRef.current = true
			filterOpenRef.current = true
			setFilterOpen(true)
		},
		clearAndOpenFilter: () => {
			closeFloatingOverlay()
			// Reset both the ref and the state so the freshly-opened modal
			// shows an empty input and selection lands on the first file in
			// the (now unfiltered) list.
			filterInputRef.current = ""
			setFilterInput("")
			navigator.flushSearch("")
			navigator.selectFirst()
			focusRef.current = "sidebar"
			if (focus !== "sidebar") setFocus("sidebar")
			restoreFilterOnSidebarFocusRef.current = true
			filterOpenRef.current = true
			setFilterOpen(true)
		},
		openPalette: () => {
			// Reset query/index so each open starts fresh (no stale state from
			// the previous session).
			paletteQueryRef.current = ""
			setPaletteQuery("")
			paletteIndexRef.current = 0
			setPaletteIndex(0)
			dispatchFloatingOverlay({ type: "open-command-palette" })
		},
		toggleWrap: () => setWrapEnabled((prev) => !prev),
		cycleTheme,
		toggleTone,
		toggleAll: () => {
			// Snapshot the currently displayed selection unless a snapshot is
			// already armed (a prior toggle's selection survived the re-walk
			// and is still waiting to come back). The armed path is the one
			// the user originally chose; preserving it across a toggle-off /
			// toggle-on round-trip is the headline ergonomic of #145.
			// User-driven nav (j/k/g/G via the wrapped actions above)
			// clears pending, so a follow-up toggle starts a fresh snapshot.
			const current = navigator.getSnapshot().selectedFile
			if (pendingSelectionPathRef.current === null && current) {
				pendingSelectionPathRef.current = current.absolutePath
			}
			onToggleAll?.()
		},
		serveCurrent: () => {
			const file = navigator.getSnapshot().selectedFile
			if (!file) return
			let handle = serverRef.current
			if (!handle) {
				try {
					handle = startServer({ path: file.absolutePath })
					serverRef.current = handle
					openInBrowser(handle.url)
					pushFooterNotice(`serving at ${handle.url}`)
				} catch (err) {
					pushFooterNotice(`serve failed: ${String(err)}`)
				}
				return
			}
			if (handle.currentTarget() !== file.absolutePath) {
				handle.setTarget(file.absolutePath)
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
		editCurrent: () => {
			const file = navigator.getSnapshot().selectedFile
			if (!file) return
			const editor = resolveEditor(process.env)
			if (!editor) {
				pushFooterNotice("set $EDITOR or $VISUAL to use E")
				return
			}
			if (!renderer) {
				// Test environments without a real renderer (e.g. testRender's
				// host) don't expose suspend/resume. Nothing safe to do here.
				pushFooterNotice("editor unavailable in this environment")
				return
			}
			// Fire-and-forget: useKeyboard's run() is synchronous, but the
			// editor session is naturally async. We always re-enter the
			// renderer in the finally block so a thrown error never leaves
			// the user staring at a dead terminal.
			void (async () => {
				renderer.suspend()
				renderer.currentRenderBuffer.clear()
				let result
				try {
					result = await openInEditor({ editor, filePath: file.absolutePath })
				} finally {
					renderer.currentRenderBuffer.clear()
					renderer.resume()
					renderer.requestRender()
				}
				// Only reload the in-memory cache when the edited file is the
				// one currently displayed. Editing a sidebar-selected file that
				// the reader hasn't caught up to (debounce in flight) is fine —
				// the regular load path picks up the new mtime when renderedPath
				// advances.
				if (file.absolutePath === activeReaderPathRef.current) {
					const epoch = advanceReaderEpoch()
					try {
						const text = await readFileRef.current(file.absolutePath)
						if (
							epoch !== readerEpochRef.current ||
							file.absolutePath !== activeReaderPathRef.current
						)
							return
						setLoaded({ path: file.absolutePath, content: text, epoch })
						setError(null)
					} catch (err) {
						if (
							epoch !== readerEpochRef.current ||
							file.absolutePath !== activeReaderPathRef.current
						)
							return
						const message = String(err)
						const enoent =
							(err as { code?: string } | null)?.code === "ENOENT" || message.includes("ENOENT")
						if (enoent) {
							pushFooterNotice(`${file.relativePath} no longer exists`)
							setError(`Cannot read ${file.absolutePath}: ${message}`)
							setLoaded(null)
						} else {
							pushFooterNotice(`reload failed: ${message}`)
						}
					}
				}
				if (!result.ok) {
					if (result.reason === "spawn-failed") {
						pushFooterNotice(`editor not found: ${editor.cmd}`)
					} else if (result.reason === "non-zero") {
						pushFooterNotice(`editor exited ${result.detail}`)
					}
				}
			})()
		},
		copyCurrentContents: () => {
			const file = navigator.getSnapshot().selectedFile
			if (!file) return
			void (async () => {
				let text: string
				try {
					text = await readFile(file.absolutePath)
				} catch {
					pushFooterNotice(`copy failed: cannot read ${file.relativePath}`)
					return
				}
				try {
					await copyToClipboard(text)
					pushFooterNotice(`copied ${file.relativePath}`)
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err)
					pushFooterNotice(`copy failed: ${message}`)
				}
			})()
		},
	}

	useKeyboard((key) => {
		// Command palette modal: capture keystrokes for the query input and
		// list navigation. This branch intentionally runs before the filter
		// branch so ctrl+p can open the palette from filter mode while the
		// palette still owns Esc/arrows/Return until it closes.
		if (floatingOverlayRef.current.kind === "command-palette") {
			const closePalette = () => {
				paletteQueryRef.current = ""
				paletteIndexRef.current = 0
				closeFloatingOverlay()
				setPaletteQuery("")
				setPaletteIndex(0)
			}
			const setPaletteIndexSync = (next: number) => {
				paletteIndexRef.current = next
				setPaletteIndex(next)
			}
			const allCommands = buildCommands(ctx)
			const filtered = orderCommandsForPalette(filterCommands(allCommands, paletteQueryRef.current))
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
			// ctrl+p again closes.
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

		// Filter modal: capture keystrokes for the input. Esc closes,
		// leaving the typed query applied as the active filter; Return
		// closes and focuses the reader (open the match); Ctrl+\ clears
		// the input but stays in filter mode (same binding used from
		// outside the modal — single chord, single mental model. Ctrl+U
		// is deliberately not overloaded here; it stays reserved for its
		// sidebar/reader half-page-up role); Backspace edits; Up/Down
		// navigate the filtered list; printable characters extend the
		// query and reset selection to 0. Everything else is swallowed
		// so normal bindings (j/k as nav, `s`, `t`, …) don't fire while
		// the user is typing. This sits outside the data-driven keymap
		// for the same reason the help branch does — see DESIGN.md §12.
		if (filterOpenRef.current && focusRef.current === "sidebar") {
			// One close path used by both Esc and Return. `commit=true` is
			// the Return semantic (open the match in the reader); false is
			// Esc (stop typing, keep the applied filter, stay in sidebar).
			const closeFilter = (commit: boolean) => {
				const snapshot = navigator.flushSearch(filterInputRef.current)
				const picked = snapshot.selectedFile
				const effectiveCommit = commit && picked !== null
				restoreFilterOnSidebarFocusRef.current = false
				filterOpenRef.current = false
				setFilterOpen(false)
				// Where focus lands after the filter closes:
				//   commit (Return on a real pick) → reader. The user asked
				//     to open the match; show them what they picked.
				//   otherwise → sidebar if it's up so j/k keeps walking the
				//     filtered list; reader if the sidebar was hidden.
				if (effectiveCommit) {
					focusRef.current = "reader"
					setFocus("reader")
				} else {
					const nextFocus = shown ? "sidebar" : "reader"
					focusRef.current = nextFocus
					setFocus(nextFocus)
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
			if (key.name === "tab" || (key.ctrl && key.name === "i" && !key.shift && !key.meta)) {
				focusRef.current = "reader"
				restoreFilterOnSidebarFocusRef.current = true
				filterOpenRef.current = false
				setFilterOpen(false)
				setFocus("reader")
				return
			}
			if (key.ctrl && !key.meta && key.name === "p") {
				ctx.openPalette()
				return
			}
			if (key.ctrl && key.name === "\\") {
				// Same action as the `filter.clearOrOpen` binding fires from
				// outside the modal: clear the query, reset selection. The
				// keymap doesn't see keys in filter mode, so this branch is
				// the in-modal half of that single chord.
				filterInputRef.current = ""
				setFilterInput("")
				navigator.flushSearch("")
				navigator.selectFirst()
				return
			}
			if (key.name === "backspace" || key.name === "delete") {
				// Backspace on empty input closes the modal — the leading `/`
				// chevron is the last thing left to "delete."
				if (filterInputRef.current.length === 0) {
					closeFilter(false)
					return
				}
				filterInputRef.current = filterInputRef.current.slice(0, -1)
				setFilterInput(filterInputRef.current)
				navigator.selectIndex(0)
				return
			}
			if (key.name === "up") {
				navigator.moveBy(-1)
				return
			}
			if (key.name === "down") {
				navigator.moveBy(1)
				return
			}
			if (key.ctrl || key.meta) return
			let char: string | null = null
			if (key.name === "space") char = " "
			else if (typeof key.name === "string" && key.name.length === 1) {
				char = key.shift ? key.name.toUpperCase() : key.name
			}
			if (char !== null) {
				filterInputRef.current = filterInputRef.current + char
				setFilterInput(filterInputRef.current)
				navigator.selectIndex(0)
			}
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
	// Wide vs narrow drives the entire layout shape.
	//   wide   → inline two-pane (today). visible = shown || focus==="sidebar".
	//   narrow → single-pane stack: whichever pane has focus fills the area.
	//            `shown` is silently ignored for render in narrow; `focus`
	//            is the single source of truth.
	// See DESIGN.md §7.1.
	const isNarrow = !canFitInline(width)
	const sidebarInline = isNarrow ? sidebarActive : shown || sidebarActive
	const readerVisible = isNarrow ? readerActive : true
	// When fixed-width wrapping is enabled, never size markdown wider than the
	// visible reader body. The scrollbox deliberately disables horizontal
	// scrolling, so an over-wide markdown node clips instead of wrapping.
	const readerPaneWidth = isNarrow || !sidebarInline ? width : Math.max(1, width - sidebarWidth)
	const readerBodyWidth = Math.max(1, readerPaneWidth - 2) // reader padding: 1 left + 1 right
	const markdownWidth = wrapEnabled ? Math.min(wrapWidth, readerBodyWidth) : "100%"
	// Currently-selected file shown in the Header (which replaced the
	// per-pane border title that used to carry this information).
	const currentFile = selected?.relativePath ?? null
	const content = loaded?.path === renderedPath ? loaded.content : ""
	const parsedContent = useMemo(() => parseFrontmatter(content), [content])
	const readerEmptyStateTitle = filterHasNoMatches
		? `No files match: ${filterInput}`
		: `${BRAND} ${BRAND_NAME}`
	const readerEmptyStateVisible =
		error == null &&
		renderedPath == null &&
		!liveSnapshot.scanning &&
		(selected === null || liveSnapshot.files.length === 0)

	useEffect(() => {
		if (disableReaderEmptyStateRotation) return
		if (readerEmptyStateVisible) {
			if (!readerEmptyStateVisibleRef.current) {
				readerEmptyStateVisibleRef.current = true
				setReaderEmptyStateTipRotation(nextReaderEmptyStateTipRotation++)
			}
			return
		}
		readerEmptyStateVisibleRef.current = false
	}, [disableReaderEmptyStateRotation, readerEmptyStateVisible])

	const discoveryActive =
		(liveSnapshot.scanning && effectiveDiscoveryStatus === null) ||
		(effectiveDiscoveryStatus !== null && effectiveDiscoveryStatus.length > 0)

	const footerProps = {
		bindings: browserBindings,
		ctx,
		width,
		notice: footerNotice?.text ?? null,
		discoveryStatus: effectiveDiscoveryStatus,
		indicators: [
			{
				id: "wrap",
				icon: "W",
				variant: "info",
				active: wrapEnabled,
				onMouseUp: () => setWrapEnabled((prev) => !prev),
			},
		],
		...(discoverySpinnerIntervalMs === undefined ? {} : { discoverySpinnerIntervalMs }),
		...(discoverySpinnerInitialFrameIndex === undefined
			? {}
			: { discoverySpinnerInitialFrameIndex }),
		...(discoverySpinnerRegisterTick === undefined ? {} : { discoverySpinnerRegisterTick }),
		...(discoveryWarningStatus === null
			? {}
			: {
					onDiscoveryWarningToggle: () =>
						dispatchFloatingOverlay({
							type: "toggle-status-popover",
							content: discoveryWarningStatus,
						}),
				}),
	} satisfies FooterProps<BrowserCtx>
	const readerEmptyStateTips = useMemo(() => buildReaderEmptyStateTips(browserBindings, ctx), [ctx])
	const readerEmptyStateTip = useMemo(
		() => pickTipByRotation(readerEmptyStateTips, readerEmptyStateTipRotation),
		[readerEmptyStateTipRotation, readerEmptyStateTips],
	)

	// Pane borders draw a connected frame: each pane's top/bottom edges
	// and the sidebar's right edge are rendered by opentui in one pass.
	const readerBorderSides: BorderSides[] = ["top", "bottom"]
	const INACTIVE_PANE_OPACITY = 0.62

	return (
		<box
			style={{ width, height, flexDirection: "column", backgroundColor: colors.backgroundPanel }}
		>
			<Header width={width} currentFile={currentFile} rootLabel={rootLabel} />
			<box
				style={{
					flexDirection: "row",
					flexGrow: 1,
					flexShrink: 1,
					backgroundColor: colors.backgroundPanel,
				}}
			>
				<Sidebar
					root={root}
					policy={policy}
					watch={watch}
					debounceMs={filterDebounceMs}
					navigatorRef={navigatorRef}
					snapshot={liveSnapshot}
					filterInput={filterInput}
					filterOpen={filterOpen}
					discoveryActive={discoveryActive}
					rootLabel={rootLabel}
					viewportHeight={height}
					paneWidth={isNarrow ? width : sidebarWidth}
					narrow={isNarrow}
					active={sidebarActive}
					visible={sidebarInline}
					onSelectionChange={handleSelectionChange}
					onSnapshot={(files) => {
						setNavigatorSnapshot((current) => ({ ...current, files, scanning: true }))
						setTimeout(() => {
							const handle = navigatorRef.current
							if (!handle) return
							const next = handle.getSnapshot()
							const target = pendingSelectionPathRef.current
							if (target && next.filteredFiles.some((file) => file.absolutePath === target)) {
								pendingSelectionPathRef.current = null
								setNavigatorSnapshot(handle.selectPath(target))
								return
							}
							setNavigatorSnapshot(next.error ? { ...next, scanning: false } : next)
						}, 0)
					}}
					onSelectedFileInvalidated={(file) => invalidateSelectedReader(file)}
					onDiagnostic={(diagnostic: Diagnostic) => {
						if (!diagnostic.error.message.startsWith("skipped directory:"))
							setDiscoveryErrorStatus("scan failed: unable to read discovery root")
						setNavigatorSnapshot((current) => ({
							...current,
							scanning: false,
							diagnostics: [...current.diagnostics, diagnostic],
							error: diagnostic.error.message.startsWith("skipped directory:")
								? null
								: diagnostic.error,
						}))
						setTimeout(() => {
							const next = navigatorRef.current?.getSnapshot()
							if (next) setNavigatorSnapshot(next)
						}, 0)
					}}
				/>
				{readerVisible && (
					<box
						style={{
							border: readerBorderSides,
							borderColor: colors.border,
							flexGrow: 1,
							flexShrink: 1,
							flexDirection: "column",
							// Dim by default (see sidebar note); inner body overrides when active.
							backgroundColor: colors.backgroundPanel,
						}}
					>
						<box
							style={{
								flexGrow: 1,
								flexShrink: 1,
								flexDirection: "column",
								padding: 1,
								backgroundColor: readerActive ? colors.background : colors.backgroundPanel,
								opacity: readerActive ? 1 : INACTIVE_PANE_OPACITY,
							}}
						>
							{error ? (
								<text content={error} style={{ fg: colors.error }} />
							) : !renderedPath ? (
								// Reader empty state — no file selected. Brand mark centered as a
								// welcome anchor; reusable tips live here too.
								<box
									style={{
										flexGrow: 1,
										flexShrink: 1,
										alignItems: "center",
										justifyContent: "center",
										backgroundColor: readerActive ? colors.background : colors.backgroundPanel,
									}}
								>
									<box style={{ flexDirection: "column", gap: 1, alignItems: "center" }}>
										<text
											content={readerEmptyStateTitle}
											wrapMode="none"
											style={{ fg: colors.textMuted }}
										/>
										{readerEmptyStateTip && (
											<text
												key={readerEmptyStateTip.id}
												content={readerEmptyStateTip.text}
												wrapMode="none"
												style={{ fg: colors.textMuted }}
											/>
										)}
									</box>
								</box>
							) : (
								<scrollbox
									style={{
										scrollY: true,
										scrollX: false,
										flexGrow: 1,
										flexShrink: 1,
										backgroundColor: readerActive ? colors.background : colors.backgroundPanel,
									}}
									// opentui's scrollbox consumes arrow keys at the focused-element
									// level *before* useKeyboard fires, so a modal that handles
									// arrow keys itself (palette nav) would still
									// see the reader scroll alongside its own action. Unfocus the
									// scrollbox while any blocking modal is up — useKeyboard's
									// modal branches own the keys in that state. Filter is not
									// listed because it force-focuses the sidebar (readerActive
									// is already false).
									focused={readerActive && !paletteOpen}
								>
									{parsedContent.fields.length > 0 && (
										<box style={{ flexDirection: "column", marginBottom: 1 }}>
											{parsedContent.fields.map((field) => (
												<box
													key={field.key}
													style={{ flexDirection: "row", gap: 1, flexWrap: "wrap" }}
												>
													<text
														content={`${field.key}:`}
														wrapMode="word"
														style={{ fg: colors.secondary }}
													/>
													<text
														content={field.value}
														wrapMode="word"
														style={{ fg: colors.textMuted }}
													/>
												</box>
											))}
										</box>
									)}
									<markdown
										key={renderedPath ?? "empty"}
										content={parsedContent.body}
										syntaxStyle={syntaxStyle}
										fg={colors.text}
										bg={readerActive ? colors.background : colors.backgroundPanel}
										conceal
										style={{ width: markdownWidth }}
									/>
								</scrollbox>
							)}
						</box>
					</box>
				)}
			</box>
			<Footer {...footerProps} />
			{paletteOpen && (
				<CommandPalette
					commands={orderCommandsForPalette(filterCommands(buildCommands(ctx), paletteQuery))}
					query={paletteQuery}
					selectedIndex={paletteIndex}
					viewportWidth={width}
					viewportHeight={height}
				/>
			)}
			{activeStatusPopover && (
				<StatusPopoverPanel content={activeStatusPopover.content} variant="warning" />
			)}
		</box>
	)
}
