#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { updatePlatformVersions } from "./set-version-lockfile.ts"

const appRoot = resolve(import.meta.dir, "..")
const repoRoot = resolve(appRoot, "../..")
const packagePath = resolve(appRoot, "package.json")
const lockfilePath = resolve(repoRoot, "bun.lock")
const platformPackagePrefix = "@carlesandres/house-"
const semverPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const fail = (message: string): never => {
	console.error(`set-version: ${message}`)
	process.exit(1)
}

const version = Bun.argv[2]
if (version === "--help" || version === "-h") {
	console.log("usage: bun run version:set <version>")
	process.exit(0)
}
if (Bun.argv.length !== 3) fail("usage: bun run version:set <version>")
const nextVersion = version ?? fail("usage: bun run version:set <version>")
if (!semverPattern.test(nextVersion)) {
	fail(`invalid semantic version ${JSON.stringify(nextVersion)}`)
}

const pkg = JSON.parse(await readFile(packagePath, "utf8")) as {
	version: string
	optionalDependencies?: Record<string, string>
}
const platformPackages = Object.keys(pkg.optionalDependencies ?? {}).filter((name) =>
	name.startsWith(platformPackagePrefix),
)
if (platformPackages.length === 0) fail("no platform optional dependencies found")

pkg.version = nextVersion
for (const name of platformPackages) pkg.optionalDependencies![name] = nextVersion

let lockfile = await readFile(lockfilePath, "utf8")
const workspaceVersionPattern = /("apps\/house": \{[\s\S]*?"version": )"[^"]+"/
if (!workspaceVersionPattern.test(lockfile)) fail("apps/house version is missing from bun.lock")
lockfile = lockfile.replace(workspaceVersionPattern, `$1"${nextVersion}"`)

try {
	lockfile = updatePlatformVersions(lockfile, platformPackages, nextVersion)
} catch (error) {
	fail(error instanceof Error ? error.message : String(error))
}

await writeFile(packagePath, `${JSON.stringify(pkg, null, "\t")}\n`)
await writeFile(lockfilePath, lockfile)
console.log(`set ${pkg.version} across the main and ${platformPackages.length} platform packages`)
