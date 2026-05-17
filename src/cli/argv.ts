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
	/** True when `--all` was passed: include hidden + gitignored files in discovery. */
	readonly all: boolean
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
}

/**
 * Minimal argv parser.
 *
 * Does not validate flag values — boot layers do, so error messages can
 * reference domain knowledge (registered themes, valid integer ranges)
 * without coupling the parser to it.
 */
export const parseArgv = (argv: readonly string[]): ParsedArgs => {
	let path: string | null = null
	let theme: string | null = null
	let tone: string | null = null
	let width: string | null = null
	let all = false
	let sort: string | null = null
	let serve = false
	let port: string | null = null
	let help = false
	let version = false
	let configPath = false

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!
		switch (arg) {
			case "--theme":
				theme = argv[i + 1] ?? null
				i++
				continue
			case "--tone":
				tone = argv[i + 1] ?? null
				i++
				continue
			case "--width":
				width = argv[i + 1] ?? null
				i++
				continue
			case "--all":
				all = true
				continue
			case "--sort":
				sort = argv[i + 1] ?? null
				i++
				continue
			case "--serve":
				serve = true
				continue
			case "--port":
				port = argv[i + 1] ?? null
				i++
				continue
			case "--help":
			case "-h":
				help = true
				continue
			case "--version":
			case "-v":
				version = true
				continue
			case "--config-path":
				configPath = true
				continue
		}
		if (path === null && !arg.startsWith("-")) {
			path = arg
		}
	}

	return { path, theme, tone, width, all, sort, serve, port, help, version, configPath }
}

const themeList = themeDefinitions.map((t) => t.id).join(", ")

export const usage = `usage: house [path] [options]

  path           file or directory; defaults to the current directory

options:
  --theme <id>   color theme: ${themeList} (default: opencode)
  --tone <mode>  dark or light (default: dark)
  --width <N>    cap rendered markdown width at N columns
  --all          include hidden and gitignored files in discovery
  --sort <mode>  sidebar order: dirs-first (default) or files-first
  --serve        serve the given file as HTML in the browser (skips TUI)
  --port <N>     port for --serve (default: OS-assigned)
  -h, --help     show this help and exit
  -v, --version  print version and exit
  --config-path  print path to the config file and exit

configuration:
  file: $XDG_CONFIG_HOME/house/config.toml  (default ~/.config/house/config.toml)
  keys: theme, tone
  env:  HOUSE_THEME, HOUSE_TONE
  precedence (high → low): flags → env → file → defaults`
