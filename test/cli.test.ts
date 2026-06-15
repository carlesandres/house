import { describe, expect, test } from "bun:test"
import { parseArgv, type ParsedArgs } from "../src/cli/argv.ts"

const empty: ParsedArgs = {
	path: null,
	root: null,
	theme: null,
	tone: null,
	width: null,
	wrap: null,
	wrapConflict: false,
	serve: false,
	port: null,
	help: false,
	version: false,
	configPath: false,
	sidebar: null,
	noUpdateCheck: false,
	extensions: null,
	show: null,
	focus: null,
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

describe("parseArgv — --root", () => {
	test("captures the value after --root", () => {
		expect(parseArgv(["--root", "docs"])).toEqual(args({ root: "docs" }))
	})
	test("--root with no value yields null", () => {
		expect(parseArgv(["--root"])).toEqual(args({ root: null }))
	})
	test("--root does not swallow the positional path", () => {
		expect(parseArgv(["--root", "docs", "README.md"])).toEqual(
			args({ root: "docs", path: "README.md" }),
		)
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
	test("bare --width yields null so boot can report the required value", () => {
		expect(parseArgv(["--width"])).toEqual(args({ width: null }))
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
	test("--wrap and --no-wrap set startup wrap overrides", () => {
		expect(parseArgv(["--wrap"])).toEqual(args({ wrap: true }))
		expect(parseArgv(["--no-wrap"])).toEqual(args({ wrap: false }))
		expect(parseArgv(["--wrap", "--no-wrap"])).toEqual(
			args({ wrap: true, wrapConflict: true }),
		)
	})
	test("--ext is parsed as a string value", () => {
		expect(parseArgv(["--ext", "note,txt"])).toEqual(args({ extensions: "note,txt" }))
	})
})

describe("parseArgv — --focus", () => {
	test("captures the value after --focus", () => {
		expect(parseArgv(["--focus", "filter"])).toEqual(args({ focus: "filter" }))
	})
	test("captures unknown focus values verbatim (boot validates)", () => {
		expect(parseArgv(["--focus", "weird"])).toEqual(args({ focus: "weird" }))
	})
	test("--focus with no value yields null", () => {
		expect(parseArgv(["--focus"])).toEqual(args({ focus: null }))
	})
	test("--focus does not swallow the following flag", () => {
		expect(parseArgv(["--focus", "--width", "80"])).toEqual(args({ focus: null, width: "80" }))
	})
})

describe("parseArgv — --show", () => {
	test("captures the value after --show", () => {
		expect(parseArgv(["--show", "hidden,gitignored"])).toEqual(args({ show: "hidden,gitignored" }))
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

describe("parseArgv — removed flags", () => {
	test("--sort is NOT a recognised flag", () => {
		expect(parseArgv(["--sort", "dirs-first"])).toEqual(empty)
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
