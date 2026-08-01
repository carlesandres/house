import {
	runBenchmarkMatrix,
	runBenchmarkMatrixSelection,
	runCorrectness,
} from "./backend-harness.ts"

const args = process.argv.slice(2)
const command = args[0]?.startsWith("--") || args[0] === undefined ? "correctness" : args[0]
const options = command === "correctness" ? args : args.slice(1)
const usePolling = options.includes("--polling")

const positiveInteger = (name: string, fallback: number): number => {
	const index = options.indexOf(name)
	if (index < 0) return fallback
	const value = Number(options[index + 1])
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new Error(`${name} requires a positive integer`)
	return value
}

try {
	if (command === "correctness") {
		const result = await runCorrectness(usePolling)
		console.log(JSON.stringify({ command: "node-baseline", result }, null, 2))
	} else if (command === "benchmark-matrix") {
		const full = options.includes("--full")
		const matrix = full
			? await runBenchmarkMatrix(3)
			: await runBenchmarkMatrixSelection({
					files: [positiveInteger("--files", 1_000)],
					shapes: [options.includes("--deep") ? "deep" : "broad"],
					modes: [usePolling],
					runs: positiveInteger("--runs", 1),
					mutations: positiveInteger("--mutations", 20),
					dirs: positiveInteger("--dirs", 120),
				})
		const result = { ...matrix, usePolling }
		console.log(JSON.stringify({ command: "node-benchmark-matrix", result }, null, 2))
	} else {
		throw new Error(`unknown Node baseline command: ${command}`)
	}
} catch (error) {
	console.error(error instanceof Error ? error.stack : String(error))
	process.exitCode = 1
}
