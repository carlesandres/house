#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const appRoot = resolve(import.meta.dir, "..")
const packagePath = resolve(appRoot, "package.json")
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

// Bump only the main package version. Platform optionalDependencies (and their
// lockfile resolutions) stay on last-published versions so monorepo
// `pnpm install --frozen-lockfile` works before those packages exist on npm.
// pnpm-lock.yaml does not record a workspace package's own version.
// createPublicPackageManifest pins published optionalDeps to this version.
pkg.version = nextVersion

await writeFile(packagePath, `${JSON.stringify(pkg, null, "\t")}\n`)
console.log(
	`set ${pkg.version} (main package; ` +
		`${platformPackages.length} platform optionalDependencies left unchanged for installability)`,
)
