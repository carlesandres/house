#!/usr/bin/env bun

import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { basename, relative, resolve } from "node:path"
import pkg from "../package.json" with { type: "json" }
import { findReleaseTarget, releaseTargets, type ReleaseTarget } from "./release-targets.ts"

const root = resolve(import.meta.dir, "..")
const releaseDir = resolve(root, "dist/release")
const npmDir = resolve(root, "dist/npm/binaries")
const licensePath = resolve(root, "LICENSE")

const usage = `usage: bun run dev/build-npm-packages.ts [target-id]

target-id: ${releaseTargets.map((target) => target.id).join(", ")}

Omit target-id to package every release target. Each target must already have a
compiled binary at dist/release/<target-id>/house; build those with
bun run build:standalone <target-id> on the matching native runner.`

const fail = (message: string): never => {
	console.error(`build-npm-packages: ${message}`)
	process.exit(1)
}

const binaryPackageName = (target: ReleaseTarget): string => `${pkg.name}-${target.id}`

const targetsFromArg = (arg: string | undefined): readonly ReleaseTarget[] => {
	if (arg === undefined) return releaseTargets
	const target = findReleaseTarget(arg)
	if (target !== undefined) return [target]
	fail(`unknown target "${arg}"\n\n${usage}`)
	return []
}

const packageJsonFor = (target: ReleaseTarget): Record<string, unknown> => ({
	name: binaryPackageName(target),
	version: pkg.version,
	description: `Platform-specific binary for ${pkg.name} (${target.id})`,
	license: pkg.license,
	repository: pkg.repository,
	bugs: pkg.bugs,
	homepage: pkg.homepage,
	os: [target.os],
	cpu: [target.arch],
	...(target.libc === undefined ? {} : { libc: [target.libc] }),
	files: ["bin", "LICENSE"],
	bin: {
		house: `bin/${target.binaryName}`,
	},
	publishConfig: pkg.publishConfig,
})

const writePackage = async (target: ReleaseTarget): Promise<void> => {
	const sourceBinary = resolve(releaseDir, target.id, target.binaryName)
	if (!(await Bun.file(sourceBinary).exists())) {
		fail(
			`${target.id} binary is missing at ${relative(root, sourceBinary)}. ` +
				`Run bun run build:standalone ${target.id} on its native runner first.`,
		)
	}

	const packageDir = resolve(npmDir, target.id)
	const binDir = resolve(packageDir, "bin")
	const targetBinary = resolve(binDir, target.binaryName)

	await rm(packageDir, { force: true, recursive: true })
	await mkdir(binDir, { recursive: true })
	await copyFile(sourceBinary, targetBinary)
	await chmod(targetBinary, 0o755)
	await copyFile(licensePath, resolve(packageDir, basename(licensePath)))
	await writeFile(
		resolve(packageDir, "package.json"),
		`${JSON.stringify(packageJsonFor(target), null, "\t")}\n`,
	)

	console.log(`wrote ${relative(root, packageDir)} (${binaryPackageName(target)})`)
}

const arg = Bun.argv[2]
if (Bun.argv.length > 3 || arg === "--help" || arg === "-h") {
	console.log(usage)
	process.exit(arg === "--help" || arg === "-h" ? 0 : 1)
}

for (const target of targetsFromArg(arg)) await writePackage(target)
