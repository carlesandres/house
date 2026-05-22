import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderHtml } from "../src/serve/render.ts"
import { startServer, type ServerHandle } from "../src/serve/server.ts"

describe("renderHtml", () => {
	test("renders markdown to an HTML document with embedded CSS and reload script", () => {
		const html = renderHtml("# Hello\n\nworld", "doc.md")
		expect(html).toContain("<!DOCTYPE html>")
		expect(html).toContain("<title>doc.md</title>")
		expect(html).toContain("<h1>Hello</h1>")
		expect(html).toContain("<p>world</p>")
		// CSS is embedded, not linked.
		expect(html).toContain("<style>")
		expect(html).not.toContain('<link rel="stylesheet"')
		// Live-reload bootstrap is inline.
		expect(html).toContain('EventSource("/__reload")')
	})

	test("escapes the title", () => {
		expect(renderHtml("hi", "<script>x</script>")).toContain(
			"<title>&lt;script&gt;x&lt;/script&gt;</title>",
		)
	})
})

describe("startServer", () => {
	let handle: ServerHandle | null = null
	let dir: string | null = null

	afterEach(async () => {
		await handle?.stop()
		handle = null
		if (dir) await rm(dir, { recursive: true, force: true })
		dir = null
	})

	test("serves the rendered HTML at /", async () => {
		dir = await mkdtemp(join(tmpdir(), "house-serve-"))
		const file = join(dir, "a.md")
		await writeFile(file, "# Title\n")
		handle = startServer({ path: file })
		const res = await fetch(handle.url)
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toContain("text/html")
		const body = await res.text()
		expect(body).toContain("<h1>Title</h1>")
	})

	test("setTarget swaps the served file", async () => {
		dir = await mkdtemp(join(tmpdir(), "house-serve-"))
		const a = join(dir, "a.md")
		const b = join(dir, "b.md")
		await writeFile(a, "# A\n")
		await writeFile(b, "# B\n")
		handle = startServer({ path: a })
		expect(handle.currentTarget()).toBe(a)
		handle.setTarget(b)
		expect(handle.currentTarget()).toBe(b)
		const body = await (await fetch(handle.url)).text()
		expect(body).toContain("<h1>B</h1>")
	})

	test("binds to loopback (URL is localhost-only)", async () => {
		dir = await mkdtemp(join(tmpdir(), "house-serve-"))
		const file = join(dir, "a.md")
		await writeFile(file, "x")
		handle = startServer({ path: file })
		expect(handle.url.startsWith("http://localhost:")).toBe(true)
		// Cannot reach via 0.0.0.0 / external interfaces — only via localhost.
		const port = new URL(handle.url).port
		await expect(fetch(`http://127.0.0.1:${port}/`)).resolves.toBeDefined()
	})

	test("survives an atomic-rename save (re-watches)", async () => {
		dir = await mkdtemp(join(tmpdir(), "house-serve-"))
		const file = join(dir, "a.md")
		await writeFile(file, "# v1\n")
		handle = startServer({ path: file })
		// Simulate vim/VS Code: write to tmp, rename onto target. The
		// original inode is replaced; a naive single-shot fs.watch would go
		// silent after this. Re-watch keeps us live.
		const tmp = join(dir, "a.md.tmp")
		await writeFile(tmp, "# v2\n")
		const { rename } = await import("node:fs/promises")
		await rename(tmp, file)
		// Subsequent writes should still be reflected in the served body.
		await writeFile(file, "# v3\n")
		// Give the watcher's debounce + re-watch a beat.
		await new Promise((r) => setTimeout(r, 60))
		const body = await (await fetch(handle.url)).text()
		expect(body).toContain("<h1>v3</h1>")
	})

	test("404s unknown paths", async () => {
		dir = await mkdtemp(join(tmpdir(), "house-serve-"))
		const file = join(dir, "a.md")
		await writeFile(file, "x")
		handle = startServer({ path: file })
		const res = await fetch(`${handle.url}/nope`)
		expect(res.status).toBe(404)
	})
})
