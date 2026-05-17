import { describe, expect, test } from "bun:test"
import { parseArgv, type ParsedArgs } from "../src/cli/argv.ts"

const empty: ParsedArgs = {
	path: null,
	theme: null,
	tone: null,
	width: null,
	all: false,
	sort: null,
	serve: false,
	port: null,
	help: false,
	version: false,
	configPath: false,
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
	test("--all is parsed as boolean", () => {
		expect(parseArgv(["--all"])).toEqual(args({ all: true }))
	})
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

describe("parseArgv — combined", () => {
	test("path + multiple flags", () => {
		expect(parseArgv(["docs", "--theme", "light", "--width", "80", "--all"])).toEqual(
			args({ path: "docs", theme: "light", width: "80", all: true }),
		)
	})
})
