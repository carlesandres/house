#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { release } from "node:os"
import {
	runBenchmark,
	runCorrectness,
	runRepeat,
	runtimeIdentity,
	verifyDependencyImports,
} from "./backend-harness.ts"
import type { BenchmarkOptions, RepeatReport } from "./backend-harness.ts"
import {
	hasCompleteBenchmarkCell,
	readEvidence,
	recordFailureEvidence,
	recordLocalEvidence,
	validateBenchmarkCellReport,
	validateEvidence,
} from "./evidence.ts"
import type { EvidenceProvenance } from "./evidence.ts"
import type { EvidenceArtifact, EvidenceRuntime } from "./evidence.ts"
import { requiredBenchmarkCells, runIsolatedBenchmarkMatrix } from "./benchmark-matrix.ts"
import type { IsolatedBenchmarkCell, MatrixChildOutcome } from "./benchmark-matrix.ts"

const usage = `Usage: bun packages/ui/dev/backend-feasibility.ts <command> [options]

Commands:
  verify-local      Run direct dependency probes plus correctness in event and polling modes
  verify-evidence   Validate durable evidence as approved, rejected, or incomplete
  correctness       Run real-filesystem correctness scenarios
  repeat            Repeat correctness to expose event/polling races
  benchmark         Run a warmup and disposable-tree benchmark, or the explicit full matrix
  standalone-smoke  Repeat real scan/watch/mutation/shutdown in a compiled executable
  child-exit        Prove a child correctness process exits before a hard timeout
  imports           Dynamically import chokidar, fuzzysort, and ignore directly
  node-probe        Emit, run, record, and clean a Node import/baseline/matrix probe

Options:
  --polling          Use explicit polling mode
  --record           Append structured host-local evidence to the evidence document
  --runs <count>     Repeat/benchmark count (benchmark default: 3; repeat default: 5)
  --files <count>    Benchmark file count (default: 1000)
  --dirs <count>     Benchmark directory count (default: 120)
  --mutations <n>    Mixed mutations (default: 20, or 100 with --record)
  --shape <shape>    Benchmark shape: broad or deep (default: broad)
  --matrix           Explicit 1k/5k/10k x broad/deep x event/polling benchmark matrix
  --cell-timeout-ms  Isolated Bun matrix-cell timeout (default: 900000)
  --force            Rerun complete matrix cells instead of resuming
  --timeout-ms <n>   Emitted Node child timeout (default: 120000)
  -h, --help         Show this help

Standalone build:
  bun build --compile --bytecode --format=esm \
    --outfile=/tmp/backend-feasibility packages/ui/dev/backend-feasibility.ts
  /tmp/backend-feasibility repeat --runs 10
  /tmp/backend-feasibility repeat --runs 3 --polling

Node probes (package-local TypeScript 6 emitted ESM, always cleaned):
  bun packages/ui/dev/backend-feasibility.ts node-probe imports --record
  bun packages/ui/dev/backend-feasibility.ts node-probe correctness --record
  bun packages/ui/dev/backend-feasibility.ts node-probe correctness --polling --record
  bun packages/ui/dev/backend-feasibility.ts node-probe benchmark-matrix --record

No Node command here claims that plain Node can import @house/ui's TypeScript/TSX source export.`

const fail = (message: string): never => {
	throw new Error(message)
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null

const positiveInteger = (value: string | undefined, option: string): number => {
	if (value === undefined || !/^\d+$/.test(value)) fail(`${option} requires a positive integer`)
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${option} requires a positive integer`)
	return parsed
}

interface CommonOptions {
	readonly args: readonly string[]
	readonly record: boolean
}

const extractRecord = (args: readonly string[]): CommonOptions => ({
	args: args.filter((argument) => argument !== "--record"),
	record: args.includes("--record"),
})

const parseBenchmarkOptions = (
	args: readonly string[],
	defaultMutations: number,
): {
	readonly options: BenchmarkOptions
	readonly matrix: boolean
	readonly force: boolean
	readonly cellTimeoutMs: number
} => {
	let files = 1_000
	let dirs = 120
	let runs = 3
	let mutations = defaultMutations
	let usePolling = false
	let matrix = false
	let force = false
	let cellTimeoutMs = 900_000
	let shape: "broad" | "deep" = "broad"
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		switch (argument) {
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
			case "--polling":
				usePolling = true
				break
			case "--matrix":
				matrix = true
				break
			case "--force":
				force = true
				break
			case "--cell-timeout-ms":
				cellTimeoutMs = positiveInteger(args[++index], "--cell-timeout-ms")
				break
			case "--shape": {
				const next = args[++index]
				if (next === "broad" || next === "deep") shape = next
				else fail("--shape must be broad or deep")
				break
			}
			default:
				fail(`unknown benchmark option: ${argument}`)
		}
	}
	return {
		options: { files, dirs, runs, mutations, usePolling, shape },
		matrix,
		force,
		cellTimeoutMs,
	}
}

const parseRepeatOptions = (
	args: readonly string[],
	defaultRuns: number,
): { readonly runs: number; readonly usePolling: boolean } => {
	let runs = defaultRuns
	let usePolling = false
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (argument === "--runs") runs = positiveInteger(args[++index], "--runs")
		else if (argument === "--polling") usePolling = true
		else fail(`unknown repeat option: ${argument}`)
	}
	return { runs, usePolling }
}

const parsePollingOnly = (args: readonly string[]): boolean => {
	if (args.length === 0) return false
	if (args.length === 1 && args[0] === "--polling") return true
	return fail(`unknown correctness option: ${args.join(" ")}`)
}

const printJson = (value: unknown): void => {
	console.log(JSON.stringify(value, null, 2))
}

const childCommand = (usePolling: boolean): readonly [string, readonly string[]] => {
	const candidate = process.argv[1]
	const sourceEntrypoint =
		candidate !== undefined && /\.(?:ts|mjs|cjs|js)$/.test(candidate) && existsSync(candidate)
			? candidate
			: undefined
	const executable = process.execPath
	const args = sourceEntrypoint === undefined ? ["correctness"] : [sourceEntrypoint, "correctness"]
	if (usePolling) args.push("--polling")
	return [executable, args]
}

const runChildExitProbe = async (usePolling: boolean): Promise<unknown> => {
	const [executable, args] = childCommand(usePolling)
	const startedAt = performance.now()
	const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
		const child = spawn(executable, args, { stdio: "ignore" })
		const timer = setTimeout(() => {
			child.kill("SIGKILL")
			rejectExit(new Error("child correctness process timed out after 20s"))
		}, 20_000)
		child.once("error", (error) => {
			clearTimeout(timer)
			rejectExit(error)
		})
		child.once("exit", (code) => {
			clearTimeout(timer)
			resolveExit(code ?? -1)
		})
	})
	if (exitCode !== 0) fail(`child correctness process exited ${exitCode}`)
	return {
		command: "child-exit",
		runtime: runtimeIdentity(),
		usePolling,
		exitCode,
		durationMs: performance.now() - startedAt,
	}
}

const runProcess = async (
	executable: string,
	args: readonly string[],
	cwd: string,
	timeoutMs = 120_000,
): Promise<void> => {
	let timedOut = false
	let escalation: ReturnType<typeof setTimeout> | null = null
	const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
		const child = spawn(executable, args, { cwd, stdio: "inherit" })
		const timer = setTimeout(() => {
			timedOut = true
			child.kill("SIGTERM")
			escalation = setTimeout(() => child.kill("SIGKILL"), 1_000)
		}, timeoutMs)
		child.once("error", (error) => {
			clearTimeout(timer)
			if (escalation) clearTimeout(escalation)
			rejectExit(error)
		})
		child.once("exit", (code) => {
			clearTimeout(timer)
			if (escalation) clearTimeout(escalation)
			resolveExit(code ?? -1)
		})
	})
	if (timedOut) throw new Error(`${executable} timed out after ${timeoutMs}ms`)
	if (exitCode !== 0) throw new Error(`${executable} exited ${exitCode}`)
}

interface NodeProcessResult {
	readonly stdout: string
	readonly stderr: string
}

const runNodeProcess = async (
	args: readonly string[],
	cwd: string,
	timeoutMs: number,
): Promise<NodeProcessResult> => {
	const child = spawn("node", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
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
	}, timeoutMs)
	const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
		child.once("error", rejectExit)
		child.once("exit", (code) => resolveExit(code ?? -1))
	}).finally(() => {
		clearTimeout(timer)
		if (escalation) clearTimeout(escalation)
	})
	if (timedOut) throw new Error(`Node probe timed out after ${timeoutMs}ms`)
	if (exitCode !== 0) {
		throw new Error(`Node probe exited ${exitCode}: ${stderr.trim() || "no stderr"}`)
	}
	return { stdout, stderr }
}

const runBunMatrixChild = async (
	cell: IsolatedBenchmarkCell,
	timeoutMs: number,
): Promise<MatrixChildOutcome> => {
	const candidate = process.argv[1]
	const sourceEntrypoint = candidate?.endsWith(".ts") && existsSync(candidate) ? candidate : null
	const args = [
		...(sourceEntrypoint === null ? [] : [sourceEntrypoint]),
		"benchmark-cell",
		"--files",
		String(cell.files),
		"--dirs",
		String(Math.max(120, Math.floor(cell.files / 10))),
		"--runs",
		String(cell.runs),
		"--mutations",
		String(cell.mutations),
		"--shape",
		cell.shape,
		...(cell.usePolling ? ["--polling"] : []),
	]
	const child = spawn(process.execPath, args, {
		cwd: process.cwd(),
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
	}, timeoutMs)
	const result = await new Promise<{
		readonly exitCode: number
		readonly signal: NodeJS.Signals | null
	}>((resolveExit) => {
		child.once("error", (error) => {
			stderr += error instanceof Error ? error.message : String(error)
			resolveExit({ exitCode: -1, signal: null })
		})
		child.once("exit", (code, signal) => {
			resolveExit({ exitCode: code ?? -1, signal })
		})
	}).finally(() => {
		clearTimeout(timer)
		if (escalation) clearTimeout(escalation)
	})
	if (timedOut) return { kind: "timeout", timeoutMs, stderr: stderr.trim() }
	return {
		kind: "exit",
		exitCode: result.exitCode,
		signal: result.signal,
		stdout,
		stderr: stderr.trim(),
	}
}

const runNodeProbe = async (
	args: readonly string[],
	record: boolean,
): Promise<{ readonly command: "node-probe"; readonly probe: string }> => {
	const [probe = "correctness", ...probeOptions] = args
	if (probe !== "imports" && probe !== "correctness" && probe !== "benchmark-matrix") {
		throw new Error(`unknown Node probe: ${probe}`)
	}
	const packageRoot = existsSync(resolve(process.cwd(), "tsconfig.node-probe.json"))
		? process.cwd()
		: resolve(process.cwd(), "packages/ui")
	const cacheRoot = resolve(packageRoot, "node_modules/.cache")
	const tsc = resolve(packageRoot, "node_modules/.bin/tsc")
	const versionOption = probeOptions.indexOf("--node-version")
	const requestedVersion = versionOption >= 0 ? probeOptions[versionOption + 1] : undefined
	const timeoutOption = probeOptions.indexOf("--timeout-ms")
	const timeoutMs =
		timeoutOption >= 0 ? positiveInteger(probeOptions[timeoutOption + 1], "--timeout-ms") : 120_000
	const forwardedOptions = probeOptions.filter(
		(_, index) =>
			(versionOption < 0 || (index !== versionOption && index !== versionOption + 1)) &&
			(timeoutOption < 0 || (index !== timeoutOption && index !== timeoutOption + 1)),
	)
	const childArgs = [...forwardedOptions]
	const runtimeResult = spawnSync(
		"node",
		[
			"-e",
			"console.log(JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch}))",
		],
		{ encoding: "utf8", timeout: 5_000 },
	)
	if (runtimeResult.status !== 0 && requestedVersion === undefined) {
		throw new Error(`could not resolve requested Node runtime: ${runtimeResult.stderr}`)
	}
	const detected =
		runtimeResult.status === 0
			? (JSON.parse(runtimeResult.stdout.trim()) as {
					readonly version: string
					readonly platform: string
					readonly arch: string
				})
			: { version: requestedVersion!, platform: process.platform, arch: process.arch }
	const requestedRuntime: EvidenceRuntime = {
		name: "node",
		version: requestedVersion ?? detected.version,
		platform: detected.platform,
		arch: detected.arch,
		osRelease: release(),
	}
	const failureKind =
		probe === "imports"
			? "node-import"
			: probe === "benchmark-matrix"
				? "node-benchmark-matrix"
				: "node-baseline"
	const failureMode: EvidenceArtifact["mode"] =
		probe === "imports" ? "imports" : forwardedOptions.includes("--polling") ? "polling" : "event"
	let outputRoot: string | null = null
	try {
		await mkdir(cacheRoot, { recursive: true })
		outputRoot = await mkdtemp(join(cacheRoot, "house-ui-node-probe-"))
		await runProcess(
			tsc,
			["-p", resolve(packageRoot, "tsconfig.node-probe.json"), "--outDir", outputRoot],
			packageRoot,
			timeoutMs,
		)
		let output: NodeProcessResult
		if (probe === "imports") {
			output = await runNodeProcess(
				[resolve(outputRoot, "dependency-import-probe-entry.js"), ...childArgs],
				packageRoot,
				timeoutMs,
			)
		} else {
			output = await runNodeProcess(
				[
					resolve(outputRoot, "node-watch-baseline-entry.js"),
					...(probe === "benchmark-matrix" ? ["benchmark-matrix"] : []),
					...childArgs,
				],
				packageRoot,
				timeoutMs,
			)
		}
		const parsed = JSON.parse(output.stdout.trim()) as unknown
		if (!isRecord(parsed)) throw new Error("Node probe returned non-object JSON")
		const artifactResult = probe === "imports" ? parsed : parsed.result
		if (artifactResult === undefined) throw new Error("Node probe result payload is missing")
		if (record) await recordLocalEvidence(failureKind, artifactResult, "emitted-node")
		console.log(output.stdout.trim())
		return { command: "node-probe", probe }
	} catch (error) {
		if (record) {
			await recordFailureEvidence(
				failureKind,
				error,
				"emitted-node",
				failureMode === "polling",
				requestedRuntime,
				failureMode,
			)
		}
		throw error
	} finally {
		if (outputRoot !== null) await rm(outputRoot, { recursive: true, force: true })
	}
}

const evidenceRuntime = (): EvidenceRuntime => {
	const runtime = runtimeIdentity()
	return {
		name: runtime.name,
		version: runtime.version,
		platform: runtime.platform,
		arch: runtime.arch,
		osRelease: runtime.osRelease,
	}
}

const runBunBenchmarkMatrix = async (
	record: boolean,
	force: boolean,
	cellTimeoutMs: number,
): Promise<void> => {
	const runtime = evidenceRuntime()
	const summary = await runIsolatedBenchmarkMatrix(requiredBenchmarkCells(), force, {
		isComplete: async (cell) =>
			record && hasCompleteBenchmarkCell(await readEvidence(), runtime, cell),
		runChild: (cell) => runBunMatrixChild(cell, cellTimeoutMs),
		validateReport: validateBenchmarkCellReport,
		recordSuccess: async (_cell, report) => {
			if (record) await recordLocalEvidence("benchmark-cell", report, "source")
		},
		recordFailure: async (cell, reason) => {
			if (!record) return
			await recordFailureEvidence(
				"benchmark-cell",
				new Error(reason),
				"source",
				cell.usePolling,
				runtime,
				cell.usePolling ? "polling" : "event",
				{
					files: cell.files,
					shape: cell.shape,
					mode: cell.usePolling ? "polling" : "event",
					runs: cell.runs,
					mutations: cell.mutations,
				},
			)
		},
		progress: (message) => console.error(`[benchmark matrix] ${message}`),
	})
	printJson({ command: "benchmark-matrix", runtime, ...summary })
	if (summary.failed > 0) process.exitCode = 1
}

const ensureRepeatPassed = (report: RepeatReport): void => {
	if (report.failed > 0) fail(`repeat failed: ${report.errors.join("; ")}`)
}

const provenance = (): EvidenceProvenance => {
	const candidate = process.argv[1]
	if (candidate?.endsWith(".ts") && existsSync(candidate)) return "source"
	if (candidate !== undefined && /\.(?:mjs|cjs|js)$/.test(candidate) && existsSync(candidate)) {
		return "emitted-node"
	}
	return "compiled"
}

export const main = async (argv: readonly string[]): Promise<void> => {
	const [command, ...rawArgs] = argv
	if (command === undefined || command === "--help" || command === "-h") {
		console.log(usage)
		return
	}
	const { args, record } = extractRecord(rawArgs)
	switch (command) {
		case "imports": {
			if (args.length > 0) fail("imports takes no options")
			const result = {
				command,
				runtime: runtimeIdentity(),
				imports: await verifyDependencyImports(),
			}
			if (record) await recordLocalEvidence(command, result, provenance())
			printJson(result)
			return
		}
		case "verify-evidence": {
			if (args.length > 0 || record) fail("verify-evidence takes no options")
			const validation = await validateEvidence()
			printJson(validation)
			if (!validation.valid) process.exitCode = 1
			return
		}
		case "correctness": {
			const result = await runCorrectness(parsePollingOnly(args))
			if (record) await recordLocalEvidence(command, result, provenance())
			printJson(result)
			return
		}
		case "repeat": {
			const options = parseRepeatOptions(args, 5)
			const result = await runRepeat(options.runs, options.usePolling)
			if (record) await recordLocalEvidence(command, result, provenance())
			printJson(result)
			ensureRepeatPassed(result)
			return
		}
		case "benchmark": {
			const parsed = parseBenchmarkOptions(args, record ? 100 : 20)
			if (parsed.matrix) {
				await runBunBenchmarkMatrix(record, parsed.force, parsed.cellTimeoutMs)
				return
			}
			if (record && !parsed.matrix && parsed.options.mutations < 100) {
				fail("recorded benchmark trials require at least 100 mixed mutations")
			}
			const result = await runBenchmark(parsed.options)
			if (record) {
				await recordLocalEvidence(command, result, provenance())
			}
			printJson(result)
			return
		}
		case "benchmark-cell": {
			if (record) fail("benchmark-cell is private and cannot record directly")
			const parsed = parseBenchmarkOptions(args, 100)
			if (parsed.matrix || parsed.force) fail("benchmark-cell accepts one concrete cell only")
			printJson(await runBenchmark(parsed.options))
			return
		}
		case "standalone-smoke": {
			const options = parseRepeatOptions(args, 1)
			const result = await runRepeat(options.runs, options.usePolling)
			if (record) await recordLocalEvidence(command, result, provenance())
			printJson({ command, result })
			ensureRepeatPassed(result)
			return
		}
		case "child-exit": {
			const usePolling = parsePollingOnly(args)
			const result = await runChildExitProbe(usePolling)
			if (record) await recordLocalEvidence(command, result, provenance())
			printJson(result)
			return
		}
		case "node-probe": {
			const result = await runNodeProbe(args, record)
			printJson(result)
			return
		}
		case "verify-local": {
			if (args.length > 0) fail("verify-local takes no options")
			const imports = await verifyDependencyImports()
			const eventMode = await runCorrectness(false)
			const pollingMode = await runCorrectness(true)
			const result = { command, runtime: runtimeIdentity(), imports, eventMode, pollingMode }
			if (record) await recordLocalEvidence(command, result, provenance())
			printJson(result)
			return
		}
		default:
			fail(`unknown command: ${command}\n\n${usage}`)
	}
}

if (import.meta.main) {
	try {
		await main(process.argv.slice(2))
	} catch (error) {
		const command = process.argv[2] ?? "unknown"
		if (process.argv.includes("--record") && command !== "node-probe") {
			try {
				await recordFailureEvidence(
					command,
					error,
					provenance(),
					process.argv.includes("--polling"),
				)
			} catch (recordError) {
				console.error(
					`failed to retain failure evidence: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
				)
			}
		}
		console.error(error instanceof Error ? error.stack : String(error))
		process.exitCode = 1
	}
}
