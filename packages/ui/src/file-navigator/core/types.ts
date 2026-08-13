import type { Event, AsyncSubscription, SubscribeCallback } from "@parcel/watcher"

export interface FileRecord {
	readonly absolutePath: string
	readonly relativePath: string
	readonly basename: string
	readonly extension: string
	readonly size: number
	readonly mtimeMs: number
}

export interface DiscoveryPolicy {
	readonly revision: string | number
	readonly recursive?: boolean
	readonly followSymlinks?: boolean
	readonly ignoreFiles?: readonly string[]
	readonly includeFile?: (path: string) => boolean | Promise<boolean>
	readonly includeDirectory?: (path: string) => boolean | Promise<boolean>
}

export interface ScanOptions {
	readonly signal?: AbortSignal
	readonly topologyOnly?: boolean
	readonly metadata?: (path: string) => Promise<{ readonly size: number; readonly mtimeMs: number }>
	readonly onBatch?: (
		files: readonly FileRecord[],
		complete: boolean,
		withdrawn?: boolean,
	) => void | Promise<void>
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

export interface BrowseStrategy {
	readonly id: string
	readonly revision?: string | number
	readonly compare: (left: FileRecord, right: FileRecord) => number
}

export type BrowseOrder = "tree" | "recently-modified" | BrowseStrategy

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

export interface Diagnostic {
	readonly phase: "scan" | "watch" | "projection"
	readonly sequence: number
	readonly error: Error
}

export interface ParcelSource {
	subscribe(directory: string, callback: SubscribeCallback): Promise<AsyncSubscription>
}

export type ParcelEvent = Event
