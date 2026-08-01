import { runDependencyImportProbe } from "./dependency-import-probe.ts"
import { release } from "node:os"
import { writeFile } from "node:fs/promises"

try {
	const pidFileIndex = process.argv.indexOf("--pid-file")
	if (pidFileIndex >= 0 && process.argv[pidFileIndex + 1] !== undefined) {
		await writeFile(process.argv[pidFileIndex + 1]!, String(process.pid))
	}
	if (process.argv.includes("--hang")) {
		setInterval(() => {}, 1_000)
		await new Promise<never>(() => {})
	}
	const result = {
		command: "node-import",
		runtime: {
			name: "node" as const,
			version: process.versions.node,
			platform: process.platform,
			arch: process.arch,
			osRelease: release(),
		},
		imports: await runDependencyImportProbe(),
	}
	console.log(JSON.stringify(result))
} catch (error) {
	console.error(error instanceof Error ? error.stack : String(error))
	process.exitCode = 1
}
