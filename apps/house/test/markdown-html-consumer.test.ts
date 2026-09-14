import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

test("renderer runs as a standalone Node consumer outside House", async () => {
	const directory = await mkdtemp(join(tmpdir(), "house-markdown-consumer-"))
	try {
		const bundle = join(directory, "markdown-html.mjs")
		const consumer = join(directory, "consumer.mjs")
		const build = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "../src/markdown-html/index.ts")],
			outfile: bundle,
			format: "esm",
			target: "node",
		} as any)
		expect(build.success).toBe(true)
		await Bun.write(bundle, build.outputs[0]!)
		const source = await readFile(bundle, "utf8")
		expect(source).not.toContain("src/serve/")
		expect(source).not.toContain("Bun.")
		const markdown =
			"# One\n# One\n\n```ts\nconst n: number = 1\n```\n\n```mermaid\nflowchart LR\nA-->B\n```"
		await writeFile(
			consumer,
			`import { createMarkdownRenderer } from "./markdown-html.mjs"
const renderer = createMarkdownRenderer()
const result = await renderer.render(${JSON.stringify(markdown)})
console.log(JSON.stringify({ headings: result.headings, highlighted: result.html.includes("shiki"), mermaid: result.hasMermaid }))
await renderer.dispose()
`,
		)
		const process = Bun.spawn(["node", consumer], {
			cwd: directory,
			stdout: "pipe",
			stderr: "pipe",
		})
		const [exitCode, stdout, stderr] = await Promise.all([
			process.exited,
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
		])
		expect(stderr).toBe("")
		expect(exitCode).toBe(0)
		expect(JSON.parse(stdout)).toEqual({
			headings: [
				{ id: "one", level: 1, text: "One" },
				{ id: "one-1", level: 1, text: "One" },
			],
			highlighted: true,
			mermaid: true,
		})
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})
