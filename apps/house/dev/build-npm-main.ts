import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import pkg from "../package.json" with { type: "json" }
import { createPublicPackageManifest } from "./public-package-manifest.ts"

const appRoot = resolve(import.meta.dir, "..")
const repoRoot = resolve(appRoot, "../..")
const output = resolve(appRoot, "dist/npm/main")

await rm(output, { force: true, recursive: true })
await mkdir(resolve(output, "dist"), { recursive: true })

const bundledApp = await readFile(resolve(appRoot, "dist/index.js"), "utf8")
const publicBundledApp = bundledApp.replace(
	/^\s*"@house\/[^"]+":\s*"workspace:[^"]+",?\r?\n/gm,
	"",
)
if (publicBundledApp === bundledApp) {
	throw new Error("Staged app bundle did not contain the expected private @house workspace entries")
}

await Promise.all([
	cp(resolve(appRoot, "dist/bin.js"), resolve(output, "dist/bin.js")),
	writeFile(resolve(output, "dist/index.js"), publicBundledApp),
	cp(resolve(repoRoot, "README.md"), resolve(output, "README.md")),
	cp(resolve(repoRoot, "LICENSE"), resolve(output, "LICENSE")),
	cp(resolve(repoRoot, "CHANGELOG.md"), resolve(output, "CHANGELOG.md")),
])

const publicPackageManifest = createPublicPackageManifest(pkg)
await writeFile(
	resolve(output, "package.json"),
	`${JSON.stringify(publicPackageManifest, null, "\t")}\n`,
)

console.log(`Staged ${pkg.name}@${pkg.version} in ${output}`)
