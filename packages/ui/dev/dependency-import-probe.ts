export interface DependencyImportProbeResult {
	readonly chokidar: boolean
	readonly fuzzysort: boolean
	readonly ignore: boolean
}

export const runDependencyImportProbe = async (): Promise<DependencyImportProbeResult> => {
	const [chokidarModule, fuzzysortModule, ignoreModule] = await Promise.all([
		import("chokidar"),
		import("fuzzysort"),
		import("ignore"),
	])
	const fuzzyMatches = fuzzysortModule.default.go("rdm", ["README.md", "notes.txt"])
	const ignoreMatches = ignoreModule.default().add("*.tmp").ignores("scratch.tmp")
	return {
		chokidar: typeof chokidarModule.watch === "function",
		fuzzysort: fuzzyMatches.length === 1 && fuzzyMatches[0]?.target === "README.md",
		ignore: ignoreMatches,
	}
}
