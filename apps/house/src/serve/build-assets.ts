import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

export interface PreviewAsset {
	readonly path: string
	readonly body: Uint8Array
	readonly contentType: string
	readonly contentEncoding?: "gzip"
}

export interface PreviewAssets {
	readonly clientPath: string
	readonly mermaidPath: string
	readonly files: ReadonlyMap<string, PreviewAsset>
}

export interface SerializedPreviewAssets {
	readonly clientPath: string
	readonly mermaidPath: string
	readonly files: Readonly<Record<string, { readonly body: string; readonly gzip: boolean }>>
}

const buildEntry = async (
	entrypoint: string,
	minify: boolean,
	splitting: boolean,
): Promise<{ readonly entryPath: string; readonly assets: readonly PreviewAsset[] }> => {
	const outputDirectory = await mkdtemp(join(tmpdir(), "house-preview-assets-"))
	try {
		const result = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
			format: "esm",
			minify,
			splitting,
			outdir: outputDirectory,
			naming: "[name]-[hash].[ext]",
		})
		if (!result.success || result.outputs.length === 0) {
			const details = result.logs.map(String).join("\n")
			throw new Error(`Could not build browser preview asset${details ? `:\n${details}` : ""}`)
		}
		const assets = await Promise.all(
			result.outputs.map(async (output) => {
				const path = `/__house/assets/${basename(output.path)}`
				const source = new Uint8Array(await output.arrayBuffer())
				const compressed = Bun.gzipSync(source, { level: 9 })
				return {
					path,
					body: compressed,
					contentType: "text/javascript; charset=utf-8",
					contentEncoding: "gzip" as const,
				}
			}),
		)
		const entry = result.outputs.find((output) => output.kind === "entry-point")
		if (entry === undefined) throw new Error("Browser preview build did not emit an entry point")
		return { entryPath: `/__house/assets/${basename(entry.path)}`, assets }
	} finally {
		await rm(outputDirectory, { force: true, recursive: true })
	}
}

export const buildPreviewAssets = async (
	options: { readonly minify?: boolean } = {},
): Promise<PreviewAssets> => {
	const root = resolve(import.meta.dir, "..")
	const [client, mermaid] = await Promise.all([
		buildEntry(resolve(root, "serve/client.ts"), options.minify ?? false, false),
		buildEntry(resolve(root, "markdown-html/browser.ts"), options.minify ?? false, true),
	])
	const files = new Map([...client.assets, ...mermaid.assets].map((asset) => [asset.path, asset]))
	return {
		clientPath: client.entryPath,
		mermaidPath: mermaid.entryPath,
		files,
	}
}

export const serializePreviewAssets = (assets: PreviewAssets): SerializedPreviewAssets => ({
	clientPath: assets.clientPath,
	mermaidPath: assets.mermaidPath,
	files: Object.fromEntries(
		[...assets.files].map(([path, asset]) => [
			path,
			{ body: Buffer.from(asset.body).toString("base64"), gzip: asset.contentEncoding === "gzip" },
		]),
	),
})
