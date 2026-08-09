#!/usr/bin/env bun

import { access, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { delimiter, dirname, resolve } from "node:path"
import pkg from "../package.json" with { type: "json" }
import { hostReleaseTarget } from "./release-targets.ts"

const mode = Bun.argv[2]
if (mode !== "standalone" && mode !== "installed") {
	console.error("usage: bun run dev/smoke-file-navigator.ts standalone|installed")
	process.exit(2)
}

const appRoot = resolve(import.meta.dir, "..")
const repoRoot = resolve(appRoot, "../..")
const target = hostReleaseTarget()
if (!target) throw new Error(`unsupported host ${process.platform}-${process.arch}`)
const require = createRequire(import.meta.url)
const nativeRoot = resolve(repoRoot, "node_modules/.bun/node_modules")
try {
	require.resolve(target.parcelNativePackage, { paths: [nativeRoot] })
} catch {
	throw new Error(`missing ${target.parcelNativePackage}; install the host dependencies first`)
}

const binary =
	process.env.HOUSE_FILE_NAVIGATOR_SMOKE_BINARY ??
	(mode === "standalone"
		? resolve(appRoot, "dist/release", target.id, "house")
		: resolve(appRoot, "dist/npm/main/dist/bin.js"))
try {
	await access(binary)
} catch {
	console.error(`file-navigator smoke: missing ${binary}; build the requested artifact first`)
	process.exit(1)
}

const sanitizedPath = [
	dirname(binary),
	...(process.env.PATH ?? "")
		.split(delimiter)
		.filter((entry) => entry.length > 0 && entry !== dirname(process.execPath) && !entry.includes(".bun")),
].join(delimiter)
const smokeEnv = { ...process.env, PATH: sanitizedPath }
const version = Bun.spawnSync({
	cmd: [binary, "--version"],
	env: smokeEnv,
	stderr: "pipe",
	stdout: "pipe",
})
const stdout = new TextDecoder().decode(version.stdout).trim()
const stderr = new TextDecoder().decode(version.stderr).trim()
if (!version.success || stdout !== pkg.version || stderr !== "") {
	throw new Error(
		`file-navigator smoke: ${mode} startup failed: exit=${version.exitCode} ` +
			`stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
	)
}

const smokeRoot = resolve(appRoot, "dist", `.file-navigator-smoke-${mode}`)
const entrypoint = resolve(smokeRoot, "entry.ts")
const host = resolve(smokeRoot, "host")
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(resolve(smokeRoot, "node_modules/@parcel"), { recursive: true })
await symlink(
	resolve(repoRoot, "node_modules/.bun/node_modules/@parcel/watcher"),
	resolve(smokeRoot, "node_modules/@parcel/watcher"),
)
await symlink(
	resolve(nativeRoot, target.parcelNativePackage),
	resolve(smokeRoot, "node_modules", target.parcelNativePackage),
)
await writeFile(
	entrypoint,
	`import binding from ${JSON.stringify(target.parcelNativePackage)}\n` +
		`import { createWrapper } from "@parcel/watcher/wrapper"\n` +
		`import { runFileNavigatorSmoke } from ${JSON.stringify(resolve(repoRoot, "packages/ui/dev/smoke-file-navigator.tsx"))}\n` +
		`const wrapper = createWrapper(binding)\n` +
		`globalThis.__house_file_navigator_watcher_factory__ = () => ({ subscribe: (directory, callback) => wrapper.subscribe(directory, callback) })\n` +
		`await runFileNavigatorSmoke()\n` +
		`process.exit(0)\n`,
)

try {
	const build = Bun.spawnSync({
		cmd: [
			process.execPath,
			"build",
			"--compile",
			"--bytecode",
			"--format=esm",
			`--target=${target.bunTarget}`,
			`--outfile=${host}`,
			entrypoint,
		],
		cwd: smokeRoot,
		stderr: "inherit",
		stdout: "inherit",
	})
	if (!build.success) throw new Error(`file-navigator smoke host build failed: ${build.exitCode}`)
	const result = Bun.spawnSync({
		cmd: [host],
		cwd: mode === "installed" ? resolve(appRoot, "dist/npm/main") : smokeRoot,
		env: smokeEnv,
		stderr: "inherit",
		stdout: "inherit",
	})
	if (!result.success) throw new Error(`file-navigator smoke failed: ${result.exitCode}`)
} finally {
	await rm(smokeRoot, { recursive: true, force: true })
}
