import { resolve } from "node:path"
import { createWrapper } from "@parcel/watcher/wrapper"
import type { ParcelEvent, ParcelSource } from "./types.ts"

export interface InternalSubscription {
	readonly unsubscribe: () => Promise<void>
}

export interface InternalWatcher {
	subscribe(
		directory: string,
		callback: (error: Error | null, events: readonly ParcelEvent[]) => void,
	): Promise<InternalSubscription>
}

type ParcelBinding = Parameters<typeof createWrapper>[0]
type ParcelSourceFactory = (binding: ParcelBinding) => ParcelSource

const sourceFromBinding: ParcelSourceFactory = (binding) => createWrapper(binding)

const createParcelWatcher = (subscriptionSource: ParcelSource): InternalWatcher => ({
	subscribe: async (directory, callback) =>
		subscriptionSource.subscribe(resolve(directory), callback),
})

export const createParcelWatcherFromBinding = (
	binding: ParcelBinding,
	sourceFactory: ParcelSourceFactory = sourceFromBinding,
): InternalWatcher => createParcelWatcher(sourceFactory(binding))
