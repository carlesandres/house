#!/usr/bin/env bun

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { tmpdir } from "node:os"
import {
	runParcelBenchmark,
	runParcelCorrectness,
	runParcelStartCloseChild,
	runParcelStandaloneChild,
} from "./parcel-harness.ts"
import type { ParcelBenchmarkOptions, ParcelBenchmarkReport } from "./parcel-harness.ts"
import { recordParcelEvidence, validateParcelEvidence } from "./parcel-evidence.ts"

const usage = `Usage: bun packages/ui/dev/parcel-feasibility.ts <command> [options]

Commands:
  correctness       Run real-filesystem scanner/invalidation correctness scenarios
  repeat            Repeat correctness to expose native handoff races
  benchmark-cell    Run one benchmark cell in the current process
  benchmark-matrix  Run isolated 1k/5k/10k broad/deep cells with hard timeouts
  standalone-smoke  Compile and run dynamic and generated host-static isolated binaries
  verify-evidence   Validate the compact empirical evidence block
  help              Show this help

Options:
  --record               Atomically record compact success or failure evidence
  --runs <n>             Repeat/cell runs (repeat default: 3; cell default: 1)
  --files <n>            Cell files (default: 1000)
  --dirs <n>             Cell directories (default: max(120, files / 10))
  --mutations <n>        Cell mixed mutations (default: 20)
  --shape broad|deep     Cell shape (default: broad)
  --cell-timeout-ms <n>  Matrix child timeout (default: 900000)
  -h, --help             Show this help

The matrix runs 1k/5k/10k broad and deep in separate processes. Exploratory cells use one
trial/20 mutations; the required 10k broad cell uses three trials/100 mutations.`

interface ProcessOutcome {
	readonly success: boolean
	readonly exitCode: number
	readonly signal: NodeJS.Signals | null
	readonly timedOut: boolean
	readonly stdout: string
	readonly stderr: string
}

interface StandaloneVariantResult {
	readonly success: boolean
	readonly build: ProcessOutcome
	readonly run: ProcessOutcome | null
	readonly binaryBytes: number | null
	readonly binaryContainsWatcherNode: boolean
	readonly persistentExtractedNodeFiles: readonly string[]
	readonly nativeLoaderLines: readonly string[]
	readonly workspaceNodeModulesDenied: true
	readonly addonDisposition: string
}

interface StandaloneReport {
	readonly command: "standalone-smoke"
	readonly compileFlags: readonly string[]
	readonly isolatedDirectory: true
	readonly dynamic: StandaloneVariantResult
	readonly static: StandaloneVariantResult | null
	readonly staticPackage: string
}

const fail = (message: string): never => {
	throw new Error(message)
}

const positiveInteger = (value: string | undefined, option: string): number => {
	if (value === undefined || !/^\d+$/.test(value)) fail(`${option} requires a positive integer`)
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${option} requires a positive integer`)
	return parsed
}

const printJson = (value: unknown): void => {
	console.log(JSON.stringify(value, null, 2))
}

const withRecord = (
	args: readonly string[],
): { readonly args: readonly string[]; readonly record: boolean } => ({
	args: args.filter((argument) => argument !== "--record"),
	record: args.includes("--record"),
})

const parseRepeat = (args: readonly string[]): number => {
	let runs = 3
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--runs") runs = positiveInteger(args[++index], "--runs")
		else fail(`unknown repeat option: ${args[index]}`)
	}
	return runs
}

const parseBenchmark = (args: readonly string[]): ParcelBenchmarkOptions => {
	let files = 1_000
	let dirs: number | null = null
	let runs = 1
	let mutations = 20
	let shape: "broad" | "deep" = "broad"
	for (let index = 0; index < args.length; index++) {
		switch (args[index]) {
			case "--files":
				files = positiveInteger(args[++index], "--files")
				break
			case "--dirs":
				dirs = positiveInteger(args[++index], "--dirs")
				break
			case "--runs":
				runs = positiveInteger(args[++index], "--runs")
				break
			case "--mutations":
				mutations = positiveInteger(args[++index], "--mutations")
				break
			case "--shape": {
				const value = args[++index]
				if (value === "broad" || value === "deep") shape = value
				else fail("--shape must be broad or deep")
				break
			}
			default:
				fail(`unknown benchmark option: ${args[index]}`)
		}
	}
	return { files, dirs: dirs ?? Math.max(120, Math.floor(files / 10)), runs, mutations, shape }
}

const runProcess = async (
	executable: string,
	args: readonly string[],
	options: {
		readonly cwd: string
		readonly timeoutMs: number
		readonly env?: NodeJS.ProcessEnv
	},
): Promise<ProcessOutcome> => {
	const child = spawn(executable, args, {
		cwd: options.cwd,
		env: options.env,
		stdio: ["ignore", "pipe", "pipe"],
	})
	let stdout = ""
	let stderr = ""
	child.stdout.setEncoding("utf8")
	child.stderr.setEncoding("utf8")
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk
	})
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk
	})
	let timedOut = false
	let escalation: ReturnType<typeof setTimeout> | null = null
	const timer = setTimeout(() => {
		timedOut = true
		child.kill("SIGTERM")
		escalation = setTimeout(() => child.kill("SIGKILL"), 1_000)
	}, options.timeoutMs)
	const result = await new Promise<{
		readonly exitCode: number
		readonly signal: NodeJS.Signals | null
	}>((resolveExit) => {
		child.once("error", (error) => {
			stderr += error.stack ?? error.message
			resolveExit({ exitCode: -1, signal: null })
		})
		child.once("exit", (code, signal) => resolveExit({ exitCode: code ?? -1, signal }))
	}).finally(() => {
		clearTimeout(timer)
		if (escalation) clearTimeout(escalation)
	})
	return {
		success: !timedOut && result.exitCode === 0 && result.signal === null,
		exitCode: result.exitCode,
		signal: result.signal,
		timedOut,
		stdout: stdout.trim(),
		stderr: stderr.trim(),
	}
}

const compactOutcome = (outcome: ProcessOutcome): ProcessOutcome => ({
	...outcome,
	stdout: outcome.stdout.slice(-4_000),
	stderr: outcome.stderr.slice(-8_000),
})

const hostBunTarget = (): string => {
	const target = `${process.platform}-${process.arch}`
	const targets: Readonly<Record<string, string>> = {
		"darwin-arm64": "bun-darwin-arm64",
		"darwin-x64": "bun-darwin-x64",
		"linux-arm64": "bun-linux-arm64",
		"linux-x64": "bun-linux-x64",
	}
	return targets[target] ?? fail(`unsupported standalone host: ${target}`)
}

const hostStaticParcelPackage = (): string => {
	if (process.platform === "darwin") return `@parcel/watcher-darwin-${process.arch}`
	if (process.platform === "linux") return `@parcel/watcher-linux-${process.arch}-glibc`
	return fail(`unsupported Parcel standalone host: ${process.platform}-${process.arch}`)
}

const listNodeFiles = async (root: string): Promise<readonly string[]> => {
	const found: string[] = []
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name)
			if (entry.isDirectory()) await visit(path)
			else if (entry.isFile() && entry.name.endsWith(".node")) found.push(relative(root, path))
		}
	}
	await visit(root)
	return found.sort()
}

const sourceEntrypoint = (): string => {
	const candidate = import.meta.path
	if (!candidate.endsWith(".ts") || !existsSync(candidate)) {
		return fail("standalone-smoke must be launched from the TypeScript source entrypoint")
	}
	return candidate
}

const runIsolatedCorrectness = async (timeoutMs = 15_000): Promise<unknown> => {
	const outcome = await runProcess(process.execPath, [sourceEntrypoint(), "correctness-child"], {
		cwd: process.cwd(),
		timeoutMs,
	})
	if (!outcome.success) {
		const reported = outcome.stdout.length > 0 ? " after emitting a correctness report" : ""
		if (outcome.timedOut) {
			throw new Error(`correctness child did not exit within ${timeoutMs}ms${reported}`)
		}
		throw new Error(
			`correctness child exited ${outcome.exitCode}${outcome.signal ? ` (${outcome.signal})` : ""}: ${outcome.stderr}`,
		)
	}
	try {
		return JSON.parse(outcome.stdout) as unknown
	} catch (error) {
		throw new Error(
			`correctness child emitted malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

const runStandaloneVariant = async (
	entrypoint: string,
	binary: string,
	isolationRoot: string,
	workspaceNodeModules: string,
	compileFlags: readonly string[],
): Promise<StandaloneVariantResult> => {
	const build = await runProcess(
		process.execPath,
		[...compileFlags, `--outfile=${binary}`, entrypoint],
		{
			cwd: resolve(workspaceNodeModules, ".."),
			timeoutMs: 120_000,
			env: {
				...process.env,
				NODE_PATH: resolve(workspaceNodeModules, ".bun/node_modules"),
			},
		},
	)
	if (!build.success) {
		return {
			success: false,
			build: compactOutcome(build),
			run: null,
			binaryBytes: null,
			binaryContainsWatcherNode: false,
			persistentExtractedNodeFiles: [],
			nativeLoaderLines: [],
			workspaceNodeModulesDenied: true,
			addonDisposition: "compile failed before addon disposition could be tested",
		}
	}
	const binaryContents = await readFile(binary)
	const binaryContainsWatcherNode = binaryContents.includes(Buffer.from("watcher.node"))
	const profile = join(isolationRoot, "deny-workspace-node-modules.sb")
	const packageNodeModules = resolve(workspaceNodeModules, "../packages/ui/node_modules")
	await writeFile(
		profile,
		`(version 1)\n(allow default)\n(deny file-read* (subpath ${JSON.stringify(workspaceNodeModules)}))\n(deny file-read* (subpath ${JSON.stringify(packageNodeModules)}))\n`,
	)
	const runtimeTemp = join(isolationRoot, "runtime-tmp")
	await mkdir(runtimeTemp, { recursive: true })
	const run = await runProcess(
		"/usr/bin/sandbox-exec",
		["-f", profile, binary, "standalone-child"],
		{
			cwd: isolationRoot,
			timeoutMs: 30_000,
			env: { ...process.env, TMPDIR: runtimeTemp, DYLD_PRINT_LIBRARIES: "1" },
		},
	)
	const persistentExtractedNodeFiles = await listNodeFiles(isolationRoot)
	const nativeLoaderLines = run.stderr
		.split("\n")
		.filter((line) => line.includes("watcher.node"))
		.slice(0, 20)
	const addonDisposition = run.success
		? persistentExtractedNodeFiles.length > 0
			? "embedded and extracted into the isolated runtime filesystem"
			: nativeLoaderLines.some((line) => line.includes("$bunfs"))
				? "embedded and loaded from Bun's virtual/extracted $bunfs image; no persistent addon remained"
				: "embedded or runtime-extracted by Bun; workspace node_modules was denied and no persistent addon remained"
		: "runtime failed while workspace node_modules was denied"
	return {
		success: run.success,
		build: compactOutcome(build),
		run: compactOutcome({ ...run, stderr: nativeLoaderLines.join("\n") || run.stderr }),
		binaryBytes: binaryContents.byteLength,
		binaryContainsWatcherNode,
		persistentExtractedNodeFiles,
		nativeLoaderLines,
		workspaceNodeModulesDenied: true,
		addonDisposition,
	}
}

export const runStandaloneSmoke = async (): Promise<StandaloneReport> => {
	if (process.platform !== "darwin") {
		throw new Error("isolated standalone smoke currently requires macOS sandbox-exec")
	}
	const source = sourceEntrypoint()
	const packageRoot = resolve(source, "../..")
	const workspaceRoot = resolve(packageRoot, "../..")
	const workspaceNodeModules = resolve(workspaceRoot, "node_modules")
	const isolationRoot = await mkdtemp(join(tmpdir(), "house-ui-parcel-standalone-"))
	const generatedRoot = resolve(packageRoot, "node_modules/.cache")
	await mkdir(generatedRoot, { recursive: true })
	const generated = resolve(generatedRoot, `parcel-static-${process.pid}.ts`)
	const staticPackage = hostStaticParcelPackage()
	const compileFlags = [
		"build",
		"--compile",
		"--bytecode",
		"--format=esm",
		`--target=${hostBunTarget()}`,
	] as const
	try {
		const dynamic = await runStandaloneVariant(
			source,
			join(isolationRoot, "parcel-dynamic"),
			isolationRoot,
			workspaceNodeModules,
			compileFlags,
		)
		await writeFile(
			generated,
			`import binding from ${JSON.stringify(staticPackage)}
import { createWrapper } from "@parcel/watcher/wrapper"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const watcher = createWrapper(binding)
const root = await mkdtemp(join(tmpdir(), "house-ui-parcel-static-"))
let timer
try {
	let resolveMutation
	let rejectMutation
	const mutation = new Promise((resolve, reject) => {
		resolveMutation = resolve
		rejectMutation = reject
	})
	const subscription = await watcher.subscribe(root, (error, events) => {
		if (error) rejectMutation(error)
		if (events.some((event) => event.path.endsWith("standalone-static.txt"))) resolveMutation()
	})
	try {
		await writeFile(join(root, "standalone-static.txt"), "static")
		await Promise.race([
			mutation,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("static mutation timed out")), 5000)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
		await subscription.unsubscribe()
	}
	console.log(JSON.stringify({ mutationObserved: true, staticPackage: ${JSON.stringify(staticPackage)} }))
} finally {
	await rm(root, { recursive: true, force: true })
}
`,
		)
		const staticResult = await runStandaloneVariant(
			generated,
			join(isolationRoot, "parcel-static"),
			isolationRoot,
			workspaceNodeModules,
			compileFlags,
		)
		return {
			command: "standalone-smoke",
			compileFlags,
			isolatedDirectory: true,
			dynamic,
			static: staticResult,
			staticPackage,
		}
	} finally {
		await rm(generated, { force: true })
		await rm(isolationRoot, { recursive: true, force: true })
	}
}

const matrixCells = (): readonly ParcelBenchmarkOptions[] =>
	([1_000, 5_000, 10_000] as const).flatMap((files) =>
		(["broad", "deep"] as const).map(
			(shape): ParcelBenchmarkOptions => ({
				files,
				dirs: Math.max(120, Math.floor(files / 10)),
				runs: files === 10_000 && shape === "broad" ? 3 : 1,
				mutations: files === 10_000 && shape === "broad" ? 100 : 20,
				shape,
			}),
		),
	)

const validateCellReport = (
	value: unknown,
	cell: ParcelBenchmarkOptions,
): value is ParcelBenchmarkReport => {
	if (typeof value !== "object" || value === null || !("fixture" in value)) return false
	const fixture = value.fixture
	if (typeof fixture !== "object" || fixture === null) return false
	return JSON.stringify(fixture) === JSON.stringify(cell)
}

const runBenchmarkMatrix = async (
	record: boolean,
	timeoutMs: number,
): Promise<{
	readonly command: "benchmark-matrix"
	readonly completed: number
	readonly failed: number
	readonly reports: readonly ParcelBenchmarkReport[]
	readonly failure: string | null
}> => {
	const entrypoint = sourceEntrypoint()
	const reports: ParcelBenchmarkReport[] = []
	let failure: string | null = null
	for (const [index, cell] of matrixCells().entries()) {
		console.error(`[parcel matrix] ${index + 1}/6 ${cell.files}/${cell.shape}`)
		const outcome = await runProcess(
			process.execPath,
			[
				entrypoint,
				"benchmark-cell",
				"--files",
				String(cell.files),
				"--dirs",
				String(cell.dirs),
				"--runs",
				String(cell.runs),
				"--mutations",
				String(cell.mutations),
				"--shape",
				cell.shape,
			],
			{ cwd: process.cwd(), timeoutMs },
		)
		if (!outcome.success) {
			failure = outcome.timedOut
				? `${cell.files}/${cell.shape} timed out after ${timeoutMs}ms`
				: `${cell.files}/${cell.shape} exited ${outcome.exitCode}${outcome.signal ? ` (${outcome.signal})` : ""}: ${outcome.stderr}`
			if (record) await recordParcelEvidence("benchmark", null, new Error(failure))
			break
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(outcome.stdout) as unknown
		} catch (error) {
			failure = `${cell.files}/${cell.shape} emitted malformed JSON: ${error instanceof Error ? error.message : String(error)}`
			if (record) await recordParcelEvidence("benchmark", null, new Error(failure))
			break
		}
		if (!validateCellReport(parsed, cell)) {
			failure = `${cell.files}/${cell.shape} emitted a report for the wrong cell`
			if (record) await recordParcelEvidence("benchmark", parsed, new Error(failure))
			break
		}
		reports.push(parsed)
		if (record) await recordParcelEvidence("benchmark", parsed)
	}
	return {
		command: "benchmark-matrix",
		completed: reports.length,
		failed: failure === null ? 0 : 1,
		reports,
		failure,
	}
}

export const main = async (argv: readonly string[]): Promise<void> => {
	const [command, ...rawArgs] = argv
	if (command === undefined || command === "help" || command === "--help" || command === "-h") {
		console.log(usage)
		return
	}
	const { args, record } = withRecord(rawArgs)
	try {
		switch (command) {
			case "correctness": {
				if (args.length > 0) fail("correctness takes no options")
				const report = await runIsolatedCorrectness()
				if (record) await recordParcelEvidence("correctness", report)
				printJson(report)
				return
			}
			case "repeat": {
				const runs = parseRepeat(args)
				const startedAt = performance.now()
				const errors: string[] = []
				let passed = 0
				for (let run = 1; run <= runs; run++) {
					try {
						await runIsolatedCorrectness()
						passed++
					} catch (error) {
						errors.push(`run ${run}: ${error instanceof Error ? error.message : String(error)}`)
						break
					}
				}
				const report = {
					command: "repeat" as const,
					runs,
					passed,
					failed: errors.length,
					durationMs: performance.now() - startedAt,
					errors,
				}
				if (record) await recordParcelEvidence("repeat", report)
				printJson(report)
				if (report.failed > 0) process.exitCode = 1
				return
			}
			case "correctness-child": {
				if (args.length > 0 || record) fail("correctness-child takes no options")
				printJson(await runParcelCorrectness())
				return
			}
			case "benchmark-cell": {
				if (record) fail("benchmark-cell cannot record directly; use benchmark-matrix")
				printJson(await runParcelBenchmark(parseBenchmark(args)))
				return
			}
			case "benchmark-matrix": {
				let timeoutMs = 900_000
				for (let index = 0; index < args.length; index++) {
					if (args[index] === "--cell-timeout-ms")
						timeoutMs = positiveInteger(args[++index], "--cell-timeout-ms")
					else fail(`unknown benchmark-matrix option: ${args[index]}`)
				}
				const report = await runBenchmarkMatrix(record, timeoutMs)
				printJson(report)
				if (report.failed > 0) process.exitCode = 1
				return
			}
			case "standalone-smoke": {
				if (args.length > 0) fail("standalone-smoke takes no options")
				const report = await runStandaloneSmoke()
				if (record) await recordParcelEvidence("standalone", report)
				printJson(report)
				if (!report.dynamic.success && report.static?.success !== true) process.exitCode = 1
				return
			}
			case "standalone-child": {
				if (args.length > 0 || record) fail("standalone-child takes no options")
				printJson(await runParcelStandaloneChild())
				return
			}
			case "start-close-child": {
				if (args.length > 0 || record) fail("start-close-child takes no options")
				printJson(await runParcelStartCloseChild())
				return
			}
			case "verify-evidence": {
				if (args.length > 0 || record) fail("verify-evidence takes no options")
				const validation = await validateParcelEvidence()
				printJson(validation)
				if (!validation.valid) process.exitCode = 1
				return
			}
			default:
				fail(`unknown command: ${command}\n\n${usage}`)
		}
	} catch (error) {
		if (record) {
			const kind =
				command === "correctness"
					? "correctness"
					: command === "repeat"
						? "repeat"
						: command === "standalone-smoke"
							? "standalone"
							: null
			if (kind) await recordParcelEvidence(kind, null, error)
		}
		throw error
	}
}

if (import.meta.main) {
	try {
		await main(process.argv.slice(2))
	} catch (error) {
		console.error(error instanceof Error ? error.stack : String(error))
		process.exitCode = 1
	}
}
