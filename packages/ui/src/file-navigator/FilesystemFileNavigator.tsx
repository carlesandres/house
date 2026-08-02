import type { ReactElement, ReactNode, Ref } from "react"
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useReducer,
	useRef,
} from "react"
import { Sidebar } from "../sidebar/index.ts"
import type { SidebarAppearance } from "../sidebar/index.ts"
import { FileNavigatorCore } from "./core/engine.ts"
import { fuzzySearch } from "./core/strategies.ts"
import type {
	BrowseOrder,
	Diagnostic,
	DiscoveryPolicy,
	FileRecord,
	ParcelEvent,
	SearchStrategy,
} from "./core/types.ts"
import { DefaultFileRow } from "./row.tsx"
import { normalizeRoot } from "./core/scanner.ts"
import { getFileNavigatorWatcher } from "./watcher.ts"

export type { BrowseOrder, SearchStrategy } from "./core/types.ts"
export type {
	BrowseStrategy,
	Diagnostic,
	DiscoveryPolicy,
	FileRecord,
	ParcelEvent,
} from "./core/types.ts"
export type FileNavigatorAppearance = SidebarAppearance

export type FileNavigatorEmptyReason = "scanning" | "no-files" | "no-results" | "error"

export interface FileNavigatorSnapshot {
	readonly root: string
	readonly files: readonly FileRecord[]
	readonly filteredFiles: readonly FileRecord[]
	readonly appliedQuery: string
	readonly selectedFile: FileRecord | null
	readonly selectedIndex: number | null
	readonly scanning: boolean
	readonly watching: boolean
	readonly error: Error | null
	readonly diagnostics: readonly Diagnostic[]
}

export interface FileNavigatorHandle {
	readonly getSnapshot: () => FileNavigatorSnapshot
	readonly flushQuery: (query: string) => FileNavigatorSnapshot
	readonly selectIndex: (index: number) => FileNavigatorSnapshot
	readonly selectPath: (path: string) => FileNavigatorSnapshot
	readonly moveBy: (delta: number) => FileNavigatorSnapshot
	readonly selectFirst: () => FileNavigatorSnapshot
	readonly selectLast: () => FileNavigatorSnapshot
	readonly refresh: () => Promise<void>
}

export interface FileNavigatorRowContext {
	readonly file: FileRecord
	readonly index: number
	readonly selected: boolean
	readonly width: number
	readonly appearance: FileNavigatorAppearance
}

export interface FileNavigatorEmptyContext {
	readonly reason: FileNavigatorEmptyReason
	readonly query: string
	readonly error: Error | null
}

export interface FileNavigatorProps {
	readonly root: string
	readonly query: string
	readonly width: number
	readonly height: number
	readonly active: boolean
	readonly visible: boolean
	readonly watch?: boolean
	readonly policy?: DiscoveryPolicy
	readonly order?: BrowseOrder
	readonly search?: "fuzzy" | SearchStrategy
	readonly consistencyIntervalMs?: number | null
	readonly debounceMs?: number
	readonly initialSelectedPath?: string | null
	readonly onSelectionChange?: (file: FileRecord | null) => void
	readonly onSnapshot?: (files: readonly FileRecord[]) => void
	readonly onSelectedFileInvalidated?: (file: FileRecord, event?: ParcelEvent) => void
	readonly onDiagnostic?: (diagnostic: Diagnostic) => void
	readonly header?: ReactNode
	readonly renderFile?: (context: FileNavigatorRowContext) => ReactNode
	readonly renderEmpty?: (context: FileNavigatorEmptyContext) => ReactNode
	readonly appearance?: FileNavigatorAppearance
	readonly ref?: Ref<FileNavigatorHandle>
}

const emptyPolicy: DiscoveryPolicy = Object.freeze({ revision: 0 })

const snapshotOf = (
	core: FileNavigatorCore | null,
	root: string,
	scanning: boolean,
	error: Error | null,
): FileNavigatorSnapshot => ({
	root: core?.root ?? root,
	files: core?.files ?? Object.freeze([]),
	filteredFiles: core?.projection ?? Object.freeze([]),
	appliedQuery: core ? (currentQuery.get(core) ?? "") : "",
	selectedFile: core?.selected ?? null,
	selectedIndex: core?.selectedIndex ?? null,
	scanning,
	watching: core?.watching ?? false,
	error:
		core && !core.diagnostics.at(-1)?.error.message.startsWith("skipped directory:")
			? (core.diagnostics.at(-1)?.error ?? null)
			: core
				? null
				: error,
	diagnostics: core?.diagnostics ?? Object.freeze([]),
})

// The core deliberately keeps query private. The weak side table is component-owned and avoids
// widening the internal engine API just for presentation state.
const currentQuery = new WeakMap<FileNavigatorCore, string>()

const Component = (props: FileNavigatorProps, ref: Ref<FileNavigatorHandle>) => {
	const {
		root,
		query,
		width,
		height,
		active,
		visible,
		watch = true,
		policy = emptyPolicy,
		order = "tree",
		search = "fuzzy",
		consistencyIntervalMs,
		debounceMs = 50,
		initialSelectedPath,
		onSelectionChange,
		onSnapshot,
		onSelectedFileInvalidated,
		onDiagnostic,
		header,
		renderFile,
		renderEmpty,
		appearance,
	} = props
	const normalizedRoot = normalizeRoot(root)
	const engineRef = useRef<FileNavigatorCore | null>(null)
	const configRef = useRef<{
		root: string
		policyRevision: string | number
		recursive: boolean
		watch: boolean
		consistencyIntervalMs: number | null | undefined
	} | null>(null)
	const generationRef = useRef(0)
	const queryRef = useRef(query)
	const callbacks = useRef({
		onSelectionChange,
		onSelectedFileInvalidated,
		onDiagnostic,
		onSnapshot,
	})
	const [, render] = useReducer((value: number) => value + 1, 0)
	const scanningRef = useRef(true)
	const errorRef = useRef<Error | null>(null)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const redrawRef = useRef<() => void>(() => {})
	const flushQueryRef = useRef<(query: string) => FileNavigatorSnapshot>(() =>
		snapshotOf(null, normalizedRoot, true, null),
	)
	useLayoutEffect(() => {
		callbacks.current = { onSelectionChange, onSelectedFileInvalidated, onDiagnostic, onSnapshot }
	}, [onSelectionChange, onSelectedFileInvalidated, onDiagnostic, onSnapshot])

	const getSnapshot = (): FileNavigatorSnapshot =>
		snapshotOf(
			currentEngine(),
			normalizedRoot,
			scanningRef.current ||
				(currentEngine() === null && (engineRef.current !== null || configRef.current === null)),
			errorRef.current,
		)
	const redraw = (): void => render()
	redrawRef.current = redraw
	const currentEngine = (): FileNavigatorCore | null => {
		const engine = engineRef.current
		const config = configRef.current
		return engine && config?.root === normalizedRoot ? engine : null
	}
	const flushQuery = (next: string): FileNavigatorSnapshot => {
		if (timerRef.current !== null) clearTimeout(timerRef.current)
		timerRef.current = null
		queryRef.current = next
		const engine = currentEngine()
		if (engine) {
			currentQuery.set(engine, next)
			engine.setQuery(next)
		}
		redraw()
		return getSnapshot()
	}
	flushQueryRef.current = flushQuery
	const selectIndex = (index: number): FileNavigatorSnapshot => {
		currentEngine()?.selectIndex(index)
		redraw()
		return getSnapshot()
	}
	const selectPath = (path: string): FileNavigatorSnapshot => {
		currentEngine()?.selectPath(path)
		redraw()
		return getSnapshot()
	}
	const refresh = async (): Promise<void> => {
		const engine = currentEngine()
		if (!engine) return
		scanningRef.current = true
		errorRef.current = null
		redraw()
		try {
			await engine.refresh()
		} catch (error) {
			errorRef.current = error instanceof Error ? error : new Error(String(error))
		} finally {
			scanningRef.current = false
			redraw()
		}
	}
	useImperativeHandle(
		ref,
		() => ({
			getSnapshot,
			flushQuery,
			selectIndex,
			selectPath,
			moveBy: (delta) => selectIndex((getSnapshot().selectedIndex ?? 0) + delta),
			selectFirst: () => selectIndex(0),
			selectLast: () => selectIndex(getSnapshot().filteredFiles.length - 1),
			refresh,
		}),
		[],
	)

	useEffect(() => {
		const token = ++generationRef.current
		let cancelled = false
		scanningRef.current = true
		errorRef.current = null
		const selected = initialSelectedPath
		const start = async (): Promise<void> => {
			try {
				const watcher = watch ? await getFileNavigatorWatcher() : undefined
				if (cancelled || token !== generationRef.current) return
				const engine = new FileNavigatorCore(
					{
						root,
						policy: { ...policy, recursive: policy.recursive ?? true },
						watch,
						order,
						search: search === "fuzzy" ? fuzzySearch : search,
						...(selected === undefined ? {} : { initialSelectedPath: selected }),
						...(consistencyIntervalMs === undefined ? {} : { consistencyIntervalMs }),
						onSelectionChange: (file) => callbacks.current.onSelectionChange?.(file),
						onSnapshot: (files) => {
							callbacks.current.onSnapshot?.(files)
							scanningRef.current = true
							errorRef.current = null
							redrawRef.current()
						},
						onPublication: () => {
							scanningRef.current = false
							redrawRef.current()
						},
						onComplete: () => {
							scanningRef.current = false
							callbacks.current.onSnapshot?.(engine.files)
							redrawRef.current()
						},
						onSelectedInvalidation: (file, event) =>
							callbacks.current.onSelectedFileInvalidated?.(file, event),
						onDiagnostic: (diagnostic) => {
							if (!diagnostic.error.message.startsWith("skipped directory:"))
								errorRef.current = diagnostic.error
							scanningRef.current = false
							callbacks.current.onDiagnostic?.(diagnostic)
							redraw()
						},
					},
					watcher,
				)
				engineRef.current = engine
				configRef.current = {
					root: normalizedRoot,
					policyRevision: policy.revision,
					recursive: policy.recursive ?? true,
					watch,
					consistencyIntervalMs,
				}
				currentQuery.set(engine, queryRef.current)
				if (queryRef.current) engine.setQuery(queryRef.current)
				await engine.start()
				if (cancelled || token !== generationRef.current) return
				scanningRef.current = false
				redraw()
			} catch (error) {
				if (cancelled || token !== generationRef.current) return
				scanningRef.current = false
				errorRef.current = error instanceof Error ? error : new Error(String(error))
				redraw()
			}
		}
		void start()
		return () => {
			cancelled = true
			generationRef.current++
			if (timerRef.current !== null) clearTimeout(timerRef.current)
			timerRef.current = null
			const engine = engineRef.current
			engineRef.current = null
			configRef.current = null
			if (engine) void engine.close()
		}
	}, [root])

	useEffect(() => {
		const engine = engineRef.current
		if (!engine) return
		scanningRef.current = true
		redraw()
		void engine
			.updatePolicy({ ...policy, recursive: policy.recursive ?? true })
			.catch((error) => {
				errorRef.current = error instanceof Error ? error : new Error(String(error))
				redraw()
			})
			.then(() => {
				if (engineRef.current !== engine) return
				configRef.current = {
					...configRef.current!,
					policyRevision: policy.revision,
					recursive: policy.recursive ?? true,
				}
				scanningRef.current = false
				redraw()
			})
	}, [policy.revision, policy.recursive])

	useEffect(() => {
		const engine = engineRef.current
		if (!engine) return
		scanningRef.current = true
		redraw()
		void engine
			.setWatch(watch, consistencyIntervalMs)
			.catch((error) => {
				errorRef.current = error instanceof Error ? error : new Error(String(error))
				redraw()
			})
			.then(() => {
				if (engineRef.current !== engine) return
				configRef.current = {
					...configRef.current!,
					watch,
					consistencyIntervalMs,
				}
				scanningRef.current = false
				redraw()
			})
	}, [watch, consistencyIntervalMs])

	useEffect(() => {
		const engine = engineRef.current
		if (!engine) return
		engine.setOrder(order)
		engine.setSearch(search === "fuzzy" ? fuzzySearch : search)
		redraw()
	}, [order, search])

	useEffect(() => {
		if (queryRef.current === query) return
		if (query === "" || debounceMs === 0) {
			flushQuery(query)
			return
		}
		if (timerRef.current !== null) clearTimeout(timerRef.current)
		timerRef.current = setTimeout(() => flushQueryRef.current(query), debounceMs)
		return () => {
			if (timerRef.current !== null) clearTimeout(timerRef.current)
			timerRef.current = null
		}
	}, [query, debounceMs])

	const snapshot = getSnapshot()
	const emptyReason: FileNavigatorEmptyReason = snapshot.scanning
		? "scanning"
		: snapshot.error && snapshot.files.length === 0
			? "error"
			: snapshot.appliedQuery
				? "no-results"
				: "no-files"
	return (
		<Sidebar
			items={snapshot.filteredFiles}
			selectedId={snapshot.selectedFile?.absolutePath ?? null}
			getId={(file) => file.absolutePath}
			width={width}
			height={height}
			active={active}
			visible={visible}
			header={header}
			emptyState={
				renderEmpty ? (
					renderEmpty({ reason: emptyReason, query: snapshot.appliedQuery, error: snapshot.error })
				) : (
					<text
						content={
							{
								scanning: "Scanning…",
								"no-files": "No files found.",
								"no-results": "No results found.",
								error: "Unable to load files.",
							}[emptyReason]
						}
					/>
				)
			}
			renderItem={({ item, index, selected, width: rowWidth, appearance: resolved }) =>
				renderFile ? (
					renderFile({ file: item, index, selected, width: rowWidth, appearance: resolved })
				) : (
					<DefaultFileRow
						path={item.relativePath}
						selected={selected}
						width={rowWidth}
						theme={{
							background: resolved.backgroundColor ?? "#111827",
							backgroundPanel: resolved.panelColor ?? "#1f2937",
							backgroundElement: resolved.selectedColor ?? "#374151",
							text: resolved.selectedTextColor ?? "#f9fafb",
							textMuted: resolved.borderColor ?? "#4b5563",
							border: resolved.borderColor ?? "#4b5563",
							selectedListItemText: resolved.selectedTextColor ?? "#f9fafb",
						}}
					/>
				)
			}
			{...(appearance === undefined ? {} : { appearance })}
		/>
	)
}

export const FileNavigator = forwardRef(Component) as unknown as (
	props: FileNavigatorProps,
) => ReactElement | null
