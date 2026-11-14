import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Subprocess } from "bun"

/**
 * `house --serve` runs the update probe too (HOU-106). These tests start the
 * real entry point and check the three conditions that made lifting the
 * probe out of the TUI acceptable: the notice goes to stderr only, the probe
 * never holds up shutdown, and every opt-out still applies.
 *
 * A fresh cache entry stands in for the registry so the probe resolves
 * without network access. Stub `open`/`xdg-open` keep the preview from
 * launching a real browser.
 */

const entry = fileURLToPath(new URL("../src/index.tsx", import.meta.url))
const NOTICE = "house 999.0.0 is available"
/** Each test runs a real process for its whole length; bun's 5 s default
 *  is too tight for a cold runner. `waitFor`'s limit stays below this so a
 *  stall reports what it was waiting for. */
const TEST_TIMEOUT_MS = 30_000

interface Running {
	readonly child: Subprocess<"ignore", "pipe", "pipe">
	readonly stdout: () => string
	readonly stderr: () => string
	/** Resolves with the exit code once the process exited and both
	 *  streams are drained. */
	readonly finished: () => Promise<number>
}

let dir: string | null = null
let running: Running | null = null
let proxy: Server | null = null
const proxySockets = new Set<Socket>()

afterEach(async () => {
	running?.child.kill("SIGKILL")
	await running?.child.exited
	running = null
	for (const socket of proxySockets) socket.destroy()
	proxySockets.clear()
	await new Promise<void>((done) => (proxy ? proxy.close(() => done()) : done()))
	proxy = null
	if (dir) await rm(dir, { recursive: true, force: true })
	dir = null
})

const collect = (stream: ReadableStream<Uint8Array>) => {
	let text = ""
	const decoder = new TextDecoder()
	const drained = (async () => {
		for await (const chunk of stream) text += decoder.decode(chunk, { stream: true })
		text += decoder.decode()
	})()
	return { text: () => text, drained }
}

const waitFor = async (check: () => boolean, what: string, limitMs = 20_000): Promise<void> => {
	const deadline = Date.now() + limitMs
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
		await Bun.sleep(20)
	}
}

const setup = async ({ freshCache }: { freshCache: boolean }): Promise<string> => {
	dir = await mkdtemp(join(tmpdir(), "house-serve-update-"))
	await writeFile(join(dir, "doc.md"), "# Doc\n")
	const bin = join(dir, "bin")
	await mkdir(bin)
	for (const name of ["open", "xdg-open"]) {
		await writeFile(join(bin, name), "#!/bin/sh\nexit 0\n")
		await chmod(join(bin, name), 0o755)
	}
	if (freshCache) {
		await mkdir(join(dir, "cache", "house"), { recursive: true })
		await writeFile(
			join(dir, "cache", "house", "update-check.json"),
			JSON.stringify({ checkedAt: Date.now(), latestVersion: "999.0.0", tarballOk: true }),
		)
	}
	return dir
}

const startServe = (
	root: string,
	{ args = [], env = {} }: { args?: string[]; env?: Record<string, string> } = {},
): Running => {
	const base = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !key.startsWith("HOUSE_") && key !== "CI" && key !== "NO_UPDATE_NOTIFIER",
		),
	)
	const child = Bun.spawn([process.execPath, entry, "--serve", "doc.md", ...args], {
		cwd: root,
		env: {
			...base,
			PATH: `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}`,
			XDG_CONFIG_HOME: join(root, "config"),
			XDG_CACHE_HOME: join(root, "cache"),
			...env,
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})
	const stdout = collect(child.stdout)
	const stderr = collect(child.stderr)
	running = {
		child,
		stdout: stdout.text,
		stderr: stderr.text,
		finished: async () => {
			const code = await child.exited
			await Promise.all([stdout.drained, stderr.drained])
			return code
		},
	}
	return running
}

describe("house --serve update notice", () => {
	test("prints the notice to stderr only, and still exits cleanly", async () => {
		const root = await setup({ freshCache: true })
		const run = startServe(root)
		await waitFor(() => run.stderr().includes(NOTICE), "the update notice on stderr")
		expect(run.stderr()).toContain("npm i -g @carlesandres/house")
		run.child.kill("SIGTERM")
		expect(await run.finished()).toBe(0)
		expect(run.stdout()).toContain("house serving doc.md at http://")
		expect(run.stdout()).not.toContain("is available")
		// Printed once, not again by an exit hook.
		expect(run.stderr().split(NOTICE).length - 1).toBe(1)
	}, TEST_TIMEOUT_MS)

	test("exits cleanly on SIGTERM while the registry request is still in flight", async () => {
		// No cache, and a proxy that accepts the registry connection and
		// never answers: the probe is guaranteed to be pending at shutdown.
		const root = await setup({ freshCache: false })
		let connections = 0
		proxy = createServer((socket) => {
			connections += 1
			proxySockets.add(socket)
			socket.on("error", () => {})
		})
		await new Promise<void>((done) => proxy!.listen(0, "127.0.0.1", done))
		const address = proxy.address()
		if (address === null || typeof address === "string") throw new Error("no proxy port")
		const proxyUrl = `http://127.0.0.1:${address.port}`
		const run = startServe(root, {
			env: {
				HTTPS_PROXY: proxyUrl,
				https_proxy: proxyUrl,
				HTTP_PROXY: proxyUrl,
				http_proxy: proxyUrl,
				NO_PROXY: "",
				no_proxy: "",
			},
		})
		await waitFor(() => connections > 0, "the probe to reach the registry")
		run.child.kill("SIGTERM")
		expect(await run.finished()).toBe(0)
		expect(run.stderr()).not.toContain("is available")
		expect(run.stderr()).not.toContain("house:")
	}, TEST_TIMEOUT_MS)

	const optOuts: [string, { args?: string[]; env?: Record<string, string> }][] = [
		["--no-update-check", { args: ["--no-update-check"] }],
		["NO_UPDATE_NOTIFIER=1", { env: { NO_UPDATE_NOTIFIER: "1" } }],
		["CI=true", { env: { CI: "true" } }],
	]
	test.each(optOuts)("%s suppresses the notice", async (_label, opts) => {
		const root = await setup({ freshCache: true })
		const run = startServe(root, opts)
		await waitFor(() => run.stdout().includes("press ctrl+c to stop"), "the server to start")
		// Negative assertion: give a fresh-cache probe ample time to have
		// printed if it were going to. Without the opt-out it prints within
		// milliseconds of startup (see the first test).
		await Bun.sleep(500)
		run.child.kill("SIGTERM")
		expect(await run.finished()).toBe(0)
		expect(run.stderr()).not.toContain("is available")
		expect(run.stdout()).not.toContain("is available")
	}, TEST_TIMEOUT_MS)
})
