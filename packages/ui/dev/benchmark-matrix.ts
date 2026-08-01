export interface IsolatedBenchmarkCell {
	readonly files: 1_000 | 5_000 | 10_000
	readonly shape: "broad" | "deep"
	readonly usePolling: boolean
	readonly runs: 3
	readonly mutations: 100
}

export type MatrixChildOutcome =
	| {
			readonly kind: "exit"
			readonly exitCode: number
			readonly signal: NodeJS.Signals | null
			readonly stdout: string
			readonly stderr: string
	  }
	| { readonly kind: "timeout"; readonly timeoutMs: number; readonly stderr: string }

export interface MatrixRunSummary {
	readonly completed: number
	readonly skipped: number
	readonly failed: number
}

export interface MatrixDependencies {
	readonly isComplete: (cell: IsolatedBenchmarkCell) => Promise<boolean>
	readonly runChild: (cell: IsolatedBenchmarkCell) => Promise<MatrixChildOutcome>
	readonly validateReport: (report: unknown, cell: IsolatedBenchmarkCell) => boolean
	readonly recordSuccess: (cell: IsolatedBenchmarkCell, report: unknown) => Promise<void>
	readonly recordFailure: (cell: IsolatedBenchmarkCell, reason: string) => Promise<void>
	readonly progress: (message: string) => void
}

export const benchmarkCellKey = (cell: IsolatedBenchmarkCell): string =>
	`${cell.files}:${cell.shape}:${cell.usePolling ? "polling" : "event"}`

export const requiredBenchmarkCells = (): readonly IsolatedBenchmarkCell[] =>
	([1_000, 5_000, 10_000] as const).flatMap((files) =>
		(["broad", "deep"] as const).flatMap((shape) =>
			([false, true] as const).map((usePolling) => ({
				files,
				shape,
				usePolling,
				runs: 3 as const,
				mutations: 100 as const,
			})),
		),
	)

export const runIsolatedBenchmarkMatrix = async (
	cells: readonly IsolatedBenchmarkCell[],
	force: boolean,
	dependencies: MatrixDependencies,
): Promise<MatrixRunSummary> => {
	let completed = 0
	let skipped = 0
	let failed = 0
	for (const [index, cell] of cells.entries()) {
		const label = `${benchmarkCellKey(cell)} (${index + 1}/${cells.length})`
		if (!force && (await dependencies.isComplete(cell))) {
			dependencies.progress(`skip ${label}: complete artifact already recorded`)
			skipped++
			continue
		}
		dependencies.progress(`start ${label}`)
		const outcome = await dependencies.runChild(cell)
		let report: unknown = null
		let failure: string | null = null
		if (outcome.kind === "timeout") {
			failure = `timed out after ${outcome.timeoutMs}ms${outcome.stderr ? `: ${outcome.stderr}` : ""}`
		} else if (outcome.signal !== null) {
			failure = `terminated by ${outcome.signal}${outcome.stderr ? `: ${outcome.stderr}` : ""}`
		} else if (outcome.exitCode !== 0) {
			failure = `exited ${outcome.exitCode}${outcome.stderr ? `: ${outcome.stderr}` : ""}`
		} else {
			try {
				report = JSON.parse(outcome.stdout) as unknown
			} catch (error) {
				failure = `emitted malformed JSON: ${error instanceof Error ? error.message : String(error)}`
			}
			if (failure === null && !dependencies.validateReport(report, cell)) {
				failure = "emitted report failed concrete cell validation"
			}
		}
		if (failure !== null) {
			await dependencies.recordFailure(cell, failure)
			dependencies.progress(`fail ${label}: ${failure}`)
			failed++
			break
		}
		await dependencies.recordSuccess(cell, report)
		dependencies.progress(`complete ${label}`)
		completed++
	}
	return { completed, skipped, failed }
}
