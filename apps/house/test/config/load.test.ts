import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { formatConfigError, loadConfig, type CliOverrides } from "../../src/config/load.ts"

let dir: string
let cfgPath: string

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "house-cfg-"))
	cfgPath = join(dir, "config.toml")
})

afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff as Effect.Effect<A, E>)

const emptyCli: CliOverrides = {
	theme: null,
	tone: null,
	extensions: null,
	show: null,
	focus: null,
	width: null,
	wrap: null,
	order: null,
}

const loadMessage = async (options: Parameters<typeof loadConfig>[0]): Promise<string> => {
	try {
		await run(loadConfig(options))
	} catch (err) {
		return formatConfigError(err)
	}
	throw new Error("expected loadConfig to fail")
}

describe("loadConfig", () => {
	test("returns built-in defaults when nothing is set", async () => {
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg).toEqual({
			theme: "opencode",
			tone: "dark",
			defaultRoot: "cwd",
			extensions: [],
			width: 80,
			wrap: false,
			show: [],
			focus: "sidebar",
			order: "recently-modified",
		})
	})

	test("extensions are merged from file, env, and CLI by precedence", async () => {
		await writeFile(cfgPath, `extensions = ["note"]\n`)
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_EXTENSIONS: "txt" },
				cli: {
					theme: null,
					tone: null,
					extensions: ["log"],
					show: null,
					focus: null,
					width: null,
					wrap: null,
					order: null,
				},
			}),
		)
		expect(cfg.extensions).toEqual(["log"])
	})

	test("width and wrap resolve from file, env, and CLI by precedence", async () => {
		await writeFile(cfgPath, "width = 72\nwrap = true\n")
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_WIDTH: "88", HOUSE_WRAP: "false" },
				cli: {
					theme: null,
					tone: null,
					extensions: null,
					show: null,
					focus: null,
					width: 100,
					wrap: true,
					order: null,
				},
			}),
		)
		expect(cfg.width).toBe(100)
		expect(cfg.wrap).toBe(true)
	})

	test("rejects invalid env width and wrap values", async () => {
		await expect(run(loadConfig({ filePath: cfgPath, env: { HOUSE_WIDTH: "0" } }))).rejects.toThrow(
			/width: expected a positive integer/,
		)
		await expect(run(loadConfig({ filePath: cfgPath, env: { HOUSE_WRAP: "1" } }))).rejects.toThrow(
			/wrap: expected true or false/,
		)
	})

	test("rejects invalid TOML width and wrap types", async () => {
		await writeFile(cfgPath, 'width = "80"\n')
		await expect(run(loadConfig({ filePath: cfgPath, env: {} }))).rejects.toThrow(
			/invalid value for width/,
		)

		await writeFile(cfgPath, 'wrap = "true"\n')
		await expect(run(loadConfig({ filePath: cfgPath, env: {} }))).rejects.toThrow(
			/invalid value for wrap/,
		)
	})

	test("theme, tone, focus, defaultRoot, and order resolve from file, env, and CLI by precedence", async () => {
		await writeFile(
			cfgPath,
			'theme = "nord"\ntone = "light"\nfocus = "reader"\ndefaultRoot = "git"\norder = "recently-modified"\n',
		)
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: {
					HOUSE_THEME: "tokyonight",
					HOUSE_TONE: "dark",
					HOUSE_FOCUS: "filter",
					HOUSE_DEFAULT_ROOT: "cwd",
					HOUSE_ORDER: "tree",
				},
				cli: {
					...emptyCli,
					theme: "opencode",
					tone: "light",
					focus: "sidebar",
					order: "recently-modified",
				},
			}),
		)
		expect(cfg.theme).toBe("opencode")
		expect(cfg.tone).toBe("light")
		expect(cfg.focus).toBe("sidebar")
		expect(cfg.defaultRoot).toBe("cwd")
		expect(cfg.order).toBe("recently-modified")
	})

	test("file values win over defaults when env and CLI are unset", async () => {
		await writeFile(
			cfgPath,
			'theme = "nord"\ntone = "light"\nfocus = "reader"\ndefaultRoot = "git"\norder = "recently-modified"\n',
		)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.theme).toBe("nord")
		expect(cfg.tone).toBe("light")
		expect(cfg.focus).toBe("reader")
		expect(cfg.defaultRoot).toBe("git")
		expect(cfg.order).toBe("recently-modified")
	})

	test("rejects unknown theme, tone, focus, and order from env", async () => {
		expect(await loadMessage({ filePath: cfgPath, env: { HOUSE_THEME: "neon" } })).toMatch(/neon/)
		expect(await loadMessage({ filePath: cfgPath, env: { HOUSE_TONE: "dim" } })).toMatch(/dim/)
		expect(await loadMessage({ filePath: cfgPath, env: { HOUSE_FOCUS: "palette" } })).toMatch(
			/palette/,
		)
		expect(await loadMessage({ filePath: cfgPath, env: { HOUSE_ORDER: "dirs-first" } })).toMatch(
			/dirs-first/,
		)
	})

	test("rejects unknown theme, tone, focus, and order from the config file", async () => {
		await writeFile(cfgPath, 'theme = "neon"\n')
		expect(await loadMessage({ filePath: cfgPath, env: {} })).toMatch(/invalid value for theme/)

		await writeFile(cfgPath, 'tone = "dim"\n')
		expect(await loadMessage({ filePath: cfgPath, env: {} })).toMatch(/invalid value for tone/)

		await writeFile(cfgPath, 'focus = "palette"\n')
		expect(await loadMessage({ filePath: cfgPath, env: {} })).toMatch(/invalid value for focus/)

		await writeFile(cfgPath, 'order = "dirs-first"\n')
		expect(await loadMessage({ filePath: cfgPath, env: {} })).toMatch(/invalid value for order/)
	})

	test("rejects non-string theme, tone, focus, and order in TOML", async () => {
		await writeFile(cfgPath, "theme = true\n")
		expect(await loadMessage({ filePath: cfgPath, env: {} })).toMatch(/invalid value for theme/)

		await writeFile(cfgPath, "tone = 1\n")
		expect(await loadMessage({ filePath: cfgPath, env: {} })).toMatch(/invalid value for tone/)

		await writeFile(cfgPath, "focus = false\n")
		expect(await loadMessage({ filePath: cfgPath, env: {} })).toMatch(/invalid value for focus/)

		await writeFile(cfgPath, "order = true\n")
		expect(await loadMessage({ filePath: cfgPath, env: {} })).toMatch(/invalid value for order/)
	})

	test("rejects invalid defaultRoot from env and file instead of falling back", async () => {
		const env = await loadMessage({ filePath: cfgPath, env: { HOUSE_DEFAULT_ROOT: "repo" } })
		expect(env).toMatch(/defaultRoot/)
		expect(env).toMatch(/repo/)

		await writeFile(cfgPath, 'defaultRoot = "repo"\n')
		const file = await loadMessage({ filePath: cfgPath, env: {} })
		expect(file).toMatch(/invalid value for defaultRoot/)
		expect(file).toMatch(/cwd/)
	})

	test("rejects invalid CLI theme, tone, focus, and order", async () => {
		expect(
			await loadMessage({ filePath: cfgPath, env: {}, cli: { ...emptyCli, theme: "neon" } }),
		).toMatch(/neon/)
		expect(
			await loadMessage({ filePath: cfgPath, env: {}, cli: { ...emptyCli, tone: "dim" } }),
		).toMatch(/dim/)
		expect(
			await loadMessage({
				filePath: cfgPath,
				env: {},
				cli: { ...emptyCli, focus: "palette" },
			}),
		).toMatch(/palette/)
		expect(
			await loadMessage({
				filePath: cfgPath,
				env: {},
				cli: { ...emptyCli, order: "dirs-first" },
			}),
		).toMatch(/dirs-first/)
	})
})
