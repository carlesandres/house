import type { InternalWatcher } from "./core/parcel-adapter.ts"

export type FileNavigatorWatcherFactory = () => InternalWatcher | Promise<InternalWatcher>

const sourceWatcher = async (): Promise<InternalWatcher> => {
	const { subscribe } = await import("@parcel/watcher")
	return { subscribe: (directory, callback) => subscribe(directory, callback) }
}

const globalWatcher = (): FileNavigatorWatcherFactory | undefined => {
	const value = (globalThis as Record<string, unknown>)["__house_file_navigator_watcher_factory__"]
	return typeof value === "function" ? (value as FileNavigatorWatcherFactory) : undefined
}

export const getFileNavigatorWatcher = async (): Promise<InternalWatcher> =>
	(globalWatcher() ?? sourceWatcher)()
