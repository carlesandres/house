#!/usr/bin/env bun

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const distDir = resolve(root, "dist")
const binSource = resolve(root, "src/cli/npm-bin.js")
const binOutfile = resolve(distDir, "bin.js")

const usage = `usage: bun run dev/build-cli.ts`

const fail = (message: string): never => {
	console.error(`build-cli: ${message}`)
	process.exit(1)
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

// Only replace CLI outputs — leave dist/release and dist/npm alone so local
// standalone / npm-package builds survive.
await mkdir(distDir, { recursive: true })
await rm(binOutfile, { force: true })
await buildBinShim()
