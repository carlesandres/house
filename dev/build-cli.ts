#!/usr/bin/env bun

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import pkg from "../package.json" with { type: "json" }

const root = resolve(import.meta.dir, "..")
const distDir = resolve(root, "dist")
const appEntry = resolve(root, "src/index.tsx")
const binSource = resolve(root, "src/cli/npm-bin.js")
const appOutfile = resolve(distDir, "index.js")
const binOutfile = resolve(distDir, "bin.js")

const runtimeExternals = [
	"@effect/atom-react",
	"@opentui/core",
	"@opentui/react",
	"commander",
	"effect",
	"ignore",
	"marked",
	"react",
	"scheduler",
	"string-width",
]

const usage = `usage: bun run dev/build-cli.ts`

const fail = (message: string): never => {
	console.error(`build-cli: ${message}`)
	process.exit(1)
}

const buildApp = async (): Promise<void> => {
	const result = await Bun.build({
		entrypoints: [appEntry],
		external: runtimeExternals,
		format: "esm",
		outdir: distDir,
		target: "bun",
	} as any)

	if (!result.success) {
		for (const log of result.logs) console.error(log)
		fail(`bundle failed for ${pkg.name}`)
	}

	await chmod(appOutfile, 0o755)
	console.log(`wrote dist/index.js (${pkg.name})`)
}

const buildBinShim = async (): Promise<void> => {
	const source = await readFile(binSource, "utf8")
	const distSource = source.replaceAll("../../package.json", "../package.json")
	await writeFile(binOutfile, distSource)
	await chmod(binOutfile, 0o755)
	console.log("wrote dist/bin.js")
}

if (Bun.argv[2] === "--help" || Bun.argv[2] === "-h") {
	console.log(usage)
	process.exit(0)
}

if (Bun.argv.length > 3) fail(usage)

await rm(distDir, { force: true, recursive: true })
await mkdir(distDir, { recursive: true })
await buildApp()
await buildBinShim()
