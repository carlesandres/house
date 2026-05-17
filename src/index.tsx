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
import { createCliRenderer, SyntaxStyle } from "@opentui/core"
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { RegistryProvider, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Effect } from "effect"
import { useMemo } from "react"
import pkg from "../package.json" with { type: "json" }
import { Browser } from "./Browser.tsx"
import { parseArgv, usage } from "./cli/argv.ts"
import { defaultConfigPath, formatConfigError, loadConfig } from "./config/load.ts"
import { walk, type SortOrder } from "./discovery/walk.ts"
import { readFileText } from "./io/readFile.ts"
import { openInBrowser } from "./serve/openBrowser.ts"
import { startServer } from "./serve/server.ts"
import { colors, setActiveTheme } from "./theme/colors.ts"
import { themeAtom, type ThemeState } from "./theme/atom.ts"
import { getThemeDefinition, themeDefinitions } from "./theme/registry.ts"

export interface AppProps {
	/** Markdown source to render. */
	readonly content: string
	/** Optional title shown in the frame border. Defaults to a generic label. */
	readonly title?: string
	/** Cap the rendered markdown's width at N columns (left-aligned). Null = fill the pane. */
	readonly maxWidth?: number | null
	/** Override quit behavior. Tests pass a spy; the binary uses the default. */
	readonly onQuit?: () => void
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

	return (
		<box style={{ width, height, flexDirection: "column", backgroundColor: colors.background }}>
			<box
				title={` ${title} `}
				titleAlignment="left"
				style={{
					border: true,
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

	const config = await Effect.runPromise(
		loadConfig({ cli: { theme: args.theme, tone: args.tone } }),
	).catch((err: unknown) => {
		console.error(`house: ${formatConfigError(err)}`)
		process.exit(2)
	})
	const { theme: themeId, tone } = config
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

	const target = args.path ?? "."

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
		await runTui({ target, themeId, tone, maxWidth, all: args.all, sort })
	}
}

interface TuiBootOptions {
	readonly target: string
	readonly themeId: string
	readonly tone: "dark" | "light"
	readonly maxWidth: number | null
	readonly all: boolean
	readonly sort: SortOrder
}

async function runTui({
	target,
	themeId,
	tone,
	maxWidth,
	all,
	sort,
}: TuiBootOptions): Promise<void> {
	let stats: Awaited<ReturnType<typeof stat>>
	try {
		stats = await stat(target)
	} catch (err) {
		console.error(`house: cannot access ${target}: ${String(err)}`)
		process.exit(1)
	}

	const renderer = await createCliRenderer({ exitOnCtrlC: false })
	const initialTheme: ThemeState = { id: themeId, tone }

	if (stats.isDirectory()) {
		const files = await Effect.runPromise(
			walk(target, { all, sort }).pipe(
				Effect.tapError((err) =>
					Effect.sync(() => {
						console.error(`house: cannot walk ${target}: ${String(err.cause)}`)
					}),
				),
			),
		).catch(() => {
			process.exit(1)
		})
		if (!Array.isArray(files)) process.exit(1)
		createRoot(renderer).render(
			<RegistryProvider initialValues={[[themeAtom, initialTheme]]}>
				<Browser files={files} title={target} maxWidth={maxWidth} />
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
