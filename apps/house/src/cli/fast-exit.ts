import pkg from "../../package.json" with { type: "json" }
import { defaultConfigPath } from "../config/load.ts"
import { parseArgv, type ParsedArgs, usage } from "./argv.ts"

/** Parse argv and handle CLI exits that do not need to import the TUI app graph. */
export const parseAndHandleFastExit = (argv: readonly string[]): ParsedArgs => {
	const args = parseArgv(argv)

	if (args.help) {
		console.log(usage)
		process.exit(0)
	}
	if (args.wrapConflict) {
		console.error("house: --wrap and --no-wrap cannot be used together")
		process.exit(2)
	}
	if (argv.includes("--width") && args.width === null) {
		console.error("house: --width requires a positive integer")
		process.exit(2)
	}
	if (args.version) {
		console.log(pkg.version)
		process.exit(0)
	}
	if (args.configPath) {
		console.log(defaultConfigPath())
		process.exit(0)
	}

	return args
}
