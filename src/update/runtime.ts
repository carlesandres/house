/**
 * Process-singleton wiring for the update probe.
 *
 * The probe runs at most once per process. The result lands in a module
 * variable so:
 *  - any UI surface (DiscoverShell, App) can subscribe and re-render when
 *    it resolves, without each one issuing its own request;
 *  - the `process.on("exit")` hook can synchronously read the result and
 *    print the quit-time notice (async work can't run during 'exit').
 *
 * Failures resolve to `null` — silent by design. See `check.ts`.
 */

import type { UpdateInfo } from "./check.ts"
import { checkForUpdate } from "./check.ts"

let current: UpdateInfo | null = null
let started = false
let pending: Promise<void> | null = null
const listeners = new Set<(info: UpdateInfo) => void>()

export const startUpdateProbe = (pkgName: string, currentVersion: string): Promise<void> => {
	if (pending) return pending
	started = true
	pending = checkForUpdate({ pkgName, currentVersion })
		.then((info) => {
			if (info) {
				current = info
				for (const cb of listeners) cb(info)
			}
		})
		.catch(() => {
			// silent — the feature is opportunistic
		})
	return pending
}

export const currentUpdateInfo = (): UpdateInfo | null => current

export const subscribeUpdateInfo = (cb: (info: UpdateInfo) => void): (() => void) => {
	if (current) cb(current)
	listeners.add(cb)
	return () => {
		listeners.delete(cb)
	}
}

export const isProbeStarted = (): boolean => started
