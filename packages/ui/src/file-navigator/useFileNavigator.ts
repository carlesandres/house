import { useEffect, useLayoutEffect, useReducer, useRef } from "react"
import type {
	FileFilterStrategy,
	FileId,
	FileNavigatorController,
	FileNavigatorSnapshot,
	UseFileNavigatorOptions,
} from "./types.ts"

interface NavigatorState<TFile, TId extends FileId> {
	appliedQuery: string
	filteredFiles: readonly TFile[]
	selectedId: TId | null
	priorIndex: number
	autoSelect: boolean
}

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value))

const assertUniqueIds = <TFile, TId extends FileId>(
	files: readonly TFile[],
	getId: (file: TFile) => TId,
): void => {
	const ids = new Set<TId>()
	for (const file of files) {
		const id = getId(file)
		if (ids.has(id)) {
			throw new Error(`useFileNavigator: duplicate file ID ${JSON.stringify(id)}`)
		}
		ids.add(id)
	}
}

const indexOfId = <TFile, TId extends FileId>(
	files: readonly TFile[],
	id: TId,
	getId: (file: TFile) => TId,
): number => files.findIndex((file) => getId(file) === id)

const reconcile = <TFile, TId extends FileId>(
	state: NavigatorState<TFile, TId>,
	filteredFiles: readonly TFile[],
	getId: (file: TFile) => TId,
): NavigatorState<TFile, TId> => {
	if (filteredFiles.length === 0) {
		return { ...state, filteredFiles, selectedId: null }
	}

	if (state.autoSelect) {
		return {
			...state,
			filteredFiles,
			selectedId: getId(filteredFiles[0]!),
			priorIndex: 0,
			autoSelect: false,
		}
	}

	if (state.selectedId !== null) {
		const retainedIndex = indexOfId(filteredFiles, state.selectedId, getId)
		if (retainedIndex >= 0) {
			return { ...state, filteredFiles, priorIndex: retainedIndex }
		}
	}

	const nextIndex =
		state.selectedId === null
			? 0
			: clamp(state.priorIndex, 0, Math.max(0, filteredFiles.length - 1))
	return {
		...state,
		filteredFiles,
		selectedId: getId(filteredFiles[nextIndex]!),
		priorIndex: nextIndex,
	}
}

const snapshotOf = <TFile, TId extends FileId>(
	state: NavigatorState<TFile, TId>,
	getId: (file: TFile) => TId,
): FileNavigatorSnapshot<TFile> => {
	if (state.selectedId === null) {
		return {
			appliedQuery: state.appliedQuery,
			filteredFiles: state.filteredFiles,
			selectedFile: null,
			selectedIndex: null,
		}
	}
	const selectedIndex = indexOfId(state.filteredFiles, state.selectedId, getId)
	const selectedFile = selectedIndex < 0 ? null : (state.filteredFiles[selectedIndex] ?? null)
	return {
		appliedQuery: state.appliedQuery,
		filteredFiles: state.filteredFiles,
		selectedFile,
		selectedIndex: selectedFile === null ? null : selectedIndex,
	}
}

const initialState = <TFile, TId extends FileId>(
	options: UseFileNavigatorOptions<TFile, TId>,
): NavigatorState<TFile, TId> => {
	assertUniqueIds(options.files, options.getId)
	const filteredFiles = options.filter(options.files, options.query)
	if (filteredFiles.length === 0) {
		return {
			appliedQuery: options.query,
			filteredFiles,
			selectedId: null,
			priorIndex: 0,
			autoSelect: options.query.length > 0,
		}
	}

	const initialIndex =
		options.query.length === 0 && options.initialSelectedId != null
			? indexOfId(filteredFiles, options.initialSelectedId, options.getId)
			: -1
	const selectedIndex = initialIndex >= 0 ? initialIndex : 0
	return {
		appliedQuery: options.query,
		filteredFiles,
		selectedId: options.getId(filteredFiles[selectedIndex]!),
		priorIndex: selectedIndex,
		autoSelect: false,
	}
}

/** Creates a controlled-query, ID-based file navigator controller. */
export const useFileNavigator = <TFile, TId extends FileId>({
	files,
	query,
	getId,
	getPath,
	filter,
	initialSelectedId,
	debounceMs = 50,
}: UseFileNavigatorOptions<TFile, TId>): FileNavigatorController<TFile, TId> => {
	const stateRef = useRef<NavigatorState<TFile, TId> | null>(null)
	let currentState = stateRef.current
	if (currentState === null) {
		currentState = initialState<TFile, TId>({
			files,
			query,
			getId,
			getPath,
			filter,
			...(initialSelectedId === undefined ? {} : { initialSelectedId }),
			debounceMs,
		})
		stateRef.current = currentState
	}
	const [, render] = useReducer((version: number) => version + 1, 0)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const filesRef = useRef(files)
	const getIdRef = useRef(getId)
	const getPathRef = useRef(getPath)
	const filterRef = useRef<FileFilterStrategy<TFile>>(filter)
	const revisionRef = useRef(0)
	const renderRevision = revisionRef.current

	assertUniqueIds(files, getId)
	const renderCandidate = reconcile(currentState, filter(files, currentState.appliedQuery), getId)

	const cancelTimer = (): void => {
		if (timerRef.current === null) return
		clearTimeout(timerRef.current)
		timerRef.current = null
	}

	const getSnapshot = (): FileNavigatorSnapshot<TFile> =>
		snapshotOf(stateRef.current!, getIdRef.current)

	const applySearch = (nextQuery: string): FileNavigatorSnapshot<TFile> => {
		cancelTimer()
		assertUniqueIds(filesRef.current, getIdRef.current)
		const current = stateRef.current!
		const queryChanged = current.appliedQuery !== nextQuery
		stateRef.current = reconcile(
			{
				...current,
				appliedQuery: nextQuery,
				autoSelect: queryChanged ? true : current.autoSelect,
			},
			filterRef.current(filesRef.current, nextQuery),
			getIdRef.current,
		)
		revisionRef.current += 1
		render()
		return getSnapshot()
	}

	const selectIndex = (index: number): FileNavigatorSnapshot<TFile> => {
		const current = stateRef.current!
		if (current.filteredFiles.length === 0) {
			stateRef.current = { ...current, selectedId: null }
		} else {
			const nextIndex = clamp(index, 0, current.filteredFiles.length - 1)
			stateRef.current = {
				...current,
				selectedId: getIdRef.current(current.filteredFiles[nextIndex]!),
				priorIndex: nextIndex,
			}
		}
		revisionRef.current += 1
		render()
		return getSnapshot()
	}

	const selectId = (id: TId): FileNavigatorSnapshot<TFile> => {
		const current = stateRef.current!
		const index = indexOfId(current.filteredFiles, id, getIdRef.current)
		if (index < 0) return getSnapshot()
		stateRef.current = { ...current, selectedId: id, priorIndex: index }
		revisionRef.current += 1
		render()
		return getSnapshot()
	}

	useLayoutEffect(() => {
		filesRef.current = files
		getIdRef.current = getId
		getPathRef.current = getPath
		filterRef.current = filter
		stateRef.current =
			revisionRef.current === renderRevision
				? renderCandidate
				: reconcile(stateRef.current!, filter(files, stateRef.current!.appliedQuery), getId)
		revisionRef.current += 1
	})

	useEffect(() => {
		cancelTimer()
		if (query === stateRef.current!.appliedQuery) return
		timerRef.current = setTimeout(() => applySearch(query), debounceMs)
		return cancelTimer
	}, [debounceMs, query])

	useEffect(() => cancelTimer, [])

	const snapshot = snapshotOf(renderCandidate, getId)
	return {
		...snapshot,
		getId,
		getPath,
		getSnapshot,
		flushSearch: applySearch,
		cancelAutoSelect: () => {
			stateRef.current = { ...stateRef.current!, autoSelect: false }
			revisionRef.current += 1
		},
		selectIndex,
		selectId,
		moveBy: (delta) => selectIndex((getSnapshot().selectedIndex ?? 0) + delta),
		selectFirst: () => selectIndex(0),
		selectLast: () => selectIndex(stateRef.current!.filteredFiles.length - 1),
	}
}
