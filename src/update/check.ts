/**
 * Update probe. Resolves to an upgrade record iff a strictly-newer version
 * is published on npm AND its tarball is actually downloadable.
 *
 * The HEAD on `dist.tarball` is the load-bearing step: the npm registry can
 * publish version metadata moments before the CDN serves the tarball, and
 * we promised not to nag the user toward a version they cannot install
 * yet. A non-200 HEAD invalidates the cache entry (tarballOk=false) so the
 * next launch retries instead of waiting out the TTL.
 *
 * All failures are silent. The notice surface is opportunistic — the user
 * should never see an error from a feature whose job is to whisper.
 */

import { isNewer } from "./compare.ts"
import { readCache, writeCache, type UpdateCacheRecord } from "./cache.ts"

export const TTL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 3000
const REGISTRY_URL = (pkgName: string) => `https://registry.npmjs.org/${pkgName}/latest`

export interface UpdateInfo {
	readonly pkgName: string
	readonly currentVersion: string
	readonly latestVersion: string
}

export interface CheckOptions {
	readonly pkgName: string
	readonly currentVersion: string
	/** Override for tests. Defaults to the npm registry + global fetch. */
	readonly now?: () => number
	readonly env?: Record<string, string | undefined>
	readonly fetchImpl?: typeof fetch
	readonly cacheRead?: () => Promise<UpdateCacheRecord | null>
	readonly cacheWrite?: (r: UpdateCacheRecord) => Promise<void>
}

/** Treat any non-empty, non-`0`, non-`false` value as opt-out. Mirrors the
 *  permissiveness of the de-facto npm-ecosystem convention; a user copy-
 *  pasting `NO_UPDATE_NOTIFIER=true` from another tool's docs should work. */
const isTruthyEnv = (value: string | undefined): boolean => {
	if (!value) return false
	const v = value.toLowerCase()
	return v !== "0" && v !== "false" && v !== "no"
}

/** Most major CIs (GitHub Actions, GitLab, Travis, CircleCI, Jenkins) set
 *  `CI=true`. A few set it to other truthy values; treat any non-empty
 *  value as "we're in CI, skip the nag." */
const isCi = (env: Record<string, string | undefined>): boolean =>
	typeof env.CI === "string" &&
	env.CI.length > 0 &&
	env.CI !== "0" &&
	env.CI.toLowerCase() !== "false"

/** Run a fetch with a single timeout that covers BOTH the response headers
 *  and the caller's body read. Returning the bare Response and then reading
 *  `res.json()` outside the timer leaves the body stream unbounded — a
 *  stalled connection after headers would hang forever. The consumer
 *  callback runs while the AbortController is still live, so an abort
 *  cancels an in-flight body read too. */
const fetchWithTimeout = async <T>(
	url: string,
	init: RequestInit,
	consume: (res: Response) => Promise<T>,
	fetchImpl: typeof fetch = fetch,
): Promise<T> => {
	const ctrl = new AbortController()
	const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
	try {
		const res = await fetchImpl(url, { ...init, signal: ctrl.signal })
		return await consume(res)
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Run the probe and return upgrade info if one applies. `null` covers
 * every "no nag" case: opt-out, recent cache hit on the same version, no
 * newer version, registry/CDN failure, malformed response.
 */
export const checkForUpdate = async (opts: CheckOptions): Promise<UpdateInfo | null> => {
	const env = opts.env ?? process.env
	if (isTruthyEnv(env.NO_UPDATE_NOTIFIER) || isCi(env)) {
		return null
	}

	const now = opts.now ?? Date.now
	const cacheRead = opts.cacheRead ?? (() => readCache())
	const cacheWrite = opts.cacheWrite ?? ((r: UpdateCacheRecord) => writeCache(r))

	const cached = await cacheRead()
	const fresh = cached !== null && cached.tarballOk && now() - cached.checkedAt < TTL_MS
	if (fresh) {
		return isNewer(cached.latestVersion, opts.currentVersion)
			? {
					pkgName: opts.pkgName,
					currentVersion: opts.currentVersion,
					latestVersion: cached.latestVersion,
				}
			: null
	}

	// Probe the registry.
	let latestVersion: string
	let tarballUrl: string
	try {
		const parsed = await fetchWithTimeout(
			REGISTRY_URL(opts.pkgName),
			{ headers: { accept: "application/json" } },
			async (res) => {
				if (!res.ok) return null
				const body = (await res.json()) as unknown
				if (typeof body !== "object" || body === null) return null
				const obj = body as Record<string, unknown>
				const version = obj.version
				const dist = obj.dist as Record<string, unknown> | undefined
				const tarball = dist?.tarball
				if (typeof version !== "string" || typeof tarball !== "string") return null
				// The registry returns a CDN URL we're about to HEAD without
				// further validation. Pin to https so a compromised or proxied
				// registry can't redirect us to file://, http://, or another
				// scheme we'd issue a request against.
				try {
					if (new URL(tarball).protocol !== "https:") return null
				} catch {
					return null
				}
				return { version, tarball }
			},
			opts.fetchImpl,
		)
		if (!parsed) return null
		latestVersion = parsed.version
		tarballUrl = parsed.tarball
	} catch {
		return null
	}

	// Verify the artifact is actually downloadable. This is the step that
	// makes "only announced when the artifact is available" hold.
	let tarballOk = false
	try {
		tarballOk = await fetchWithTimeout(
			tarballUrl,
			{ method: "HEAD" },
			async (res) => res.ok,
			opts.fetchImpl,
		)
	} catch {
		tarballOk = false
	}

	await cacheWrite({ checkedAt: now(), latestVersion, tarballOk })

	if (!tarballOk) return null
	if (!isNewer(latestVersion, opts.currentVersion)) return null
	return {
		pkgName: opts.pkgName,
		currentVersion: opts.currentVersion,
		latestVersion,
	}
}
