import type { ReactNode } from "react"

/** Stable primitive identifier accepted by the file navigator. */
export type FileId = string | number

/** Caller-owned filtering and ordering strategy. */
export type FileFilterStrategy<TFile> = (files: readonly TFile[], query: string) => readonly TFile[]

/** Current synchronous view of filtered files and selection. */
export interface FileNavigatorSnapshot<TFile> {
	readonly appliedQuery: string
	readonly filteredFiles: readonly TFile[]
	readonly selectedFile: TFile | null
	readonly selectedIndex: number | null
}

/** Inputs for the controlled-query file navigator hook. */
export interface UseFileNavigatorOptions<TFile, TId extends FileId> {
	readonly files: readonly TFile[]
	readonly query: string
	readonly getId: (file: TFile) => TId
	readonly getPath: (file: TFile) => string
	readonly filter: FileFilterStrategy<TFile>
	readonly initialSelectedId?: TId | null
	readonly debounceMs?: number
}

/** Selection and search state plus synchronous navigation actions. */
export interface FileNavigatorController<
	TFile,
	TId extends FileId,
> extends FileNavigatorSnapshot<TFile> {
	readonly getId: (file: TFile) => TId
	readonly getPath: (file: TFile) => string
	readonly getSnapshot: () => FileNavigatorSnapshot<TFile>
	readonly flushSearch: (query: string) => FileNavigatorSnapshot<TFile>
	readonly cancelAutoSelect: () => void
	readonly selectIndex: (index: number) => FileNavigatorSnapshot<TFile>
	readonly selectId: (id: TId) => FileNavigatorSnapshot<TFile>
	readonly moveBy: (delta: number) => FileNavigatorSnapshot<TFile>
	readonly selectFirst: () => FileNavigatorSnapshot<TFile>
	readonly selectLast: () => FileNavigatorSnapshot<TFile>
}

/** Semantic colors required to render a file navigator pane. */
export interface FileNavigatorTheme {
	readonly background: string
	readonly backgroundPanel: string
	readonly backgroundElement: string
	readonly text: string
	readonly textMuted: string
	readonly border: string
	readonly selectedListItemText: string
}

/** Supported navigator frame layouts. */
export type FileNavigatorVariant = "inline" | "stacked"

/** Caller-owned empty-state copy. */
export interface FileNavigatorEmptyState {
	readonly label: string
	readonly value: string
}

/** Values available to a custom one-line file renderer. */
export interface FileRowRenderContext<TFile> {
	readonly file: TFile
	readonly index: number
	readonly selected: boolean
	readonly width: number
	readonly theme: FileNavigatorTheme
}

/** Inputs for the complete controlled file navigator pane. */
export interface FileNavigatorProps<TFile, TId extends FileId> {
	readonly controller: FileNavigatorController<TFile, TId>
	readonly width: number
	readonly paneHeight: number
	readonly variant: FileNavigatorVariant
	readonly active: boolean
	readonly visible: boolean
	readonly theme: FileNavigatorTheme
	readonly header?: ReactNode
	readonly emptyState?: FileNavigatorEmptyState
	readonly renderFile?: (context: FileRowRenderContext<TFile>) => ReactNode
}
