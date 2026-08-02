#!/usr/bin/env bun

import { mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, relative, resolve } from "node:path"
import pkg from "../package.json" with { type: "json" }
import {
	findReleaseTarget,
	hostReleaseTarget,
	releaseTargets,
	type ReleaseTarget,
} from "./release-targets.ts"
import { generateStandaloneHost } from "./standalone-host.ts"

const root = resolve(import.meta.dir, "..")
const repoRoot = resolve(root, "../..")
const releaseDir = resolve(root, "dist/release")
const require = createRequire(import.meta.url)

const usage = `usage: bun run dev/build-standalone.ts [target-id]

target-id: ${releaseTargets.map((target) => target.id).join(", ")}

Omit target-id to build the host target. Each target requires its matching
@opentui/core and Parcel native packages to be installed.`

const fail = (message: string): never => {
	console.error(`build-standalone: ${message}`)
	process.exit(1)
}

const run = (cmd: readonly string[], options: { readonly cwd?: string } = {}): void => {
	const result = Bun.spawnSync({
		cmd: [...cmd],
		cwd: options.cwd ?? root,
		stderr: "inherit",
		stdout: "inherit",
	})
	if (!result.success) fail(`command failed (${result.exitCode}): ${cmd.join(" ")}`)
}

const targetsFromArg = (arg: string | undefined): readonly ReleaseTarget[] => {
	if (arg === undefined) {
		const host = hostReleaseTarget()
		if (host !== undefined) return [host]
		fail(`unsupported host ${process.platform}-${process.arch}`)
		return []
	}
	const target = findReleaseTarget(arg)
	if (target !== undefined) return [target]
	fail(`unknown target "${arg}"\n\n${usage}`)
	return []
}

const sha256 = async (path: string): Promise<string> => {
	const bytes = await Bun.file(path).arrayBuffer()
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
}

const assertNativePackagePresent = (target: ReleaseTarget): void => {
	try {
		require.resolve(target.opentuiNativePackage, {
			paths: [resolve(repoRoot, "node_modules/.bun/node_modules")],
		})
	} catch {
		fail(
			`${target.id} requires ${target.opentuiNativePackage}, but it is not installed. ` +
				"Build this target on its native GitHub Actions runner.",
		)
	}
	try {
		require.resolve(target.parcelNativePackage, {
			paths: [resolve(repoRoot, "node_modules/.bun/node_modules")],
		})
	} catch {
		fail(
			`${target.id} requires ${target.parcelNativePackage}, but it is not installed. ` +
				"Build this target on its native GitHub Actions runner.",
		)
	}
}

const buildTarget = async (
	target: ReleaseTarget,
): Promise<{ readonly archive: string; readonly hash: string }> => {
	assertNativePackagePresent(target)

	const targetDir = resolve(releaseDir, target.id)
	const outfile = resolve(targetDir, target.binaryName)
	const archive = resolve(releaseDir, `house-${target.id}.tar.gz`)
	const tempDir = resolve(releaseDir, `.host-${target.id}`)
	const generatedEntrypoint = resolve(tempDir, "standalone-host.ts")

	await rm(targetDir, { force: true, recursive: true })
	await rm(archive, { force: true })
	await rm(tempDir, { force: true, recursive: true })
	await mkdir(targetDir, { recursive: true })
	await mkdir(tempDir, { recursive: true })
	await mkdir(resolve(tempDir, "node_modules/@parcel"), { recursive: true })
	await symlink(
		resolve(repoRoot, "node_modules/.bun/node_modules/@parcel/watcher"),
		resolve(tempDir, "node_modules/@parcel/watcher"),
	)
	await symlink(
		resolve(repoRoot, "node_modules/.bun/node_modules", target.parcelNativePackage),
		resolve(tempDir, "node_modules", target.parcelNativePackage),
	)
	await writeFile(generatedEntrypoint, generateStandaloneHost(target))

	console.log(`building ${target.id}`)
	try {
		run([
			"bun",
			"build",
			"--compile",
			"--bytecode",
			"--format=esm",
			`--target=${target.bunTarget}`,
			`--outfile=${outfile}`,
			generatedEntrypoint,
		])
	} finally {
		await rm(tempDir, { force: true, recursive: true })
	}

	const host = hostReleaseTarget()
	if (host?.id === target.id) {
		console.log(`smoke ${relative(root, outfile)} --version`)
		const result = Bun.spawnSync({ cmd: [outfile, "--version"], stderr: "pipe", stdout: "pipe" })
		const stdout = new TextDecoder().decode(result.stdout).trim()
		const stderr = new TextDecoder().decode(result.stderr).trim()
		if (!result.success || stdout !== pkg.version) {
			fail(
				`smoke failed for ${target.id}: exit=${result.exitCode} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
			)
		}
	}

	run(["tar", "-czf", archive, target.binaryName], { cwd: targetDir })
	return { archive, hash: await sha256(archive) }
}

const arg = Bun.argv[2]
if (Bun.argv.length > 3 || arg === "--help" || arg === "-h") {
	console.log(usage)
	process.exit(arg === "--help" || arg === "-h" ? 0 : 1)
}

await mkdir(releaseDir, { recursive: true })

const outputs = []
for (const target of targetsFromArg(arg)) outputs.push(await buildTarget(target))

const checksums = outputs
	.map(({ archive, hash }) => `${hash}  ${basename(archive)}`)
	.sort()
	.join("\n")
await writeFile(resolve(releaseDir, "checksums.txt"), `${checksums}\n`)

console.log(`wrote ${relative(root, resolve(releaseDir, "checksums.txt"))}`)
