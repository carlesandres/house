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

import { join } from "node:path"
import { SyntaxStyle } from "@opentui/core"
import type { BorderSides } from "@opentui/core"
import { nextFooterValue } from "@house/options"
import {
	type BrowseOrder,
	type DiscoveryPolicy,
	type Diagnostic,
	type FileNavigatorHandle,
	type FileNavigatorSnapshot,
} from "@house/ui/file-navigator"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useAtomValue, useAtomSet } from "@effect/atom-react"
import { Effect } from "effect"
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"
import { buildCommands } from "./commands/buildCommands.ts"
import { clampSelectedIndex, filterCommands } from "./commands/score.ts"
import { CommandPalette, orderCommandsForPalette } from "./CommandPalette.tsx"
import { PromptModal, type PromptStatus } from "./PromptModal.tsx"
import { parseFrontmatter } from "./markdown/frontmatter.ts"
import { BRAND, BRAND_NAME } from "./brand.ts"
import { Footer, type FooterProps } from "./Footer.tsx"
import { Header } from "./Header.tsx"
import { copyTextToClipboard } from "./io/clipboard.ts"
import { createEmptyFileExclusive, type CreateEmptyFileResult } from "./io/createFile.ts"
import {
	openInEditor,
	resolveEditor,
	type EditorRunResult,
	type OpenInEditorOptions,
} from "./io/editor.ts"
import { readFileText } from "./io/readFile.ts"
import {
	renameMarkdownFile,
	type RenameFileRequest,
	type RenameFileResult,
} from "./io/renameFile.ts"
import { queryWouldShowRelativePath } from "./new-file/queryWouldShow.ts"
import { resolveMarkdownBasename, type ResolveNameMode } from "./new-file/resolveName.ts"
import {
	type ActionTarget,
	type PromptPurpose,
	captureActionTarget,
	destinationRelativePath,
	promptLiveStatus,
	retargetPreviewIfNeeded,
	siblingExistsExact,
} from "./prompts/helpers.ts"
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
import { footerControlsFromSession } from "./config/footerControls.ts"
import { FILE_NAVIGATOR_ORDERS, houseOptions, type FileNavigatorOrder } from "./config/options.ts"
import { persistHouseOption } from "./config/persist.ts"

const asFileNavigatorOrder = (value: BrowseOrder | string): FileNavigatorOrder =>
	typeof value === "string" && (FILE_NAVIGATOR_ORDERS as readonly string[]).includes(value)
		? (value as FileNavigatorOrder)
		: "recently-modified"

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
	/** File Navigator browse order when the filter is empty. */
	readonly order?: BrowseOrder
	/** Test seam: replaces the `$EDITOR` spawn. */
	readonly launchEditor?: (options: OpenInEditorOptions) => Promise<EditorRunResult>
	/** Test seam: replaces exclusive empty-file create. */
	readonly createEmptyFile?: (path: string) => Promise<CreateEmptyFileResult>
	/** Test seam: replaces basename rename. */
	readonly renameFile?: (request: RenameFileRequest) => Promise<RenameFileResult>
	/** Test seam: override the post-create/rename File Navigator membership wait. */
	readonly newFileMembershipTimeoutMs?: number
	/** Test seam: seed the HTML preview server handle (skips startServer / `O`). */
	readonly initialPreviewServer?: ServerHandle | null
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
const NEW_FILE_MEMBERSHIP_TIMEOUT_MS = 2000
const NEW_FILE_MEMBERSHIP_POLL_MS = 32

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const isSingleCodePoint = (value: string): boolean => Array.from(value).length === 1
const dropLastCodePoint = (value: string): string => Array.from(value).slice(0, -1).join("")

const printableFromKey = (key: {
	readonly name: string
	readonly shift?: boolean
}): string | null => {
	if (key.name === "space") return " "
	if (typeof key.name === "string" && isSingleCodePoint(key.name)) {
		return key.shift ? key.name.toUpperCase() : key.name
	}
	return null
}

const isPartialDiscoveryWarning = (status: string | null | undefined): boolean =>
	status?.trimStart().startsWith("scan incomplete:") ?? false

type FloatingOverlay =
	| { readonly kind: "none" }
	| { readonly kind: "command-palette" }
	| { readonly kind: "prompt" }
	| { readonly kind: "status-popover"; readonly content: string }

type FloatingOverlayAction =
	| { readonly type: "close" }
	| { readonly type: "open-command-palette" }
	| { readonly type: "open-prompt" }
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
		case "open-prompt":
			return { kind: "prompt" }
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
	order = "recently-modified",
	launchEditor = openInEditor,
	createEmptyFile = createEmptyFileExclusive,
	renameFile = renameMarkdownFile,
	newFileMembershipTimeoutMs = NEW_FILE_MEMBERSHIP_TIMEOUT_MS,
	initialPreviewServer = null,
}: BrowserProps) => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const theme = useAtomValue(themeAtom)
	const setTheme = useAtomSet(themeAtom)
	const syntaxStyle = useMemo(() => SyntaxStyle.fromStyles(colors.syntax), [theme])

	const optionsSession = useRef<ReturnType<typeof houseOptions.createSession> | null>(null)
	if (optionsSession.current === null) {
		optionsSession.current = houseOptions.createSession(
			{
				...houseOptions.defaults,
				wrap: initialWrap,
				width: wrapWidth,
				theme: theme.id,
				tone: theme.tone,
				order: asFileNavigatorOrder(order),
			},
			{ persist: persistHouseOption },
		)
	}
	const wrapEnabled = useSyncExternalStore(optionsSession.current.subscribe, () =>
		optionsSession.current!.get("wrap"),
	)
	const browseOrder = useSyncExternalStore(optionsSession.current.subscribe, () =>
		asFileNavigatorOrder(optionsSession.current!.get("order")),
	)
	const toggleWrap = () => {
		const session = optionsSession.current
		if (session === null) return
		void session.set("wrap", nextFooterValue(houseOptions.specs.wrap, session.get("wrap")))
	}
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
		refresh: () => navigatorRef.current?.refresh() ?? Promise.resolve(),
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
	// Armed after New file creates a path; cleared by user nav so a late
	// membership wait cannot steal selection and launch `$EDITOR`.
	const newFileEditPathRef = useRef<string | null>(null)
	const handleSelectionChange = (file: FileNavigatorSnapshot["selectedFile"]) => {
		if (newFileEditPathRef.current !== null && file?.absolutePath !== newFileEditPathRef.current) {
			newFileEditPathRef.current = null
		}
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
	const promptOpen = floatingOverlay.kind === "prompt"
	const floatingModalOpen = paletteOpen || promptOpen
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
	const [promptInput, setPromptInput] = useState("")
	const [promptStatus, setPromptStatus] = useState<PromptStatus | null>(null)
	const [promptPurpose, setPromptPurpose] = useState<PromptPurpose>("new-file")
	const [promptContext, setPromptContext] = useState<string | undefined>(undefined)
	const promptInputRef = useRef("")
	const promptPurposeRef = useRef<PromptPurpose>("new-file")
	const promptFocusBeforeRef = useRef<"sidebar" | "reader">("sidebar")
	const promptSubmittingRef = useRef(false)
	const [promptSubmitting, setPromptSubmitting] = useState(false)
	const actionTargetRef = useRef<ActionTarget | null>(null)
	const promptTaskGenRef = useRef(0)
	const mountedRef = useRef(true)
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
	const filterInputReadyRef = useRef(false)
	const paletteInputReadyRef = useRef(false)
	const promptInputReadyRef = useRef(false)
	const focusRef = useRef<"sidebar" | "reader">(focus)
	const restoreFilterOnSidebarFocusRef = useRef(startInFilter)
	const [footerNotice, setFooterNoticeState] = useState<{
		readonly text: string
		readonly ttlMs: number
	} | null>(null)
	const pushFooterNotice = (text: string, ttlMs = 2000): void =>
		setFooterNoticeState({ text, ttlMs })
	const serverRef = useRef<ServerHandle | null>(initialPreviewServer)
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
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			promptTaskGenRef.current += 1
			newFileEditPathRef.current = null
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

	const rememberAppearance = (op: Promise<void>) => {
		void op.catch((err) => {
			pushFooterNotice("theme not saved")
			process.stderr.write(
				`house: failed to save theme preference: ${err instanceof Error ? err.message : String(err)}\n`,
			)
		})
	}

	const cycleTheme = (delta: 1 | -1) => {
		const session = optionsSession.current
		if (session === null) return
		const currentId = session.get("theme")
		const idx = themeDefinitions.findIndex((d) => d.id === currentId)
		const next = themeDefinitions[(idx + delta + themeDefinitions.length) % themeDefinitions.length]
		if (!next) return
		const tone = session.get("tone")
		if (tone !== "dark" && tone !== "light") return
		setActiveTheme(next, tone)
		setTheme({ id: next.id, tone })
		rememberAppearance(session.set("theme", next.id))
		pushFooterNotice(`theme: ${next.name}`)
	}

	const cycleOrder = () => {
		const session = optionsSession.current
		if (session === null) return
		const next = nextFooterValue(houseOptions.specs.order, session.get("order"))
		void session.set("order", next)
		pushFooterNotice(`order: ${next}`)
	}

	const toggleTone = () => {
		const session = optionsSession.current
		if (session === null) return
		const nextTone = session.get("tone") === "dark" ? "light" : "dark"
		const def = getThemeDefinition(session.get("theme"))
		if (def) setActiveTheme(def, nextTone)
		setTheme({ id: session.get("theme"), tone: nextTone })
		rememberAppearance(session.set("tone", nextTone))
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

	const applyPromptInput = (next: string): void => {
		promptInputRef.current = next
		setPromptInput(next)
		const mode: ResolveNameMode = promptPurposeRef.current
		const resolved = resolveMarkdownBasename(next, mode)
		const target = actionTargetRef.current
		let destExists = false
		let matchRelative = resolved.ok ? resolved.basename : ""
		if (resolved.ok && mode === "new-file") {
			destExists = siblingExistsExact(root, resolved.basename)
		} else if (resolved.ok && mode === "rename" && target !== null) {
			matchRelative = destinationRelativePath(target.parentRelative, resolved.basename)
			destExists = siblingExistsExact(target.parentDir, resolved.basename, target.basename)
		}
		setPromptStatus(promptLiveStatus(next, mode, filterInputRef.current, matchRelative, destExists))
	}

	const closePrompt = (restoreFocus: boolean): void => {
		promptSubmittingRef.current = false
		setPromptSubmitting(false)
		promptInputRef.current = ""
		setPromptInput("")
		setPromptStatus(null)
		setPromptContext(undefined)
		actionTargetRef.current = null
		promptPurposeRef.current = "new-file"
		setPromptPurpose("new-file")
		closeFloatingOverlay()
		if (restoreFocus) {
			promptTaskGenRef.current += 1
			const prev = promptFocusBeforeRef.current
			focusRef.current = prev
			setFocus(prev)
		}
	}

	const editCurrent = (): void => {
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
			if (!mountedRef.current) return
			renderer.suspend()
			renderer.currentRenderBuffer.clear()
			let result
			try {
				result = await launchEditor({ editor, filePath: file.absolutePath })
			} finally {
				if (mountedRef.current) {
					renderer.currentRenderBuffer.clear()
					renderer.resume()
					renderer.requestRender()
				}
			}
			// Only reload the in-memory cache when the edited file is the
			// one currently displayed. Editing a sidebar-selected file that
			// the reader hasn't caught up to (debounce in flight) is fine —
			// the regular load path picks up the new mtime when renderedPath
			// advances.
			if (!mountedRef.current) return
			if (file.absolutePath === activeReaderPathRef.current) {
				const epoch = advanceReaderEpoch()
				try {
					const text = await readFileRef.current(file.absolutePath)
					if (epoch !== readerEpochRef.current || file.absolutePath !== activeReaderPathRef.current)
						return
					setLoaded({ path: file.absolutePath, content: text, epoch })
					setError(null)
				} catch (err) {
					if (epoch !== readerEpochRef.current || file.absolutePath !== activeReaderPathRef.current)
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
	}

	const beginPrompt = (
		purpose: PromptPurpose,
		initialValue: string,
		context: string | undefined,
	): void => {
		promptTaskGenRef.current += 1
		promptSubmittingRef.current = false
		setPromptSubmitting(false)
		promptPurposeRef.current = purpose
		setPromptPurpose(purpose)
		setPromptContext(context)
		promptInputRef.current = initialValue
		setPromptInput(initialValue)
		promptFocusBeforeRef.current = focusRef.current
		if (filterOpenRef.current) {
			filterOpenRef.current = false
			setFilterOpen(false)
		}
		dispatchFloatingOverlay({ type: "open-prompt" })
		applyPromptInput(initialValue)
	}

	const openNewFilePrompt = (): void => {
		const editor = resolveEditor(process.env)
		if (!editor) {
			pushFooterNotice("set $EDITOR or $VISUAL to use N")
			return
		}
		if (!renderer) {
			pushFooterNotice("editor unavailable in this environment")
			return
		}
		actionTargetRef.current = null
		beginPrompt("new-file", "", undefined)
	}

	const openRenamePrompt = (): void => {
		const file = navigator.getSnapshot().selectedFile
		if (!file) return
		actionTargetRef.current = captureActionTarget(file)
		beginPrompt("rename", file.basename, file.relativePath)
	}

	const waitForMembership = async (opts: {
		readonly dest: string
		readonly task: number
		readonly isArmed: () => boolean
		readonly disarm: () => void
		readonly onReady: (() => void) | null
		readonly timeoutNotice: string
	}): Promise<void> => {
		const stillWaiting = (): boolean =>
			opts.task === promptTaskGenRef.current && mountedRef.current && opts.isArmed()
		await navigator.refresh()
		const deadline = Date.now() + newFileMembershipTimeoutMs
		while (Date.now() < deadline) {
			if (!stillWaiting()) return
			const snap = navigator.getSnapshot()
			if (snap.files.some((file) => file.absolutePath === opts.dest)) {
				const selectedSnapshot = navigator.selectPath(opts.dest)
				if (!stillWaiting()) return
				if (selectedSnapshot.selectedFile?.absolutePath === opts.dest) {
					pendingSelectionPathRef.current = null
					opts.disarm()
					opts.onReady?.()
					return
				}
			}
			await sleep(NEW_FILE_MEMBERSHIP_POLL_MS)
		}
		if (!stillWaiting()) return
		pendingSelectionPathRef.current = null
		opts.disarm()
		pushFooterNotice(opts.timeoutNotice)
	}

	const submitNewFile = (): void => {
		if (promptSubmittingRef.current) return
		const raw = promptInputRef.current
		const resolved = resolveMarkdownBasename(raw, "new-file")
		if (!resolved.ok) {
			setPromptStatus({ kind: "error", lines: [resolved.error] })
			return
		}
		promptSubmittingRef.current = true
		setPromptSubmitting(true)
		const dest = join(root, resolved.basename)
		const task = promptTaskGenRef.current
		void (async () => {
			const created = await createEmptyFile(dest)
			if (!mountedRef.current) return
			if (task !== promptTaskGenRef.current) {
				if (created.ok) pushFooterNotice(`created ${resolved.basename}`)
				return
			}
			if (!created.ok) {
				promptSubmittingRef.current = false
				setPromptSubmitting(false)
				setPromptStatus({
					kind: "error",
					lines: [
						created.reason === "already-exists"
							? "already exists"
							: `create failed: ${created.message}`,
					],
				})
				return
			}
			closePrompt(false)
			const query = filterInputRef.current
			if (query.length > 0 && !queryWouldShowRelativePath(query, resolved.basename)) {
				filterInputRef.current = resolved.basename
				setFilterInput(resolved.basename)
				navigator.flushSearch(resolved.basename)
			}
			pendingSelectionPathRef.current = dest
			newFileEditPathRef.current = dest
			await waitForMembership({
				dest,
				task,
				isArmed: () => newFileEditPathRef.current === dest,
				disarm: () => {
					if (newFileEditPathRef.current === dest) newFileEditPathRef.current = null
				},
				onReady: () => editCurrent(),
				timeoutNotice: `created ${resolved.basename}, but it isn't in the file list`,
			})
		})()
	}

	const submitRename = (): void => {
		if (promptSubmittingRef.current) return
		const target = actionTargetRef.current
		if (!target) return
		const raw = promptInputRef.current
		const resolved = resolveMarkdownBasename(raw, "rename")
		if (!resolved.ok) {
			setPromptStatus({ kind: "error", lines: [resolved.error] })
			return
		}
		if (resolved.basename === target.basename) {
			closePrompt(true)
			return
		}
		promptSubmittingRef.current = true
		setPromptSubmitting(true)
		const dest = join(target.parentDir, resolved.basename)
		const destRelative = destinationRelativePath(target.parentRelative, resolved.basename)
		const task = promptTaskGenRef.current
		const sourcePath = target.absolutePath
		void (async () => {
			const renamed = await renameFile({
				discoveryRoot: root,
				sourcePath,
				parentDir: target.parentDir,
				newBasename: resolved.basename,
			})
			if (!mountedRef.current) return
			if (task !== promptTaskGenRef.current) {
				if (renamed.ok && !renamed.noop) {
					pushFooterNotice(`renamed to ${resolved.basename}`)
				}
				return
			}
			if (!renamed.ok) {
				promptSubmittingRef.current = false
				setPromptSubmitting(false)
				setPromptStatus({
					kind: "error",
					lines: [renamed.reason === "already-exists" ? "already exists" : renamed.message],
				})
				return
			}
			closePrompt(false)
			const query = filterInputRef.current
			if (query.length > 0 && !queryWouldShowRelativePath(query, destRelative)) {
				filterInputRef.current = resolved.basename
				setFilterInput(resolved.basename)
				navigator.flushSearch(resolved.basename)
			}
			retargetPreviewIfNeeded(serverRef.current, sourcePath, dest)
			pendingSelectionPathRef.current = dest
			await waitForMembership({
				dest,
				task,
				isArmed: () => pendingSelectionPathRef.current === dest,
				disarm: () => {
					if (pendingSelectionPathRef.current === dest) pendingSelectionPathRef.current = null
				},
				onReady: null,
				timeoutNotice: `renamed to ${resolved.basename}, but it isn't in the file list`,
			})
		})()
	}

	const submitPrompt = (): void => {
		if (promptPurposeRef.current === "rename") submitRename()
		else submitNewFile()
	}

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
			newFileEditPathRef.current = null
			navigator.moveBy(delta)
		},
		selectFirst: () => {
			pendingSelectionPathRef.current = null
			newFileEditPathRef.current = null
			navigator.selectFirst()
		},
		selectLast: () => {
			pendingSelectionPathRef.current = null
			newFileEditPathRef.current = null
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
		toggleWrap,
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
		editCurrent,
		openNewFilePrompt,
		openRenamePrompt,
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
				key.preventDefault()
				closePalette()
				return
			}
			if (key.name === "return") {
				key.preventDefault()
				const picked = filtered[clampSelectedIndex(paletteIndexRef.current, filtered)]
				closePalette()
				picked?.run()
				return
			}
			if (key.name === "up") {
				key.preventDefault()
				setPaletteIndexSync(Math.max(0, paletteIndexRef.current - 1))
				return
			}
			if (key.name === "down") {
				key.preventDefault()
				setPaletteIndexSync(Math.min(Math.max(0, filtered.length - 1), paletteIndexRef.current + 1))
				return
			}
			// ctrl+p again closes.
			if (key.ctrl && !key.meta && key.name === "p") {
				key.preventDefault()
				closePalette()
				return
			}
			if (!paletteInputReadyRef.current) {
				if (key.name === "backspace" || key.name === "delete") {
					if (paletteQueryRef.current.length === 0) return
					paletteQueryRef.current = paletteQueryRef.current.slice(0, -1)
					setPaletteQuery(paletteQueryRef.current)
					setPaletteIndexSync(0)
					return
				}
				if (key.ctrl || key.meta) return
				const char = printableFromKey(key)
				if (char !== null) {
					paletteQueryRef.current = paletteQueryRef.current + char
					setPaletteQuery(paletteQueryRef.current)
					setPaletteIndexSync(0)
				}
			}
			return
		}

		// Prompt modal (New file / Rename — dual purpose on one overlay kind;
		// purpose lives in promptPurposeRef; pure helpers in prompts/helpers.ts.
		// See ADR 0003). Typing and caret motion live on the focused <input>;
		// this branch keeps overlay chords (and swallows sidebar motion).
		if (floatingOverlayRef.current.kind === "prompt") {
			if (key.name === "escape") {
				key.preventDefault()
				closePrompt(true)
				return
			}
			if (promptSubmittingRef.current) {
				key.preventDefault()
				return
			}
			if (key.name === "return") {
				key.preventDefault()
				submitPrompt()
				return
			}
			if (key.name === "up" || key.name === "down") {
				key.preventDefault()
				return
			}
			if (key.ctrl && !key.meta && key.name === "p") {
				key.preventDefault()
				return
			}
			if (!promptInputReadyRef.current) {
				if (key.name === "backspace" || key.name === "delete") {
					if (promptInputRef.current.length === 0) return
					applyPromptInput(dropLastCodePoint(promptInputRef.current))
					return
				}
				if (key.ctrl || key.meta) return
				const char = printableFromKey(key)
				if (char !== null) applyPromptInput(promptInputRef.current + char)
			}
			return
		}

		// Filter modal: overlay chords stay here (Esc / Return / Tab / ctrl+p /
		// ctrl+\ / empty-backspace / Up/Down). Typing and caret motion go to
		// the focused OpenTUI <input> in PromptRow. Ctrl+U/D are still not
		// overloaded (reserved for sidebar/reader page). This sits outside
		// the data-driven keymap — see DESIGN.md §12.
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
				key.preventDefault()
				closeFilter(false)
				return
			}
			if (key.name === "return") {
				key.preventDefault()
				closeFilter(true)
				return
			}
			if (key.name === "tab" || (key.ctrl && key.name === "i" && !key.shift && !key.meta)) {
				key.preventDefault()
				focusRef.current = "reader"
				restoreFilterOnSidebarFocusRef.current = true
				filterOpenRef.current = false
				setFilterOpen(false)
				setFocus("reader")
				return
			}
			if (key.ctrl && !key.meta && key.name === "p") {
				key.preventDefault()
				ctx.openPalette()
				return
			}
			if (key.ctrl && key.name === "\\") {
				key.preventDefault()
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
			if (
				(key.name === "backspace" || key.name === "delete") &&
				filterInputRef.current.length === 0
			) {
				key.preventDefault()
				// Backspace on empty input closes the modal — the leading `/`
				// chevron is the last thing left to "delete."
				closeFilter(false)
				return
			}
			if (key.name === "up") {
				key.preventDefault()
				navigator.moveBy(-1)
				return
			}
			if (key.name === "down") {
				key.preventDefault()
				navigator.moveBy(1)
				return
			}
			if (key.ctrl && (key.name === "u" || key.name === "d")) {
				key.preventDefault()
				return
			}
			if (!filterInputReadyRef.current) {
				if (key.name === "backspace" || key.name === "delete") {
					if (filterInputRef.current.length === 0) {
						key.preventDefault()
						closeFilter(false)
						return
					}
					filterInputRef.current = filterInputRef.current.slice(0, -1)
					setFilterInput(filterInputRef.current)
					navigator.selectIndex(0)
					return
				}
				if (key.ctrl || key.meta) return
				const char = printableFromKey(key)
				if (char !== null) {
					filterInputRef.current = filterInputRef.current + char
					setFilterInput(filterInputRef.current)
					navigator.selectIndex(0)
				}
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
		indicators:
			optionsSession.current === null
				? []
				: footerControlsFromSession(houseOptions, optionsSession.current, {
						wrap: { onActivate: toggleWrap },
						theme: { onActivate: () => cycleTheme(1) },
						order: { onActivate: cycleOrder },
					}),
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
					order={browseOrder}
					debounceMs={filterDebounceMs}
					navigatorRef={navigatorRef}
					snapshot={liveSnapshot}
					filterInput={filterInput}
					filterOpen={filterOpen}
					onFilterInput={(next) => {
						filterInputRef.current = next
						setFilterInput(next)
						navigator.selectIndex(0)
					}}
					onFilterEditingReady={(ready) => {
						filterInputReadyRef.current = ready
					}}
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
									focused={readerActive && !floatingModalOpen}
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
					onQueryChange={(next) => {
						paletteQueryRef.current = next
						setPaletteQuery(next)
						paletteIndexRef.current = 0
						setPaletteIndex(0)
					}}
					onInputReady={(ready) => {
						paletteInputReadyRef.current = ready
					}}
				/>
			)}
			{promptOpen && (
				<PromptModal
					title={promptPurpose === "rename" ? "Rename" : "New file"}
					query={promptInput}
					placeholder="File name"
					hints={
						promptPurpose === "rename" ? "enter rename  esc cancel" : "enter create  esc cancel"
					}
					status={promptStatus}
					{...(promptContext !== undefined ? { context: promptContext } : {})}
					viewportWidth={width}
					viewportHeight={height}
					onQueryChange={applyPromptInput}
					onInputReady={(ready) => {
						promptInputReadyRef.current = ready
					}}
					inputEnabled={!promptSubmitting}
				/>
			)}
			{activeStatusPopover && (
				<StatusPopoverPanel content={activeStatusPopover.content} variant="warning" />
			)}
		</box>
	)
}
