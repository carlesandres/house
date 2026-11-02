import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import pkg from "../package.json" with { type: "json" }
import { createPublicPackageManifest } from "./public-package-manifest.ts"

const appRoot = resolve(import.meta.dir, "..")
const repoRoot = resolve(appRoot, "../..")
const output = resolve(appRoot, "dist/npm/main")

await rm(output, { force: true, recursive: true })
await mkdir(resolve(output, "dist"), { recursive: true })

await Promise.all([
	cp(resolve(appRoot, "dist/bin.js"), resolve(output, "dist/bin.js")),
	cp(resolve(repoRoot, "README.md"), resolve(output, "README.md")),
	cp(resolve(repoRoot, "LICENSE"), resolve(output, "LICENSE")),
	cp(resolve(appRoot, "CHANGELOG.md"), resolve(output, "CHANGELOG.md")),
])

const publicPackageManifest = createPublicPackageManifest(pkg)
await writeFile(
	resolve(output, "package.json"),
	`${JSON.stringify(publicPackageManifest, null, "\t")}\n`,
)

console.log(`Staged ${pkg.name}@${pkg.version} in ${output}`)
