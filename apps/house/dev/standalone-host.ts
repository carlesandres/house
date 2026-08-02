import type { ReleaseTarget } from "./release-targets.ts"

const watcherGlobal = "__house_file_navigator_watcher_factory__"

/** Generates the only standalone entrypoint that knows about native packages. */
export const generateStandaloneHost = (target: ReleaseTarget): string => `
import binding from ${JSON.stringify(target.parcelNativePackage)}
import { createWrapper } from "@parcel/watcher/wrapper"

const wrapper = createWrapper(binding)
globalThis[${JSON.stringify(watcherGlobal)}] = () => ({
	subscribe: (directory, callback) => wrapper.subscribe(directory, callback),
})

await import(${JSON.stringify("../../../src/standalone.ts")})
`

export const standaloneWatcherGlobal = watcherGlobal
