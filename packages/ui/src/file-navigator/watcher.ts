import { subscribe } from "@parcel/watcher"
import type { InternalWatcher } from "./core/parcel-adapter.ts"

export type FileNavigatorWatcherFactory = () => InternalWatcher | Promise<InternalWatcher>

const sourceWatcher = (): InternalWatcher => ({
	subscribe: (directory, callback) => subscribe(directory, callback),
})

let watcherFactory: FileNavigatorWatcherFactory = sourceWatcher

export const getFileNavigatorWatcher = async (): Promise<InternalWatcher> => watcherFactory()

// This module is intentionally not re-exported. Standalone hosts install their generated,
// platform-static watcher here while source/dev uses Parcel's normal package entry.
export const setFileNavigatorWatcherFactory = (factory: FileNavigatorWatcherFactory): void => {
	watcherFactory = factory
}
