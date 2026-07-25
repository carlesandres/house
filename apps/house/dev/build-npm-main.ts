import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import pkg from "../package.json" with { type: "json" }

const appRoot = resolve(import.meta.dir, "..")
const repoRoot = resolve(appRoot, "../..")
const output = resolve(appRoot, "dist/npm/main")

await rm(output, { force: true, recursive: true })
await mkdir(resolve(output, "dist"), { recursive: true })

await Promise.all([
	cp(resolve(appRoot, "dist/bin.js"), resolve(output, "dist/bin.js")),
	cp(resolve(appRoot, "dist/index.js"), resolve(output, "dist/index.js")),
	cp(resolve(repoRoot, "README.md"), resolve(output, "README.md")),
	cp(resolve(repoRoot, "LICENSE"), resolve(output, "LICENSE")),
	cp(resolve(repoRoot, "CHANGELOG.md"), resolve(output, "CHANGELOG.md")),
])

await writeFile(resolve(output, "package.json"), `${JSON.stringify(pkg, null, "\t")}\n`)

console.log(`Staged ${pkg.name}@${pkg.version} in ${output}`)
