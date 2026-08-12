#!/usr/bin/env bun

import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, dirname, resolve } from "node:path"
import pkg from "../package.json" with { type: "json" }
import { hostReleaseTarget } from "./release-targets.ts"

const mode = Bun.argv[2]
if (mode !== "standalone" && mode !== "installed") {
	console.error("usage: bun run dev/smoke-file-navigator.ts standalone|installed")
	process.exit(2)
}

const appRoot = resolve(import.meta.dir, "..")
const target = hostReleaseTarget()
if (!target) throw new Error(`unsupported host ${process.platform}-${process.arch}`)

const run = (cmd: readonly string[]): void => {
	const result = Bun.spawnSync({ cmd: [...cmd], stderr: "inherit", stdout: "inherit" })
	if (!result.success) throw new Error(`command failed (${result.exitCode}): ${cmd.join(" ")}`)
}

const capture = (cmd: readonly string[]): string => {
	const result = Bun.spawnSync({ cmd: [...cmd], stderr: "inherit", stdout: "pipe" })
	if (!result.success) throw new Error(`command failed (${result.exitCode}): ${cmd.join(" ")}`)
	return new TextDecoder().decode(result.stdout).trim()
}

let installRoot: string | null = null
let binary = process.env.HOUSE_FILE_NAVIGATOR_SMOKE_BINARY
if (!binary && mode === "installed") {
	installRoot = await mkdtemp(resolve(tmpdir(), "house-file-navigator-installed-"))
	try {
		const prefix = resolve(installRoot, "prefix")
		const binaryTarball = capture([
			"npm",
			"pack",
			resolve(appRoot, "dist/npm/binaries", target.id),
			"--pack-destination",
			installRoot,
		])
		const mainTarball = capture([
			"npm",
			"pack",
			resolve(appRoot, "dist/npm/main"),
			"--pack-destination",
			installRoot,
		])
		run([
			"npm",
			"install",
			"-g",
			resolve(installRoot, binaryTarball),
			resolve(installRoot, mainTarball),
			"--omit=optional",
			"--prefix",
			prefix,
		])
		binary = resolve(prefix, "bin/house")
	} catch (error) {
		await rm(installRoot, { recursive: true, force: true })
		installRoot = null
		throw error
	}
}
binary ??= resolve(appRoot, "dist/release", target.id, "house")

try {
	await access(binary)
	const sanitizedPath = [
		dirname(binary),
		...(process.env.PATH ?? "")
			.split(delimiter)
			.filter(
				(entry) =>
					entry.length > 0 && entry !== dirname(process.execPath) && !entry.includes(".bun"),
			),
	].join(delimiter)
	const artifactEnv = { ...process.env, PATH: sanitizedPath }
	const version = Bun.spawnSync({
		cmd: [binary, "--version"],
		env: artifactEnv,
		stderr: "pipe",
		stdout: "pipe",
	})
	const versionStdout = new TextDecoder().decode(version.stdout).trim()
	const versionStderr = new TextDecoder().decode(version.stderr).trim()
	if (!version.success || versionStdout !== pkg.version || versionStderr !== "") {
		throw new Error(
			`file-navigator smoke: ${mode} startup failed: exit=${version.exitCode} ` +
				`stdout=${JSON.stringify(versionStdout)} stderr=${JSON.stringify(versionStderr)}`,
		)
	}

	const smoke = Bun.spawnSync({
		cmd: [binary],
		env: { ...artifactEnv, HOUSE_INTERNAL_FILE_NAVIGATOR_SMOKE: "1" },
		stderr: "pipe",
		stdout: "pipe",
	})
	const smokeStdout = new TextDecoder().decode(smoke.stdout)
	const smokeStderr = new TextDecoder().decode(smoke.stderr)
	if (smokeStdout) process.stdout.write(smokeStdout)
	if (smokeStderr) process.stderr.write(smokeStderr)
	if (!smoke.success || !smokeStdout.includes("file-navigator smoke: mutation coverage passed")) {
		throw new Error(`file-navigator smoke: ${mode} artifact failed: exit=${smoke.exitCode}`)
	}
} finally {
	if (installRoot) await rm(installRoot, { recursive: true, force: true })
}
