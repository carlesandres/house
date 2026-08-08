#!/usr/bin/env bun

import { mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { BunPlugin } from "bun"
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

/**
 * Virtual entry name embedded into the compiled binary. OpenTUI's
 * TreeSitterClient resolves the worker via the compile-time
 * `OTUI_TREE_SITTER_WORKER_PATH` define (see OpenCode's build.ts and
 * opentui#807). Without this, `bun build --compile` silently loses
 * markdown/code highlighting after install.
 */
const TREE_SITTER_WORKER_VIRTUAL = "opentui-tree-sitter-worker.js"

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

/**
 * Locate OpenTUI's parser worker source text.
 *
 * Prefer the package export (`@opentui/core/parser.worker`). On @opentui/core
 * 0.2.15 that export points at a missing `lib/tree-sitter/parser.worker.js`,
 * so fall back to `parser.worker.js` next to the package root (the file that
 * actually ships). OpenCode does the same embedding against a newer OpenTUI
 * where the export resolves cleanly.
 */
const resolveTreeSitterWorkerSource = async (): Promise<string> => {
	const candidates: string[] = []

	try {
		candidates.push(fileURLToPath(import.meta.resolve("@opentui/core/parser.worker")))
	} catch {
		// export map may not resolve on this OpenTUI version
	}

	try {
		const coreMain = require.resolve("@opentui/core", {
			paths: [root, resolve(repoRoot, "node_modules/.bun/node_modules")],
		})
		candidates.push(resolve(dirname(coreMain), "parser.worker.js"))
		candidates.push(resolve(dirname(coreMain), "lib/tree-sitter/parser.worker.js"))
	} catch {
		// core not installed
	}

	for (const path of candidates) {
		const file = Bun.file(path)
		if (!(await file.exists())) continue
		const source = await file.text()
		if (source.trim().length === 0) continue
		console.log(`tree-sitter worker: ${relative(repoRoot, path)}`)
		return source
	}

	return fail(
		"could not locate @opentui/core parser.worker.js. " +
			"Install dependencies before building standalone binaries.",
	)
}

/** Bun's embedded-fs root for compiled executables. Unix only for now (house ships no win32 targets). */
const bunfsWorkerPath = (virtualName: string): string => `/$bunfs/root/${virtualName}`

const resolveWebTreeSitterDependency = (specifier: string): string => {
	const coreMain = require.resolve("@opentui/core", {
		paths: [root, resolve(repoRoot, "node_modules/.bun/node_modules")],
	})
	return require.resolve(specifier, { paths: [dirname(coreMain)] })
}

const treeSitterDependencyResolver: BunPlugin = {
	name: "resolve-opentui-tree-sitter-dependencies",
	setup(build) {
		build.onResolve({ filter: /^web-tree-sitter(?:\/tree-sitter\.wasm)?$/ }, ({ path }) => ({
			path: resolveWebTreeSitterDependency(path),
		}))
	},
}

const buildTarget = async (
	target: ReleaseTarget,
	treeSitterWorker: string,
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
		// OpenCode-style packaging: embed OpenTUI's parser worker into the binary and
		// point TreeSitterClient at it via OTUI_TREE_SITTER_WORKER_PATH. Plain
		// `bun build --compile <entry>` does not bundle Worker entrypoints (opentui#807).
		// Cast: Bun's public BuildConfig types lag the compile/bytecode option surface.
		const result = await Bun.build({
			entrypoints: [generatedEntrypoint, TREE_SITTER_WORKER_VIRTUAL],
			format: "esm",
			// Keep production defaults that `--compile` implies on the CLI.
			minify: true,
			// Bytecode cache: same intent as the previous `--bytecode` CLI flag.
			bytecode: true,
			files: {
				[TREE_SITTER_WORKER_VIRTUAL]: treeSitterWorker,
			},
			plugins: [treeSitterDependencyResolver],
			define: {
				// Inserted as source; must be a quoted string literal.
				OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(
					bunfsWorkerPath(TREE_SITTER_WORKER_VIRTUAL),
				),
			},
			compile: {
				target: target.bunTarget,
				outfile,
				// Match prior CLI defaults: no runtime bunfig/dotenv autoload surprises.
				autoloadBunfig: false,
				autoloadDotenv: false,
			},
		} as any)

		if (!result.success) {
			for (const log of result.logs) console.error(log)
			fail(`bundle/compile failed for ${target.id}`)
		}
	} finally {
		await rm(tempDir, { force: true, recursive: true })
	}

	const host = hostReleaseTarget()
	if (host?.id === target.id) {
		console.log(`smoke ${relative(root, outfile)} --version`)
		const smoke = Bun.spawnSync({ cmd: [outfile, "--version"], stderr: "pipe", stdout: "pipe" })
		const stdout = new TextDecoder().decode(smoke.stdout).trim()
		const stderr = new TextDecoder().decode(smoke.stderr).trim()
		if (!smoke.success || stdout !== pkg.version) {
			fail(
				`smoke failed for ${target.id}: exit=${smoke.exitCode} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
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

const treeSitterWorker = await resolveTreeSitterWorkerSource()
console.log(`embedded ${TREE_SITTER_WORKER_VIRTUAL} (${treeSitterWorker.length} bytes)`)

const outputs = []
for (const target of targetsFromArg(arg)) outputs.push(await buildTarget(target, treeSitterWorker))

const checksums = outputs
	.map(({ archive, hash }) => `${hash}  ${basename(archive)}`)
	.sort()
	.join("\n")
await writeFile(resolve(releaseDir, "checksums.txt"), `${checksums}\n`)

console.log(`wrote ${relative(root, resolve(releaseDir, "checksums.txt"))}`)
