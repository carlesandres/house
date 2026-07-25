import { describe, expect, test } from "bun:test"
import { checkForUpdate, TTL_MS } from "../../src/update/check.ts"
import type { UpdateCacheRecord } from "../../src/update/cache.ts"

interface FakeFetchCall {
	readonly url: string
	readonly method: string
}

const okJson = (body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	})

const head = (status: number): Response => new Response(null, { status })

const makeFakeFetch = (
	handlers: Record<string, () => Response | Promise<Response>>,
): { fetch: typeof fetch; calls: FakeFetchCall[] } => {
	const calls: FakeFetchCall[] = []
	const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString()
		const method = (init?.method ?? "GET").toUpperCase()
		calls.push({ url, method })
		const key = `${method} ${url}`
		const handler = handlers[key]
		if (!handler) throw new Error(`unexpected fetch: ${key}`)
		return handler()
	}) as unknown as typeof fetch
	return { fetch: fakeFetch, calls }
}

const baseOpts = {
	pkgName: "@carlesandres/house",
	currentVersion: "0.4.0",
}

describe("checkForUpdate", () => {
	test("returns upgrade info when registry has a newer version and tarball HEAD is OK", async () => {
		const { fetch: fakeFetch, calls } = makeFakeFetch({
			"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
				okJson({ version: "0.5.0", dist: { tarball: "https://cdn.example/house-0.5.0.tgz" } }),
			"HEAD https://cdn.example/house-0.5.0.tgz": () => head(200),
		})
		let written: UpdateCacheRecord | null = null as UpdateCacheRecord | null
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => null,
			cacheWrite: async (r) => {
				written = r
			},
		})
		expect(info?.latestVersion).toBe("0.5.0")
		expect(info?.currentVersion).toBe("0.4.0")
		expect(calls.map((c) => c.method)).toEqual(["GET", "HEAD"])
		expect(written?.tarballOk).toBe(true)
		expect(written?.latestVersion).toBe("0.5.0")
	})

	test("does NOT announce when the tarball HEAD fails (CDN propagation window)", async () => {
		const { fetch: fakeFetch } = makeFakeFetch({
			"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
				okJson({ version: "0.5.0", dist: { tarball: "https://cdn.example/house-0.5.0.tgz" } }),
			"HEAD https://cdn.example/house-0.5.0.tgz": () => head(404),
		})
		let written: UpdateCacheRecord | null = null as UpdateCacheRecord | null
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => null,
			cacheWrite: async (r) => {
				written = r
			},
		})
		expect(info).toBeNull()
		// Cache recorded the failed verification so next launch retries
		// rather than waiting out the TTL.
		expect(written?.tarballOk).toBe(false)
	})

	test("returns null when the registry version is not newer", async () => {
		const { fetch: fakeFetch } = makeFakeFetch({
			"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
				okJson({ version: "0.4.0", dist: { tarball: "https://cdn.example/house-0.4.0.tgz" } }),
			"HEAD https://cdn.example/house-0.4.0.tgz": () => head(200),
		})
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => null,
			cacheWrite: async () => {},
		})
		expect(info).toBeNull()
	})

	test("honours the cache within the TTL window and skips network entirely", async () => {
		const calls: string[] = []
		const fakeFetch = (async (input: Parameters<typeof fetch>[0]) => {
			calls.push(typeof input === "string" ? input : input.toString())
			throw new Error("should not fetch")
		}) as unknown as typeof fetch
		const cached: UpdateCacheRecord = {
			checkedAt: Date.now(),
			latestVersion: "0.5.0",
			tarballOk: true,
		}
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => cached,
			cacheWrite: async () => {},
		})
		expect(info?.latestVersion).toBe("0.5.0")
		expect(calls).toEqual([])
	})

	test("re-probes when the cached entry recorded a tarball failure, even within TTL", async () => {
		const cached: UpdateCacheRecord = {
			checkedAt: Date.now(),
			latestVersion: "0.5.0",
			tarballOk: false,
		}
		const { fetch: fakeFetch, calls } = makeFakeFetch({
			"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
				okJson({ version: "0.5.0", dist: { tarball: "https://cdn.example/house-0.5.0.tgz" } }),
			"HEAD https://cdn.example/house-0.5.0.tgz": () => head(200),
		})
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => cached,
			cacheWrite: async () => {},
		})
		expect(info?.latestVersion).toBe("0.5.0")
		expect(calls.length).toBe(2)
	})

	test("re-probes when the cache is older than the TTL window", async () => {
		const cached: UpdateCacheRecord = {
			checkedAt: Date.now() - TTL_MS - 1,
			latestVersion: "0.5.0",
			tarballOk: true,
		}
		const { fetch: fakeFetch, calls } = makeFakeFetch({
			"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
				okJson({ version: "0.6.0", dist: { tarball: "https://cdn.example/house-0.6.0.tgz" } }),
			"HEAD https://cdn.example/house-0.6.0.tgz": () => head(200),
		})
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => cached,
			cacheWrite: async () => {},
		})
		expect(info?.latestVersion).toBe("0.6.0")
		expect(calls.length).toBe(2)
	})

	test.each([["1"], ["true"], ["yes"], ["anything"]])(
		"NO_UPDATE_NOTIFIER=%s suppresses the probe",
		async (value) => {
			const fakeFetch = (async () => {
				throw new Error("should not fetch")
			}) as unknown as typeof fetch
			const info = await checkForUpdate({
				...baseOpts,
				env: { NO_UPDATE_NOTIFIER: value },
				fetchImpl: fakeFetch,
				cacheRead: async () => null,
				cacheWrite: async () => {},
			})
			expect(info).toBeNull()
		},
	)

	test.each([["0"], ["false"], ["no"], [""]])(
		"NO_UPDATE_NOTIFIER=%s is treated as not-set (probe runs)",
		async (value) => {
			const { fetch: fakeFetch } = makeFakeFetch({
				"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
					okJson({ version: "0.5.0", dist: { tarball: "https://cdn.example/h.tgz" } }),
				"HEAD https://cdn.example/h.tgz": () => head(200),
			})
			const info = await checkForUpdate({
				...baseOpts,
				env: { NO_UPDATE_NOTIFIER: value },
				fetchImpl: fakeFetch,
				cacheRead: async () => null,
				cacheWrite: async () => {},
			})
			expect(info?.latestVersion).toBe("0.5.0")
		},
	)

	test.each([["true"], ["1"], ["whatever"]])("CI=%s suppresses the probe", async (value) => {
		const fakeFetch = (async () => {
			throw new Error("should not fetch")
		}) as unknown as typeof fetch
		const info = await checkForUpdate({
			...baseOpts,
			env: { CI: value },
			fetchImpl: fakeFetch,
			cacheRead: async () => null,
			cacheWrite: async () => {},
		})
		expect(info).toBeNull()
	})

	test.each([["0"], ["false"], [""]])("CI=%s is treated as not-CI (probe runs)", async (value) => {
		const { fetch: fakeFetch } = makeFakeFetch({
			"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
				okJson({ version: "0.5.0", dist: { tarball: "https://cdn.example/h.tgz" } }),
			"HEAD https://cdn.example/h.tgz": () => head(200),
		})
		const info = await checkForUpdate({
			...baseOpts,
			env: { CI: value },
			fetchImpl: fakeFetch,
			cacheRead: async () => null,
			cacheWrite: async () => {},
		})
		expect(info?.latestVersion).toBe("0.5.0")
	})

	test("returns null on a fetch error and does not throw", async () => {
		const fakeFetch = (async () => {
			throw new Error("network down")
		}) as unknown as typeof fetch
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => null,
			cacheWrite: async () => {},
		})
		expect(info).toBeNull()
	})

	test("returns null on a malformed registry response", async () => {
		const { fetch: fakeFetch } = makeFakeFetch({
			"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
				okJson({ version: 123, dist: { tarball: null } }),
		})
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => null,
			cacheWrite: async () => {},
		})
		expect(info).toBeNull()
	})

	test("rejects a non-https tarball URL from the registry", async () => {
		const { fetch: fakeFetch, calls } = makeFakeFetch({
			"GET https://registry.npmjs.org/@carlesandres/house/latest": () =>
				okJson({ version: "0.5.0", dist: { tarball: "http://cdn.example/house-0.5.0.tgz" } }),
		})
		const info = await checkForUpdate({
			...baseOpts,
			env: {},
			fetchImpl: fakeFetch,
			cacheRead: async () => null,
			cacheWrite: async () => {},
		})
		expect(info).toBeNull()
		// We must not have issued the HEAD against the non-https URL.
		expect(calls.find((c) => c.method === "HEAD")).toBeUndefined()
	})
})
