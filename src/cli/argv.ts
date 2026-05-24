import { Command } from "commander"
import { themeDefinitions } from "../theme/registry.ts"

export interface ParsedArgs {
	/** First positional argument, or null if none was given. */
	readonly path: string | null
	/** Value of `--theme <id>`, or null. Validated by the boot layer against the registry. */
	readonly theme: string | null
	/** Value of `--tone dark|light`, or null. Validated by the boot layer. */
	readonly tone: string | null
	/** Value of `--width <N>`, or null. Validated by the boot layer (must be a positive integer). */
	readonly width: string | null
	/** Value of `--sort <mode>` (`dirs-first` or `files-first`), or null. Validated by the boot layer. */
	readonly sort: string | null
	/** True when `--serve` was passed: serve the given file as HTML, skip TUI. */
	readonly serve: boolean
	/** Value of `--port <N>`, or null. Validated by the boot layer. */
	readonly port: string | null
	/** True when `--help` was passed. */
	readonly help: boolean
	/** True when `--version` was passed. */
	readonly version: boolean
	/** True when `--config-path` was passed: print resolved config path and exit. */
	readonly configPath: boolean
	/** Value of `--sidebar <mode>` (`auto`, `on`, `off`), or null. Validated by the boot layer. */
	readonly sidebar: string | null
	/** True when `--no-update-check` was passed: suppress the npm-registry
	 *  probe and the "update available" notice. Mirrors the
	 *  `NO_UPDATE_NOTIFIER` env var so opt-out is reachable without env state. */
	readonly noUpdateCheck: boolean
	/** True when `--no-mdx` was passed: exclude `.mdx` files from discovery. */
	readonly noMdx: boolean
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
		.option("--sort [mode]")
		.option("--serve")
		.option("--port [N]")
		.option("--config-path")
		.option("--sidebar [mode]")
		.option("--no-update-check")
		.option("--no-mdx")
		.option("--focus [mode]")
		.option("--show [list]")
		.option("-h, --help")
		.option("-v, --version")
		.argument("[path]")

const VALUE_FLAGS: ReadonlySet<string> = new Set([
	"--theme",
	"--tone",
	"--width",
	"--sort",
	"--port",
	"--sidebar",
	"--focus",
	"--show",
])

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
	"--serve",
	"--config-path",
	"--no-update-check",
	"--no-mdx",
	"--help",
	"-h",
	"--version",
	"-v",
])

const findPathArg = (argv: readonly string[]): string | null => {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!
		if (VALUE_FLAGS.has(arg)) {
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

	return {
		path: typeof pathArg === "string" ? pathArg : null,
		theme: stringOrNull(opts["theme"]),
		tone: stringOrNull(opts["tone"]),
		width: stringOrNull(opts["width"]),
		sort: stringOrNull(opts["sort"]),
		serve: opts["serve"] === true,
		port: stringOrNull(opts["port"]),
		help: opts["help"] === true,
		version: opts["version"] === true,
		configPath: opts["configPath"] === true,
		sidebar: stringOrNull(opts["sidebar"]),
		noUpdateCheck: opts["noUpdateCheck"] === true,
		noMdx: opts["mdx"] === false,
		show: stringOrNull(opts["show"]),
		focus: stringOrNull(opts["focus"]),
	}
}

const themeList = themeDefinitions.map((t) => t.id).join(", ")

export const usage = `usage: house [path] [options]

  path           file or directory; defaults to the current directory

options:
  --theme <id>   color theme: ${themeList} (default: opencode)
  --tone <mode>  dark or light (default: dark)
  --width <N>    cap rendered markdown width at N columns
  --show <list>  reveal normally-skipped entries; comma-separated subset of:
                   hidden, gitignored. Use --show "" to clear.
  --sort <mode>  sidebar order: dirs-first (default) or files-first
  --sidebar <m>  initial sidebar visibility: auto (default), on, or off
  --focus <m>    startup focus: sidebar, reader, or filter (default: filter)
  --serve        serve the given file as HTML in the browser (skips TUI)
  --port <N>     port for --serve (default: OS-assigned)
  -h, --help     show this help and exit
  -v, --version  print version and exit
  --config-path  print path to the config file and exit
  --no-update-check  suppress the "newer version available" check (also via NO_UPDATE_NOTIFIER=1)
  --no-mdx       exclude .mdx files from discovery (default: included)

configuration:
  file: $XDG_CONFIG_HOME/house/config.toml  (default ~/.config/house/config.toml)
  keys: theme, tone, mdx, show, focus
  env:  HOUSE_THEME, HOUSE_TONE, HOUSE_MDX, HOUSE_SHOW, HOUSE_FOCUS
  precedence (high → low): flags → env → file → defaults`
