#!/usr/bin/env bun
/**
 * house — entry point.
 *
 * Reads a markdown file path from argv and renders it via opentui's built-in
 * <markdown> component inside a scrollbox. q / ctrl+c to quit.
 *
 * Discovery, sidebar, theming, and richer Effect wiring all land after this.
 */

import { stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { createCliRenderer, SyntaxStyle } from "@opentui/core"
import type { BorderSides } from "@opentui/core"
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { RegistryProvider, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Cause, Duration, Effect, Fiber, Stream } from "effect"
import { useEffect, useMemo, useRef, useState } from "react"
import pkg from "../package.json" with { type: "json" }
import { Browser, type StartupFocus } from "./Browser.tsx"
import { parseArgv, usage } from "./cli/argv.ts"
import { defaultConfigPath, formatConfigError, loadConfig } from "./config/load.ts"
import { parseShowList, SHOW_CATEGORIES, type ShowCategory } from "./discovery/show.ts"
import { walk, type FileEntry, type SortOrder } from "./discovery/walk.ts"
import { Header } from "./Header.tsx"
import { readFileText } from "./io/readFile.ts"
import { openInBrowser } from "./serve/openBrowser.ts"
import { startServer } from "./serve/server.ts"
import { colors, setActiveTheme } from "./theme/colors.ts"
import { themeAtom, type ThemeState } from "./theme/atom.ts"
import { getThemeDefinition, themeDefinitions } from "./theme/registry.ts"
import { formatQuitNotice } from "./update/notice.ts"
import { currentUpdateInfo, startUpdateProbe } from "./update/runtime.ts"
import { useUpdateNotice } from "./update/useUpdateNotice.ts"

export interface AppProps {
	/** Markdown source to render. */
	readonly content: string
	/** Optional title shown in the header's current-file slot. Defaults to a generic label. */
	readonly title?: string
	/** Cap the rendered markdown's width at N columns (left-aligned). Null = fill the pane. */
	readonly maxWidth?: number | null
	/** Override quit behavior. Tests pass a spy; the binary uses the default. */
	readonly onQuit?: () => void
}

/**
 * DiscoverShell — owns the streaming walk for directory mode. Mounts Browser
 * immediately with `files=[]` and pushes entries as the stream emits.
 *
 * Batching: `Stream.groupedWithin(64, 60ms)` coalesces bursts so we don't
 * trigger one React render per file. Tuned by feel — small enough that
 * results still feel live on tiny trees, large enough to keep render
 * frequency sane on big ones. Revisit if profiling says otherwise.
 *
 * Cancellation: the walk runs on a forked fiber; unmount interrupts it.
 * `Quit` in Browser tears down the renderer and exits, which propagates
 * naturally — the cleanup effect still fires before process.exit completes.
 */
export type SidebarMode = "auto" | "on" | "off"

const pathIsDirectory = async (path: string): Promise<boolean> => {
	try {
		return (await stat(path)).isDirectory()
	} catch {
		return false
	}
}

const findGitRoot = async (cwd: string): Promise<string> => {
	const start = resolve(cwd)
	let current = start
	for (;;) {
		if (await pathIsDirectory(resolve(current, ".git"))) return current
		const parent = dirname(current)
		if (parent === current) return start
		current = parent
	}
}

export const resolveDiscoveryRoot = async ({
	cliRoot,
	defaultRoot,
	cwd,
}: {
	readonly cliRoot: string | null
	readonly defaultRoot: "cwd" | "git"
	readonly cwd: string
}): Promise<string> => {
	if (cliRoot !== null) return cliRoot
	if (defaultRoot === "git") return findGitRoot(cwd)
	return cwd
}

export const validateDiscoveryRoot = async (root: string): Promise<void> => {
	let stats: Awaited<ReturnType<typeof stat>>
	try {
		stats = await stat(root)
	} catch (err) {
		throw new Error(`cannot access discovery root ${root}: ${String(err)}`)
	}
	if (!stats.isDirectory()) {
		throw new Error(`discovery root must be a directory, got file ${root}`)
	}
}

export const formatPartialDiscoveryStatus = ({
	skippedCount,
	lastSkippedPath,
}: {
	readonly skippedCount: number
	readonly lastSkippedPath: string | null
}): string | null => {
	if (skippedCount <= 0) return null
	const noun = skippedCount === 1 ? "directory" : "directories"
	const suffix = lastSkippedPath && skippedCount === 1 ? `: ${lastSkippedPath}` : ""
	return `scan incomplete: skipped ${skippedCount} ${noun}${suffix}`
}

interface DiscoverShellProps {
	readonly target: string
	/** Resolved discovery vocabulary from the config layer. The shift+a
	 *  toggle (#145) is session-only sugar that flips between this set
	 *  and the full vocabulary; the underlying categories remain
	 *  independent everywhere else. */
	readonly initialShow: readonly ShowCategory[]
	readonly sort: SortOrder
	readonly mdx: boolean
	readonly maxWidth: number | null
	readonly sidebarMode: SidebarMode
	readonly startupFocus: StartupFocus
}

const DiscoverShell = ({
	target,
	initialShow,
	sort,
	mdx,
	maxWidth,
	sidebarMode,
	startupFocus,
}: DiscoverShellProps) => {
	const updateNotice = useUpdateNotice()
	const [show, setShow] = useState<readonly ShowCategory[]>(initialShow)
	const [files, setFiles] = useState<readonly FileEntry[]>([])
	const [scanning, setScanning] = useState<boolean>(true)
	const [scanError, setScanError] = useState<string | null>(null)
	const [skippedDirCount, setSkippedDirCount] = useState<number>(0)
	const [lastSkippedDir, setLastSkippedDir] = useState<string | null>(null)
	// Files arrive in a ref-tracked count so the status string can show
	// "indexing… N" even when React hasn't yet flushed the latest setFiles.
	const countRef = useRef(0)

	useEffect(() => {
		// Restart from a clean slate every time the discovery set changes.
		// Required for the `all` toggle (#145): without this, a flip would
		// concatenate the new walk onto stale entries and leave `scanning`
		// stuck on whatever the previous walk last set it to.
		setFiles([])
		setScanning(true)
		setScanError(null)
		setSkippedDirCount(0)
		setLastSkippedDir(null)
		countRef.current = 0
		const warnedProgram = walk(target, {
			show,
			sort,
			mdx,
			onWarning: ({ path }) => {
				setSkippedDirCount((prev) => prev + 1)
				setLastSkippedDir(path)
			},
		}).pipe(
			Stream.groupedWithin(64, Duration.millis(60)),
			Stream.runForEach((chunk) =>
				Effect.sync(() => {
					const arr = Array.from(chunk)
					if (arr.length === 0) return
					countRef.current += arr.length
					setFiles((prev) => [...prev, ...arr])
				}),
			),
			Effect.matchCauseEffect({
				onSuccess: () => Effect.sync(() => setScanning(false)),
				onFailure: (cause) =>
					Effect.sync(() => {
						if (Cause.hasInterrupts(cause)) return
						setScanError(`scan failed: ${Cause.pretty(cause)}`)
						setScanning(false)
					}),
			}),
		)
		const fiber = Effect.runFork(warnedProgram)
		return () => {
			Effect.runFork(Fiber.interrupt(fiber))
		}
	}, [target, show, sort, mdx])

	const discoveryStatus =
		scanError ??
		(scanning
			? `indexing… ${countRef.current}`
			: formatPartialDiscoveryStatus({
					skippedCount: skippedDirCount,
					lastSkippedPath: lastSkippedDir,
				}))

	return (
		<Browser
			files={files}
			maxWidth={maxWidth}
			discoveryStatus={discoveryStatus}
			sidebarMode={sidebarMode}
			startupFocus={startupFocus}
			updateNotice={updateNotice}
			onToggleAll={() => {
				// shift+a is the only place the categories are treated as a
				// single thing. If every category is already on, fall back
				// to "show none"; otherwise opt into the full vocabulary.
				// Each press is a stable round-trip between [] and full.
				const next: readonly ShowCategory[] =
					show.length === SHOW_CATEGORIES.length ? [] : [...SHOW_CATEGORIES]
				setShow(next)
			}}
		/>
	)
}

export const App = ({ content, title = "house", maxWidth = null, onQuit }: AppProps) => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const theme = useAtomValue(themeAtom)
	const setTheme = useAtomSet(themeAtom)
	const syntaxStyle = useMemo(() => SyntaxStyle.fromStyles(colors.syntax), [theme])

	const cycleTheme = (delta: 1 | -1) => {
		const idx = themeDefinitions.findIndex((d) => d.id === theme.id)
		const next = themeDefinitions[(idx + delta + themeDefinitions.length) % themeDefinitions.length]
		if (!next) return
		setActiveTheme(next, theme.tone)
		setTheme({ id: next.id, tone: theme.tone })
	}

	const toggleTone = () => {
		const nextTone = theme.tone === "dark" ? "light" : "dark"
		const def = getThemeDefinition(theme.id)
		if (def) setActiveTheme(def, nextTone)
		setTheme({ id: theme.id, tone: nextTone })
	}

	useKeyboard((key) => {
		if (key.name === "q" || (key.ctrl && key.name === "c")) {
			if (onQuit) {
				onQuit()
				return
			}
			renderer?.destroy()
			process.exit(0)
		}
		if (key.name === "t" && !key.shift) cycleTheme(1)
		if (key.name === "t" && key.shift) cycleTheme(-1)
		if (key.name === "l" && key.shift) toggleTone()
	})

	const paneBorderSides: BorderSides[] = ["top", "bottom"]

	return (
		<box style={{ width, height, flexDirection: "column", backgroundColor: colors.background }}>
			<Header width={width} currentFile={title} />
			<box
				style={{
					border: paneBorderSides,
					borderColor: colors.border,
					padding: 1,
					flexGrow: 1,
					flexShrink: 1,
					backgroundColor: colors.background,
				}}
			>
				<scrollbox
					style={{
						scrollY: true,
						scrollX: false,
						flexGrow: 1,
						flexShrink: 1,
						backgroundColor: colors.background,
					}}
					focused
				>
					<markdown
						content={content}
						syntaxStyle={syntaxStyle}
						fg={colors.text}
						bg={colors.background}
						conceal
						style={{ width: maxWidth ?? "100%" }}
					/>
				</scrollbox>
			</box>
		</box>
	)
}

let updateExitHookRegistered = false

if (import.meta.main) {
	const args = parseArgv(Bun.argv.slice(2))

	if (args.help) {
		console.log(usage)
		process.exit(0)
	}
	if (args.version) {
		console.log(pkg.version)
		process.exit(0)
	}
	if (args.configPath) {
		console.log(defaultConfigPath())
		process.exit(0)
	}

	// Parse --show eagerly so an invalid token fails fast with the CLI-style
	// "house: ..." message, before any I/O work in loadConfig kicks off.
	let cliShow: readonly ShowCategory[] | null = null
	if (args.show !== null) {
		const parsed = parseShowList(args.show)
		if (!parsed.ok) {
			console.error(
				`house: --show: unknown category "${parsed.invalid.join('", "')}" (valid: ${SHOW_CATEGORIES.join(", ")})`,
			)
			process.exit(2)
		}
		cliShow = parsed.value
	}

	const config = await Effect.runPromise(
		loadConfig({
			cli: {
				theme: args.theme,
				tone: args.tone,
				// --no-mdx is a one-way override: present means "off". When
				// absent, fall through to env/file/default.
				mdx: args.noMdx ? false : null,
				// `--show` replaces env/file when present (set semantics —
				// no per-category merge across sources). `null` falls through.
				show: cliShow,
				focus:
					args.focus === "sidebar" || args.focus === "reader" || args.focus === "filter"
						? args.focus
						: null,
			},
		}),
	).catch((err: unknown) => {
		console.error(`house: ${formatConfigError(err)}`)
		process.exit(2)
	})
	const { theme: themeId, tone, mdx, show, focus: startupFocus, defaultRoot } = config
	const themeDef = getThemeDefinition(themeId)
	if (themeDef === undefined) {
		// Unreachable: Config.schema validated themeId against themeDefinitions.
		console.error(`house: unknown theme "${themeId}"`)
		process.exit(2)
	}
	setActiveTheme(themeDef, tone)

	let maxWidth: number | null = null
	if (args.width !== null) {
		const n = Number.parseInt(args.width, 10)
		if (!Number.isFinite(n) || n <= 0) {
			console.error(`house: --width must be a positive integer, got "${args.width}"`)
			process.exit(2)
		}
		maxWidth = n
	}

	const cwd = process.cwd()
	const target = args.path ?? "."
	const discoveryRoot = await resolveDiscoveryRoot({ cliRoot: args.root, defaultRoot, cwd })

	if (args.serve) {
		let stats: Awaited<ReturnType<typeof stat>>
		try {
			stats = await stat(target)
		} catch (err) {
			console.error(`house: cannot access ${target}: ${String(err)}`)
			process.exit(1)
		}
		if (stats.isDirectory()) {
			console.error(`house: --serve requires a file, got directory ${target}`)
			process.exit(2)
		}
		let port = 0
		if (args.port !== null) {
			const n = Number.parseInt(args.port, 10)
			if (!Number.isFinite(n) || n < 0 || n > 65535) {
				console.error(`house: --port must be 0-65535, got "${args.port}"`)
				process.exit(2)
			}
			port = n
		}
		const handle = startServer({ path: target, port })
		console.log(`house serving ${target} at ${handle.url}`)
		console.log("press ctrl+c to stop")
		openInBrowser(handle.url)
		const shutdown = async () => {
			await handle.stop()
			process.exit(0)
		}
		process.on("SIGINT", shutdown)
		process.on("SIGTERM", shutdown)
		// Bun.serve keeps the event loop alive until stop().
	} else {
		let sort: SortOrder = "dirs-first"
		if (args.sort !== null) {
			if (args.sort !== "dirs-first" && args.sort !== "files-first") {
				console.error(`house: --sort must be "dirs-first" or "files-first", got "${args.sort}"`)
				process.exit(2)
			}
			sort = args.sort
		}
		let sidebarMode: SidebarMode = "auto"
		if (args.sidebar !== null) {
			if (args.sidebar !== "auto" && args.sidebar !== "on" && args.sidebar !== "off") {
				console.error(`house: --sidebar must be "auto", "on", or "off", got "${args.sidebar}"`)
				process.exit(2)
			}
			sidebarMode = args.sidebar
		}
		if (args.focus !== null) {
			if (args.focus !== "sidebar" && args.focus !== "reader" && args.focus !== "filter") {
				console.error(
					`house: --focus must be "sidebar", "reader", or "filter", got "${args.focus}"`,
				)
				process.exit(2)
			}
		}
		await runTui({
			target,
			discoveryRoot,
			themeId,
			tone,
			maxWidth,
			show,
			sort,
			mdx,
			sidebarMode,
			startupFocus,
			updateCheck: !args.noUpdateCheck,
		})
	}
}

interface TuiBootOptions {
	readonly target: string
	readonly discoveryRoot: string
	readonly themeId: string
	readonly tone: "dark" | "light"
	readonly maxWidth: number | null
	readonly show: readonly ShowCategory[]
	readonly sort: SortOrder
	readonly mdx: boolean
	readonly sidebarMode: SidebarMode
	readonly startupFocus: StartupFocus
	/** Run the npm-registry probe and surface the "update available" notice.
	 *  False suppresses both the toast and the quit-time print. */
	readonly updateCheck: boolean
}

async function runTui({
	target,
	discoveryRoot,
	themeId,
	tone,
	maxWidth,
	show,
	sort,
	mdx,
	sidebarMode,
	startupFocus,
	updateCheck,
}: TuiBootOptions): Promise<void> {
	let stats: Awaited<ReturnType<typeof stat>>
	try {
		stats = await stat(target)
	} catch (err) {
		console.error(`house: cannot access ${target}: ${String(err)}`)
		process.exit(1)
	}

	if (updateCheck) {
		// Fire the npm-registry probe in the background. Result lands in a
		// module singleton; the React tree picks it up via `useUpdateNotice`
		// for the footer toast, and the 'exit' hook below reads it
		// synchronously for the scrollback print. Failures are silent — this
		// whole feature is opportunistic.
		startUpdateProbe(pkg.name, pkg.version)
		// Register once per process. Multiple 'exit' listeners would print
		// the notice multiple times if runTui were ever re-entered.
		if (!updateExitHookRegistered) {
			updateExitHookRegistered = true
			process.on("exit", () => {
				const info = currentUpdateInfo()
				if (info) process.stderr.write(formatQuitNotice(info))
			})
		}
	}

	const renderer = await createCliRenderer({ exitOnCtrlC: false })
	const initialTheme: ThemeState = { id: themeId, tone }

	if (stats.isDirectory()) {
		try {
			await validateDiscoveryRoot(discoveryRoot)
		} catch (err) {
			console.error(`house: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
		createRoot(renderer).render(
			<RegistryProvider initialValues={[[themeAtom, initialTheme]]}>
				<DiscoverShell
					target={discoveryRoot}
					initialShow={show}
					sort={sort}
					mdx={mdx}
					maxWidth={maxWidth}
					sidebarMode={sidebarMode}
					startupFocus={startupFocus}
				/>
			</RegistryProvider>,
		)
	} else {
		const content = await Effect.runPromise(
			readFileText(target).pipe(
				Effect.tapError((err) =>
					Effect.sync(() => {
						console.error(`house: cannot read ${err.path}: ${String(err.cause)}`)
					}),
				),
			),
		).catch(() => {
			process.exit(1)
		})
		if (typeof content !== "string") process.exit(1)
		createRoot(renderer).render(
			<RegistryProvider initialValues={[[themeAtom, initialTheme]]}>
				<App content={content} title={target} maxWidth={maxWidth} />
			</RegistryProvider>,
		)
	}
}
