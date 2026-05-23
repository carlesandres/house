/**
 * Local HTML preview server for a single markdown file.
 *
 * One long-lived `Bun.serve` instance. The served file path is swappable
 * via `setTarget(path)` — used by the TUI's `o` binding so pressing it on a
 * new file retargets the existing server (live-reload fires) instead of
 * spawning a second one.
 *
 * Live reload: an SSE endpoint at `/__reload` holds connections open and
 * pushes a `reload` event whenever the watched file changes. A new watcher
 * is created per `setTarget` call; the previous one is closed.
 */

import { basename } from "node:path"
import { watch, type FSWatcher } from "node:fs"
import { readFile } from "node:fs/promises"
import { renderHtml } from "./render.ts"

export interface ServerHandle {
	/** Base URL, e.g. http://localhost:51234 */
	readonly url: string
	/** Swap which file is served. Pushes a reload to connected clients. */
	setTarget(path: string): void
	/** Path currently being served. */
	currentTarget(): string
	stop(): Promise<void>
}

export interface StartOptions {
	readonly path: string
	/** 0 = OS-assigned. */
	readonly port?: number
}

type ReloadController = ReadableStreamDefaultController<Uint8Array>

const encoder = new TextEncoder()
const sseEvent = (event: string, data = ""): Uint8Array =>
	encoder.encode(`event: ${event}\ndata: ${data}\n\n`)

export const startServer = ({ path, port = 0 }: StartOptions): ServerHandle => {
	let target = path
	let watcher: FSWatcher | null = null
	const clients = new Set<ReloadController>()

	const broadcastReload = () => {
		for (const c of clients) {
			try {
				c.enqueue(sseEvent("reload"))
			} catch {
				clients.delete(c)
			}
		}
	}

	// `fs.watch` watches an inode, not a path. Editors that save via
	// write-tmp + rename (vim default, VS Code, JetBrains, …) replace the
	// inode, after which our watcher fires nothing. So we re-watch on every
	// event, and debounce because a single save often emits 2–3 events.
	const startWatching = (p: string) => {
		watcher?.close()
		watcher = null
		let timer: ReturnType<typeof setTimeout> | null = null
		try {
			watcher = watch(p, () => {
				if (timer) clearTimeout(timer)
				timer = setTimeout(() => {
					broadcastReload()
					startWatching(p)
				}, 30)
			})
			watcher.on("error", () => {
				// Stale handle after rename; the change event already scheduled
				// a re-watch. Swallow so it doesn't crash the process.
			})
		} catch {
			// Path went away between presses. Server still serves the last
			// good read; live reload stays off until the path returns.
		}
	}
	startWatching(target)

	const server = Bun.serve({
		port,
		// Bind to loopback. Default is 0.0.0.0 (LAN-exposed); we render the
		// user's local files, so leaking them to the network would be a
		// surprise. URL strings are localhost-only by construction below.
		hostname: "127.0.0.1",
		async fetch(req, server) {
			const url = new URL(req.url)
			if (url.pathname === "/__reload") {
				// SSE stream is silent between file changes; without this Bun
				// closes the request at the default 10s idleTimeout and warns.
				server.timeout(req, 0)
				// `cancel` receives a reason, not the controller — capture
				// the controller in `start` so we can remove it from the set
				// on disconnect. Without this, dead clients accumulate.
				let ctrl: ReloadController | null = null
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						ctrl = controller
						clients.add(controller)
						// Initial comment keeps some proxies from buffering.
						controller.enqueue(encoder.encode(": connected\n\n"))
					},
					cancel() {
						if (ctrl) clients.delete(ctrl)
					},
				})
				return new Response(stream, {
					headers: {
						"content-type": "text/event-stream",
						"cache-control": "no-cache",
						connection: "keep-alive",
					},
				})
			}
			if (url.pathname !== "/") {
				return new Response("not found", { status: 404 })
			}
			try {
				const md = await readFile(target, "utf8")
				const html = renderHtml(md, basename(target))
				return new Response(html, {
					headers: {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
					},
				})
			} catch (err) {
				return new Response(`cannot read ${target}: ${String(err)}`, {
					status: 500,
					headers: { "content-type": "text/plain; charset=utf-8" },
				})
			}
		},
	})

	const url = `http://localhost:${server.port}`

	return {
		url,
		currentTarget: () => target,
		setTarget: (next) => {
			if (next === target) {
				broadcastReload()
				return
			}
			target = next
			startWatching(next)
			broadcastReload()
		},
		stop: async () => {
			watcher?.close()
			for (const c of clients) {
				try {
					c.close()
				} catch {
					// already closed
				}
			}
			clients.clear()
			await server.stop(true)
		},
	}
}
