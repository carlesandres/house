import { Command } from "commander"
import { themeDefinitions } from "../theme/registry.ts"

export interface ParsedArgs {
	/** First positional argument, or null if none was given. */
	readonly path: string | null
	/** Value of `--root <dir>`, or null. */
	readonly root: string | null
	/** Value of `--theme <id>`, or null. Validated by the boot layer against the registry. */
	readonly theme: string | null
	/** Value of `--tone dark|light`, or null. Validated by the boot layer. */
	readonly tone: string | null
	/** Value of `--width <N>`, or null. Validated by the boot layer (must be a positive integer). */
	readonly width: string | null
	/** Startup reader wrap override. Null means config/env/default decides. */
	readonly wrap: boolean | null
	/** True when both `--wrap` and `--no-wrap` were passed. */
	readonly wrapConflict: boolean
	/** True when `--serve` was passed: serve the positional path as HTML, skip TUI. */
	readonly serve: boolean
	/** Value of `--port <N>`, or null. Validated by the boot layer. */
	readonly port: string | null
	/** True when `--help` was passed. */
	readonly help: boolean
	/** True when `--version` was passed. */
	readonly version: boolean
	/** True when `--config-path` was passed: print resolved config path and exit. */
	readonly configPath: boolean
	/** True when `--no-update-check` was passed: suppress the npm-registry
	 *  probe and the "update available" notice. Mirrors the
	 *  `NO_UPDATE_NOTIFIER` env var so opt-out is reachable without env state. */
	readonly noUpdateCheck: boolean
	/** Raw value of `--ext [list]`, or null if absent. Comma-separated list. */
	readonly extensions: string | null
	/** Value of `--focus <mode>` (`sidebar`, `reader`, `filter`), or null.
	 *  Validated by the boot layer. */
	readonly focus: string | null
	/** Raw value of `--show <list>`, or null if the flag wasn't passed.
	 *  Comma-separated list of category names; the boot layer validates
	 *  tokens against the known vocabulary (see `discovery/show.ts`).
	 *  `--show ""` is a meaningful value: clears the set. */
	readonly show: string | null
}

const createProgram = () =>
	new Command()
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.exitOverride()
		.helpOption(false)
		.option("--theme [id]")
		.option("--tone [mode]")
		.option("--width [N]")
		.option("--wrap")
		.option("--no-wrap")
		.option("--serve")
		.option("--port [N]")
		.option("--config-path")
		.option("--no-update-check")
		.option("--ext [list]")
		.option("--focus [mode]")
		.option("--show [list]")
		.option("--root [dir]")
		.option("-h, --help")
		.option("-v, --version")
		.argument("[path]")

const VALUE_FLAGS: ReadonlySet<string> = new Set([
	"--theme",
	"--tone",
	"--width",
	"--port",
	"--focus",
	"--show",
	"--root",
	"--ext",
])

const REMOVED_VALUE_FLAGS: ReadonlySet<string> = new Set(["--sort", "--sidebar"])

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
	"--serve",
	"--config-path",
	"--no-update-check",
	"--wrap",
	"--no-wrap",
	"--help",
	"-h",
	"--version",
	"-v",
])

const findPathArg = (argv: readonly string[]): string | null => {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!
		if (VALUE_FLAGS.has(arg) || REMOVED_VALUE_FLAGS.has(arg)) {
			const next = argv[i + 1]
			if (next !== undefined && !next.startsWith("-")) i++
			continue
		}
		if (BOOLEAN_FLAGS.has(arg)) continue
		if (arg.startsWith("-")) continue
		return arg
	}
	return null
}

/**
 * Minimal argv parser.
 *
 * Does not validate flag values — boot layers do, so error messages can
 * reference domain knowledge (registered themes, valid integer ranges)
 * without coupling the parser to it.
 */
export const parseArgv = (argv: readonly string[]): ParsedArgs => {
	const program = createProgram()
	program.parse([...argv], { from: "user" })
	const opts = program.opts<Record<string, unknown>>()
	const pathArg = findPathArg(argv)
	const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null)
	const hasWrap = argv.includes("--wrap")
	const hasNoWrap = argv.includes("--no-wrap")

	return {
		path: typeof pathArg === "string" ? pathArg : null,
		root: stringOrNull(opts["root"]),
		theme: stringOrNull(opts["theme"]),
		tone: stringOrNull(opts["tone"]),
		width: stringOrNull(opts["width"]),
		wrap: hasWrap ? true : hasNoWrap ? false : null,
		wrapConflict: hasWrap && hasNoWrap,
		serve: opts["serve"] === true,
		port: stringOrNull(opts["port"]),
		help: opts["help"] === true,
		version: opts["version"] === true,
		configPath: opts["configPath"] === true,
		noUpdateCheck: opts["noUpdateCheck"] === true,
		extensions: stringOrNull(opts["ext"]),
		show: stringOrNull(opts["show"]),
		focus: stringOrNull(opts["focus"]),
	}
}

const themeList = themeDefinitions.map((t) => t.id).join(", ")

export const usage = `usage:
  house [query] [options]
  house --serve <path> [--port N]

  query          initial filter query; omit to browse the full discovery root

options:
  --theme <id>   color theme: ${themeList} (default: opencode)
  --tone <mode>  dark or light (default: dark)
  --width <N>    reader wrap width used when wrapping is enabled (default: 80)
  --wrap         start with reader wrapping enabled
  --no-wrap      start with reader wrapping disabled
  --show <list>  reveal normally-skipped entries; comma-separated subset of:
                   hidden, gitignored. Use --show "" to clear.
  --root <dir>   discovery root to walk (overrides defaultRoot config/env)
  --focus <m>    startup focus: sidebar, reader, or filter (default: sidebar)
  --serve        serve the positional path as HTML in the browser (skips TUI)
  --port <N>     port for --serve (default: OS-assigned)
  -h, --help     show this help and exit
  -v, --version  print version and exit
  --config-path  print path to the config file and exit
  --no-update-check  suppress the "newer version available" check (also via NO_UPDATE_NOTIFIER=1)
	--ext <list>   include extra file extensions (comma-separated)

examples:
  house README.md
  house --root docs
  house --serve README.md

configuration:
  file: $XDG_CONFIG_HOME/house/config.toml  (default ~/.config/house/config.toml)
	  keys: theme, tone, width, wrap, extensions, show, focus, defaultRoot
	  env:  HOUSE_THEME, HOUSE_TONE, HOUSE_WIDTH, HOUSE_WRAP, HOUSE_EXTENSIONS, HOUSE_SHOW, HOUSE_FOCUS, HOUSE_DEFAULT_ROOT
  precedence (high → low): flags → env → file → defaults`
