#!/usr/bin/env bun

/// <reference lib="dom" />

import { access, chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { chromium, type Browser } from "playwright"
import { hostReleaseTarget } from "./release-targets.ts"

const mode = Bun.argv[2]
if (mode !== "standalone" && mode !== "installed") {
	console.error("usage: bun run dev/smoke-preview-artifact.ts standalone|installed")
	process.exit(2)
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

const appRoot = resolve(import.meta.dir, "..")
const target = hostReleaseTarget()
if (target === undefined) throw new Error(`unsupported host ${process.platform}-${process.arch}`)

const directory = await mkdtemp(join(tmpdir(), "house-preview-artifact-"))
const run = (command: readonly string[]): void => {
	const result = Bun.spawnSync({ cmd: [...command], stderr: "inherit", stdout: "inherit" })
	if (!result.success) throw new Error(`command failed (${result.exitCode}): ${command.join(" ")}`)
}
const capture = (command: readonly string[]): string => {
	const result = Bun.spawnSync({ cmd: [...command], stderr: "inherit", stdout: "pipe" })
	if (!result.success) throw new Error(`command failed (${result.exitCode}): ${command.join(" ")}`)
	return new TextDecoder().decode(result.stdout).trim()
}

const terminate = async (child: Bun.Subprocess): Promise<void> => {
	if (mode === "installed") {
		const descendants = Bun.spawnSync({
			cmd: ["pgrep", "-P", String(child.pid)],
			stderr: "ignore",
			stdout: "pipe",
		})
		for (const pid of new TextDecoder().decode(descendants.stdout).trim().split("\n")) {
			if (pid.length === 0) continue
			try {
				process.kill(Number(pid), "SIGTERM")
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
			}
		}
	}

	child.kill("SIGTERM")
	const exited = await Promise.race([
		child.exited.then(() => true),
		new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
	])
	if (!exited) {
		child.kill("SIGKILL")
		await child.exited
	}
}

let binary = process.env.HOUSE_PREVIEW_SMOKE_BINARY
if (binary === undefined && mode === "installed") {
	const prefix = resolve(directory, "prefix")
	const binaryTarball = capture([
		"npm",
		"pack",
		resolve(appRoot, "dist/npm/binaries", target.id),
		"--pack-destination",
		directory,
	])
	const mainTarball = capture([
		"npm",
		"pack",
		resolve(appRoot, "dist/npm/main"),
		"--pack-destination",
		directory,
	])
	run([
		"npm",
		"install",
		"-g",
		resolve(directory, binaryTarball),
		resolve(directory, mainTarball),
		"--omit=optional",
		"--prefix",
		prefix,
	])
	binary = resolve(prefix, "bin/house")
}
binary ??= resolve(appRoot, "dist/release", target.id, "house")
await access(binary)

const markdownPath = join(directory, "preview.md")
const launcherDirectory = join(directory, "bin")
await mkdir(launcherDirectory)
await Bun.write(
	markdownPath,
	"# Artifact preview\n\n## Code\n\n```ts\nconst shipped: boolean = true\n```\n\n## Diagram\n\n```mermaid\nflowchart LR\nA[Binary]-->B[Browser]\n```\n",
)
await Bun.write(
	join(launcherDirectory, process.platform === "darwin" ? "open" : "xdg-open"),
	"#!/bin/sh\nexit 0\n",
)
await chmod(join(launcherDirectory, process.platform === "darwin" ? "open" : "xdg-open"), 0o755)

const sanitizedPath = [
	launcherDirectory,
	dirname(binary),
	...(process.env.PATH ?? "")
		.split(delimiter)
		.filter(
			(entry) => entry.length > 0 && entry !== dirname(process.execPath) && !entry.includes(".bun"),
		),
].join(delimiter)

const child = Bun.spawn([binary, "--serve", markdownPath, "--port", "0", "--no-update-check"], {
	env: { ...process.env, PATH: sanitizedPath },
	stderr: "pipe",
	stdout: "pipe",
})

const readUrl = async (): Promise<string> => {
	const reader = child.stdout.getReader()
	const decoder = new TextDecoder()
	let output = ""
	for (;;) {
		const next = await reader.read()
		if (next.done) throw new Error(`artifact exited before serving: ${output}`)
		output += decoder.decode(next.value, { stream: true })
		const match = output.match(/http:\/\/localhost:\d+/)
		if (match !== null) return match[0]
	}
}

let browser: Browser | null = null
try {
	const url = await Promise.race([
		readUrl(),
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("artifact startup timed out")), 10_000),
		),
	])
	const response = await fetch(url)
	assert(response.status === 200, `${mode} artifact preview did not return 200`)
	const html = await response.text()
	assert(html.includes('class="shiki'), `${mode} artifact did not render highlighted HTML`)
	const entryAssets = [...html.matchAll(/(?:src|content)="(\/__house\/assets\/[^"]+)"/g)].map(
		(match) => match[1]!,
	)
	assert(entryAssets.length >= 2, `${mode} artifact did not advertise both browser entries`)
	for (const path of entryAssets) {
		const asset = await fetch(`${url}${path}`)
		assert(asset.status === 200, `${mode} artifact asset ${path} did not return 200`)
		assert(
			asset.headers.get("content-type")?.includes("javascript"),
			`${path} has the wrong MIME type`,
		)
	}

	if (mode === "standalone") {
		try {
			browser = await chromium.launch({ headless: true })
		} catch (error) {
			if (process.platform !== "darwin") throw error
			browser = await chromium.launch({ channel: "chrome", headless: true })
		}
		const page = await browser.newPage()
		await page.goto(url)
		await page.waitForSelector(".markdown-html-mermaid-diagram svg", { timeout: 15_000 })
		assert(
			(await page.locator(".markdown-html-mermaid-diagram svg").count()) === 1,
			"artifact Mermaid did not render",
		)
	}

	console.log(`preview artifact smoke passed (${mode})`)
} finally {
	await browser?.close()
	await terminate(child)
	const stderr = await new Response(child.stderr).text()
	if (stderr.trim().length > 0) console.error(stderr.trim())
	await rm(directory, { force: true, recursive: true })
}
