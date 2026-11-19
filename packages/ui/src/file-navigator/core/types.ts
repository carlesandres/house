import type { Event, AsyncSubscription, SubscribeCallback } from "@parcel/watcher"

/** A discovered file: its paths, size and modification time. */
export interface FileRecord {
	readonly absolutePath: string
	readonly relativePath: string
	readonly basename: string
	readonly extension: string
	readonly size: number
	readonly mtimeMs: number
}

/**
 * Which files and directories a scan includes. Change `revision` to make the navigator rescan with
 * a new policy; a policy with the same `revision` and `recursive` value is ignored.
 */
export interface DiscoveryPolicy {
	readonly revision: string | number
	readonly recursive?: boolean
	readonly followSymlinks?: boolean
	readonly ignoreFiles?: readonly string[]
	readonly includeFile?: (path: string) => boolean | Promise<boolean>
	readonly includeDirectory?: (path: string) => boolean | Promise<boolean>
}

export interface FileMetadata {
	readonly size: number
	readonly mtimeMs: number
}

export interface ScanOptions {
	readonly signal?: AbortSignal
	readonly topologyOnly?: boolean
	readonly metadata?: (path: string) => FileMetadata | Promise<FileMetadata>
	readonly onBatch?: (
		files: readonly FileRecord[],
		complete: boolean,
		withdrawn?: boolean,
	) => void | Promise<void>
	readonly onWatchRoot?: (physicalPath: string) => void | Promise<void>
	readonly batchSize?: number
	readonly barrier?: (
		phase: "before-read" | "after-read",
		directory: string,
	) => void | Promise<void>
	readonly onDiagnostic?: (error: Error) => void
}

export interface ScanResult {
	readonly root: string
	readonly files: readonly FileRecord[]
	readonly watchDirectories: readonly {
		readonly physicalPath: string
		readonly lexicalPaths: readonly string[]
	}[]
	readonly watchRoots: readonly string[]
}

/** A custom sort order for the unfiltered list. */
export interface BrowseStrategy {
	readonly id: string
	readonly revision?: string | number
	readonly compare: (left: FileRecord, right: FileRecord) => number
}

/** Sort order for the unfiltered list: a built-in name or a custom `BrowseStrategy`. */
export type BrowseOrder = "tree" | "recently-modified" | BrowseStrategy

/** Scores a file against a query: higher is a better match, `null` excludes the file. */
export interface SearchStrategy {
	readonly id: string
	readonly revision?: string | number
	readonly score: (query: string, file: FileRecord) => number | null
}

export interface Publication {
	readonly added: readonly string[]
	readonly changed: readonly string[]
	readonly removed: readonly string[]
}

/** A non-fatal error from scanning, watching or filtering, numbered in the order it happened. */
export interface Diagnostic {
	readonly phase: "scan" | "watch" | "projection"
	readonly sequence: number
	readonly error: Error
}

export interface ParcelSource {
	subscribe(directory: string, callback: SubscribeCallback): Promise<AsyncSubscription>
}

/** A filesystem change event from `@parcel/watcher`. */
export type ParcelEvent = Event
