declare module "@parcel/watcher/wrapper" {
	import type { AsyncSubscription, SubscribeCallback } from "@parcel/watcher"

	interface ParcelBinding {
		getEventsSince: (...args: never[]) => Promise<unknown>
		subscribe: (...args: never[]) => Promise<void>
		unsubscribe: (...args: never[]) => Promise<void>
		writeSnapshot: (...args: never[]) => Promise<unknown>
	}

	interface ParcelWrapper {
		subscribe(directory: string, callback: SubscribeCallback): Promise<AsyncSubscription>
	}

	export function createWrapper(binding: ParcelBinding): ParcelWrapper
}
