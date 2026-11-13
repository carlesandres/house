import { describe, expect, test } from "bun:test"
import { checkForUpdate, MAX_REGISTRY_BODY_BYTES, TTL_MS } from "../../src/update/check.ts"
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

/** A pull-based body that serves `chunks` and then, if `oversized`, 4 MB
 *  of filler. Tracks how much was pulled and whether the reader cancelled,
 *  so tests can show a body was abandoned mid-stream. The filler is finite
 *  so a reader that waits for EOF fails the assertions instead of hanging. */
const OVERSIZED_FILLER_BYTES = 4 * 1024 * 1024
const trackedStream = (chunks: readonly string[], { oversized = false } = {}) => {
	const enc = new TextEncoder()
	const filler = enc.encode(" ".repeat(16 * 1024))
	const stats = { pulledBytes: 0, cancelled: false, finished: false }
	let i = 0
	let fillerLeft = oversized ? OVERSIZED_FILLER_BYTES : 0
	const stream = new ReadableStream<Uint8Array>({
		pull(ctrl) {
			let next: Uint8Array | null = null
			if (i < chunks.length) next = enc.encode(chunks[i++]!)
			else if (fillerLeft > 0) {
				next = filler
				fillerLeft -= filler.byteLength
			}
			if (next === null) {
				stats.finished = true
				ctrl.close()
				return
			}
			stats.pulledBytes += next.byteLength
			ctrl.enqueue(next)
		},
		cancel() {
			stats.cancelled = true
		},
	})
	return { stream, stats }
}

const registryKey = "GET https://registry.npmjs.org/@carlesandres/house/latest"
const validBody = JSON.stringify({
	version: "0.5.0",
	dist: { tarball: "https://cdn.example/house-0.5.0.tgz" },
})

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

	describe("registry body size cap", () => {
		const run = (fakeFetch: typeof fetch) =>
			checkForUpdate({
				...baseOpts,
				env: {},
				fetchImpl: fakeFetch,
				cacheRead: async () => null,
				cacheWrite: async () => {},
			})

		test("rejects an honest oversized Content-Length without reading the body", async () => {
			const { stream, stats } = trackedStream([], { oversized: true })
			const { fetch: fakeFetch, calls } = makeFakeFetch({
				[registryKey]: () =>
					new Response(stream, {
						status: 200,
						headers: { "content-length": String(10 * 1024 * 1024) },
					}),
			})
			expect(await run(fakeFetch)).toBeNull()
			expect(stats.cancelled).toBe(true)
			// At most whatever the runtime pre-pulls; never streamed toward the cap.
			expect(stats.pulledBytes).toBeLessThan(MAX_REGISTRY_BODY_BYTES)
			expect(calls.map((c) => c.method)).toEqual(["GET"])
		})

		test("stops reading an oversized body that has no Content-Length", async () => {
			const { stream, stats } = trackedStream(['{"version":"0.5.0","pad":"'], { oversized: true })
			const { fetch: fakeFetch, calls } = makeFakeFetch({
				[registryKey]: () => new Response(stream, { status: 200 }),
			})
			expect(await run(fakeFetch)).toBeNull()
			expect(stats.cancelled).toBe(true)
			expect(stats.pulledBytes).toBeLessThan(MAX_REGISTRY_BODY_BYTES * 2)
			expect(calls.map((c) => c.method)).toEqual(["GET"])
		})

		test("stops reading a body that outgrows an understated Content-Length", async () => {
			const { stream, stats } = trackedStream(['{"version":"0.5.0","pad":"'], { oversized: true })
			const { fetch: fakeFetch } = makeFakeFetch({
				[registryKey]: () =>
					new Response(stream, { status: 200, headers: { "content-length": "100" } }),
			})
			expect(await run(fakeFetch)).toBeNull()
			expect(stats.cancelled).toBe(true)
		})

		test("accepts a normal body streamed in chunks without Content-Length", async () => {
			const half = Math.floor(validBody.length / 2)
			const { stream, stats } = trackedStream([validBody.slice(0, half), validBody.slice(half)])
			const { fetch: fakeFetch } = makeFakeFetch({
				[registryKey]: () => new Response(stream, { status: 200 }),
				"HEAD https://cdn.example/house-0.5.0.tgz": () => head(200),
			})
			expect((await run(fakeFetch))?.latestVersion).toBe("0.5.0")
			expect(stats.finished).toBe(true)
		})

		/** A valid registry body padded to exactly `bytes` long. */
		const bodyOfSize = (bytes: number): string => {
			const padded = validBody.slice(0, -1) + "," + JSON.stringify({ pad: "" }).slice(1)
			const body = padded.replace('"pad":""', `"pad":"${"x".repeat(bytes - padded.length)}"`)
			expect(new TextEncoder().encode(body).byteLength).toBe(bytes)
			return body
		}

		test.each([["with"], ["without"]])(
			"rejects a body one byte over the cap, %s Content-Length",
			async (mode) => {
				const body = bodyOfSize(MAX_REGISTRY_BODY_BYTES + 1)
				const { stream } = trackedStream([body])
				const headers: Record<string, string> =
					mode === "with" ? { "content-length": String(body.length) } : {}
				const { fetch: fakeFetch, calls } = makeFakeFetch({
					[registryKey]: () => new Response(stream, { status: 200, headers }),
				})
				expect(await run(fakeFetch)).toBeNull()
				expect(calls.map((c) => c.method)).toEqual(["GET"])
			},
		)

		test("accepts a body exactly at the cap", async () => {
			const body = bodyOfSize(MAX_REGISTRY_BODY_BYTES)
			const { fetch: fakeFetch } = makeFakeFetch({
				[registryKey]: () =>
					new Response(body, { status: 200, headers: { "content-length": String(body.length) } }),
				"HEAD https://cdn.example/house-0.5.0.tgz": () => head(200),
			})
			expect((await run(fakeFetch))?.latestVersion).toBe("0.5.0")
		})
	})
})
