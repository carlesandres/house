/**
 * Local HTML preview server for a single markdown file.
 *
 * One long-lived `Bun.serve` instance. The served file path is swappable
 * via `setTarget(path)` — used by the TUI's `O` binding so pressing it on a
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
import { createMarkdownRenderer } from "../markdown-html/index.ts"
import { getPreviewAssets } from "./assets.ts"
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
	readonly render?: typeof renderHtml
}

type ReloadController = ReadableStreamDefaultController<Uint8Array>

const encoder = new TextEncoder()
const sseEvent = (event: string, data = ""): Uint8Array =>
	encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
const supersededHtml =
	'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
	"<title>Preview changed</title></head><body><p>Preview target changed.</p>" +
	'<p><a href="/">Reload</a></p></body></html>'

export const startServer = ({
	path,
	port = 0,
	render: renderDocument = renderHtml,
}: StartOptions): ServerHandle => {
	let target = path
	let revision = 0
	let watcherGeneration = 0
	let stopped = false
	let watcher: FSWatcher | null = null
	let watcherTimer: ReturnType<typeof setTimeout> | null = null
	const clients = new Set<ReloadController>()
	const renderer = createMarkdownRenderer()

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
	const startWatching = (p: string, generation = ++watcherGeneration) => {
		watcher?.close()
		watcher = null
		if (watcherTimer !== null) clearTimeout(watcherTimer)
		watcherTimer = null
		try {
			watcher = watch(p, () => {
				if (watcherTimer !== null) clearTimeout(watcherTimer)
				watcherTimer = setTimeout(() => {
					watcherTimer = null
					if (stopped || generation !== watcherGeneration) return
					broadcastReload()
					startWatching(p, generation)
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

	const securityHeaders = {
		"content-security-policy":
			"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' http: https:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
	}

	const server = Bun.serve({
		port,
		// Bind to loopback. Default is 0.0.0.0 (LAN-exposed); we render the
		// user's local files, so leaking them to the network would be a
		// surprise. URL strings are localhost-only by construction below.
		hostname: "127.0.0.1",
		async fetch(req, server) {
			const url = new URL(req.url)
			const host = req.headers.get("host")
			const validHosts = new Set([`localhost:${server.port}`, `127.0.0.1:${server.port}`])
			if (host === null || !validHosts.has(host)) {
				return new Response("forbidden", { status: 403, headers: securityHeaders })
			}
			const requestOrigin = `http://${host}`
			const origin = req.headers.get("origin")
			if (origin !== null && origin !== requestOrigin) {
				return new Response("forbidden", { status: 403, headers: securityHeaders })
			}
			if (req.method !== "GET" && req.method !== "HEAD") {
				return new Response("method not allowed", {
					status: 405,
					headers: { ...securityHeaders, allow: "GET, HEAD" },
				})
			}
			if (url.pathname === "/__reload") {
				if (req.method === "HEAD") {
					return new Response(null, { status: 405, headers: securityHeaders })
				}
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
						...securityHeaders,
						"content-type": "text/event-stream",
						"cache-control": "no-cache",
						connection: "keep-alive",
					},
				})
			}
			if (url.pathname.startsWith("/__house/assets/")) {
				try {
					const assets = await getPreviewAssets()
					const asset = assets.files.get(url.pathname)
					if (asset === undefined)
						return new Response("not found", { status: 404, headers: securityHeaders })
					const body = asset.body.slice().buffer as ArrayBuffer
					return new Response(req.method === "HEAD" ? null : body, {
						headers: {
							...securityHeaders,
							"content-type": asset.contentType,
							...(asset.contentEncoding === undefined
								? {}
								: { "content-encoding": asset.contentEncoding }),
							"cache-control": "public, max-age=31536000, immutable",
						},
					})
				} catch {
					return new Response("preview asset unavailable", {
						status: 500,
						headers: securityHeaders,
					})
				}
			}
			if (url.pathname !== "/") {
				return new Response("not found", { status: 404, headers: securityHeaders })
			}
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const snapshotTarget = target
				const snapshotRevision = revision
				try {
					const [md, assets] = await Promise.all([
						readFile(snapshotTarget, "utf8"),
						getPreviewAssets(),
					])
					const html = await renderDocument(md, basename(snapshotTarget), {
						clientAssetPath: assets.clientPath,
						mermaidAssetPath: assets.mermaidPath,
						origin: requestOrigin,
						renderer,
					})
					if (snapshotRevision !== revision) continue
					return new Response(req.method === "HEAD" ? null : html, {
						headers: {
							...securityHeaders,
							"content-type": "text/html; charset=utf-8",
							"cache-control": "no-store",
						},
					})
				} catch {
					if (snapshotRevision !== revision) continue
					return new Response("cannot render preview", {
						status: 500,
						headers: {
							...securityHeaders,
							"content-type": "text/plain; charset=utf-8",
						},
					})
				}
			}
			return new Response(supersededHtml, {
				status: 503,
				headers: {
					...securityHeaders,
					"content-type": "text/html; charset=utf-8",
					"retry-after": "1",
				},
			})
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
			revision += 1
			startWatching(next)
			broadcastReload()
		},
		stop: async () => {
			stopped = true
			watcherGeneration += 1
			if (watcherTimer !== null) clearTimeout(watcherTimer)
			watcherTimer = null
			watcher?.close()
			for (const c of clients) {
				try {
					c.close()
				} catch {
					// already closed
				}
			}
			clients.clear()
			await renderer.dispose()
			await server.stop(true)
		},
	}
}
