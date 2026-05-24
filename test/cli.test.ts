import { describe, expect, test } from "bun:test"
import { parseArgv, type ParsedArgs } from "../src/cli/argv.ts"

const empty: ParsedArgs = {
	path: null,
	theme: null,
	tone: null,
	width: null,
	sort: null,
	serve: false,
	port: null,
	help: false,
	version: false,
	configPath: false,
	sidebar: null,
	noUpdateCheck: false,
	noMdx: false,
	show: null,
}
const args = (overrides: Partial<ParsedArgs>): ParsedArgs => ({ ...empty, ...overrides })

describe("parseArgv — positional path", () => {
	test("returns empty defaults when no args", () => {
		expect(parseArgv([])).toEqual(empty)
	})
	test("returns the first positional as path", () => {
		expect(parseArgv(["README.md"])).toEqual(args({ path: "README.md" }))
	})
	test("ignores extra positional args (for now)", () => {
		expect(parseArgv(["foo.md", "bar.md"])).toEqual(args({ path: "foo.md" }))
	})
})

describe("parseArgv — --theme", () => {
	test("captures the value after --theme", () => {
		expect(parseArgv(["--theme", "light"])).toEqual(args({ theme: "light" }))
	})
	test("--theme before path", () => {
		expect(parseArgv(["--theme", "dark", "docs"])).toEqual(args({ path: "docs", theme: "dark" }))
	})
	test("--theme after path", () => {
		expect(parseArgv(["docs", "--theme", "light"])).toEqual(args({ path: "docs", theme: "light" }))
	})
	test("captures unknown theme values verbatim (boot validates)", () => {
		expect(parseArgv(["--theme", "neon"])).toEqual(args({ theme: "neon" }))
	})
	test("--theme with no value yields null", () => {
		expect(parseArgv(["--theme"])).toEqual(args({ theme: null }))
	})
})

describe("parseArgv — --width", () => {
	test("captures the value after --width", () => {
		expect(parseArgv(["--width", "80"])).toEqual(args({ width: "80" }))
	})
	test("captures non-numeric values verbatim (boot validates)", () => {
		expect(parseArgv(["--width", "wide"])).toEqual(args({ width: "wide" }))
	})
})

describe("parseArgv — boolean flags", () => {
	test("--help and -h are parsed as help", () => {
		expect(parseArgv(["--help"])).toEqual(args({ help: true }))
		expect(parseArgv(["-h"])).toEqual(args({ help: true }))
	})
	test("--version and -v are parsed as version", () => {
		expect(parseArgv(["--version"])).toEqual(args({ version: true }))
		expect(parseArgv(["-v"])).toEqual(args({ version: true }))
	})
	test("--config-path is parsed as boolean", () => {
		expect(parseArgv(["--config-path"])).toEqual(args({ configPath: true }))
	})
	test("--no-mdx is parsed as boolean", () => {
		expect(parseArgv(["--no-mdx"])).toEqual(args({ noMdx: true }))
	})
})

describe("parseArgv — --show", () => {
	test("captures the value after --show", () => {
		expect(parseArgv(["--show", "hidden,gitignored"])).toEqual(
			args({ show: "hidden,gitignored" }),
		)
	})
	test("captures a single category", () => {
		expect(parseArgv(["--show", "hidden"])).toEqual(args({ show: "hidden" }))
	})
	test("captures empty string verbatim (means: clear)", () => {
		// Explicit empty set — the parser must keep this distinct from
		// "flag absent" so the boot layer can tell "user opted in to no
		// categories" from "user didn't say".
		expect(parseArgv(["--show", ""])).toEqual(args({ show: "" }))
	})
	test("captures unknown tokens verbatim (boot validates)", () => {
		expect(parseArgv(["--show", "bogus,hidden"])).toEqual(args({ show: "bogus,hidden" }))
	})
	test("--show with no value yields null", () => {
		expect(parseArgv(["--show"])).toEqual(args({ show: null }))
	})
	test("--all is NOT a recognised flag (removed in the show refactor)", () => {
		// Regression guard for the breaking change: --all is gone, only the
		// shift+a UI keybind retains the "show everything" sugar.
		expect(parseArgv(["--all"])).toEqual(empty)
	})
	test("--hidden / --gitignored are NOT recognised flags", () => {
		// They moved into --show <list>. Guard against accidental
		// re-introduction during future refactors.
		expect(parseArgv(["--hidden"])).toEqual(empty)
		expect(parseArgv(["--gitignored"])).toEqual(empty)
	})
})

describe("parseArgv — --sort", () => {
	test("captures the value after --sort", () => {
		expect(parseArgv(["--sort", "files-first"])).toEqual(args({ sort: "files-first" }))
	})
	test("captures unknown sort values verbatim (boot validates)", () => {
		expect(parseArgv(["--sort", "weird"])).toEqual(args({ sort: "weird" }))
	})
	test("--sort with no value yields null", () => {
		expect(parseArgv(["--sort"])).toEqual(args({ sort: null }))
	})
})

describe("parseArgv — --sidebar", () => {
	test("captures the value after --sidebar", () => {
		expect(parseArgv(["--sidebar", "off"])).toEqual(args({ sidebar: "off" }))
	})
	test("captures unknown sidebar values verbatim (boot validates)", () => {
		expect(parseArgv(["--sidebar", "maybe"])).toEqual(args({ sidebar: "maybe" }))
	})
	test("--sidebar with no value yields null", () => {
		expect(parseArgv(["--sidebar"])).toEqual(args({ sidebar: null }))
	})
	test("--sidebar does not swallow the following flag", () => {
		// Regression guard: `--sidebar --width 80` must still parse --width.
		expect(parseArgv(["--sidebar", "--width", "80"])).toEqual(args({ sidebar: null, width: "80" }))
	})
})

describe("parseArgv — combined", () => {
	test("path + multiple flags", () => {
		expect(
			parseArgv(["docs", "--theme", "light", "--width", "80", "--show", "hidden,gitignored"]),
		).toEqual(args({ path: "docs", theme: "light", width: "80", show: "hidden,gitignored" }))
	})
})
