import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { loadConfig } from "../../src/config/load.ts"
import { themeDefinitions } from "../../src/theme/registry.ts"

const altTheme = themeDefinitions.find((t) => t.id !== "opencode")?.id ?? "opencode"
const altTheme2 =
	themeDefinitions.find((t) => t.id !== "opencode" && t.id !== altTheme)?.id ?? altTheme

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

describe("loadConfig", () => {
	test("returns built-in defaults when nothing is set", async () => {
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg).toEqual({
			theme: "opencode",
			tone: "dark",
			defaultRoot: "cwd",
			mdx: true,
			show: [],
			focus: "filter",
		})
	})

	test("mdx = false in file is honored", async () => {
		await writeFile(cfgPath, `mdx = false\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.mdx).toBe(false)
	})

	test("HOUSE_MDX env beats file", async () => {
		await writeFile(cfgPath, `mdx = true\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: { HOUSE_MDX: "false" } }))
		expect(cfg.mdx).toBe(false)
	})

	test("CLI mdx=false beats env and file", async () => {
		await writeFile(cfgPath, `mdx = true\n`)
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_MDX: "true" },
				cli: { theme: null, tone: null, mdx: false, show: null, focus: null },
			}),
		)
		expect(cfg.mdx).toBe(false)
	})

	test("invalid mdx value → ConfigError", async () => {
		await writeFile(cfgPath, `mdx = "maybe"\n`)
		await expect(run(loadConfig({ filePath: cfgPath, env: {} }))).rejects.toThrow(/mdx/i)
	})

	test("file overrides defaults; missing key falls through to default", async () => {
		await writeFile(cfgPath, `theme = "${altTheme}"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg).toEqual({
			theme: altTheme,
			tone: "dark",
			defaultRoot: "cwd",
			mdx: true,
			show: [],
			focus: "filter",
		})
	})

	test("env beats file (per-key)", async () => {
		await writeFile(cfgPath, `theme = "${altTheme}"\ntone = "dark"\n`)
		const cfg = await run(
			loadConfig({ filePath: cfgPath, env: { HOUSE_THEME: altTheme2, HOUSE_TONE: "light" } }),
		)
		expect(cfg).toEqual({
			theme: altTheme2,
			tone: "light",
			defaultRoot: "cwd",
			mdx: true,
			show: [],
			focus: "filter",
		})
	})

	test("CLI beats env (per-key)", async () => {
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_TONE: "dark" },
				cli: { theme: null, tone: "light", mdx: null, show: null, focus: null },
			}),
		)
		expect(cfg.tone).toBe("light")
	})

	test("CLI beats file and env when set", async () => {
		await writeFile(cfgPath, `theme = "${altTheme}"\n`)
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_THEME: altTheme2 },
				cli: { theme: "opencode", tone: null, mdx: null, show: null, focus: null },
			}),
		)
		expect(cfg.theme).toBe("opencode")
	})

	test("unknown theme in file → ConfigError", async () => {
		await writeFile(cfgPath, `theme = "does-not-exist"\n`)
		await expect(run(loadConfig({ filePath: cfgPath, env: {} }))).rejects.toThrow(
			/does-not-exist|theme/i,
		)
	})

	test("malformed TOML → ConfigError mentioning the path", async () => {
		await writeFile(cfgPath, `this is = = not valid toml\n`)
		await expect(run(loadConfig({ filePath: cfgPath, env: {} }))).rejects.toThrow(
			new RegExp(cfgPath.replace(/[/\\.^$*+?()|[\]{}]/g, "\\$&")),
		)
	})

	test("unknown key in file → warning + still loads with defaults", async () => {
		// Forward-compat: a config written for a future house version should
		// not break the current one. Unknown keys are dropped with a warning.
		await writeFile(cfgPath, `futureFeature = "on"\n`)
		const warnings: string[] = []
		const cfg = await run(
			loadConfig({ filePath: cfgPath, env: {}, onWarning: (m) => warnings.push(m) }),
		)
		expect(cfg).toEqual({
			theme: "opencode",
			tone: "dark",
			defaultRoot: "cwd",
			mdx: true,
			show: [],
			focus: "filter",
		})
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toMatch(/"futureFeature"/)
	})

	test('defaultRoot = "git" in file is honored', async () => {
		await writeFile(cfgPath, `defaultRoot = "git"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.defaultRoot).toBe("git")
	})

	test("HOUSE_DEFAULT_ROOT env beats file", async () => {
		await writeFile(cfgPath, `defaultRoot = "cwd"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: { HOUSE_DEFAULT_ROOT: "git" } }))
		expect(cfg.defaultRoot).toBe("git")
	})

	test("invalid defaultRoot value warns and falls back to cwd", async () => {
		await writeFile(cfgPath, `defaultRoot = "moon"\n`)
		const warnings: string[] = []
		const cfg = await run(
			loadConfig({ filePath: cfgPath, env: {}, onWarning: (m) => warnings.push(m) }),
		)
		expect(cfg.defaultRoot).toBe("cwd")
		expect(warnings).toContain(
			'house: ignoring invalid value "moon" for defaultRoot in config/env; using "cwd"',
		)
	})

	test("typo'd key suggests the closest known key", async () => {
		await writeFile(cfgPath, `them = "${altTheme}"\n`)
		const warnings: string[] = []
		const cfg = await run(
			loadConfig({ filePath: cfgPath, env: {}, onWarning: (m) => warnings.push(m) }),
		)
		expect(cfg.theme).toBe("opencode") // bad key dropped → default
		expect(warnings[0]).toMatch(/did you mean "theme"/)
	})

	test("unknown key far from any known key gets no suggestion", async () => {
		await writeFile(cfgPath, `xyzzy = "on"\n`)
		const warnings: string[] = []
		await run(loadConfig({ filePath: cfgPath, env: {}, onWarning: (m) => warnings.push(m) }))
		expect(warnings[0]).not.toMatch(/did you mean/)
	})

	test("known keys still load when an unknown sibling is present", async () => {
		await writeFile(cfgPath, `theme = "${altTheme}"\nfutureFeature = "on"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {}, onWarning: () => {} }))
		expect(cfg.theme).toBe(altTheme)
	})

	test("show = [...] TOML array is parsed", async () => {
		await writeFile(cfgPath, `show = ["hidden", "gitignored"]\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.show).toEqual(["hidden", "gitignored"])
	})

	test("show = [] disables all categories explicitly", async () => {
		await writeFile(cfgPath, `show = []\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.show).toEqual([])
	})

	test("show with a single category", async () => {
		await writeFile(cfgPath, `show = ["hidden"]\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.show).toEqual(["hidden"])
	})

	test("HOUSE_SHOW env (comma-separated) beats file", async () => {
		await writeFile(cfgPath, `show = ["hidden"]\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: { HOUSE_SHOW: "gitignored" } }))
		expect(cfg.show).toEqual(["gitignored"])
	})

	test("HOUSE_SHOW='' clears via env", async () => {
		await writeFile(cfgPath, `show = ["hidden", "gitignored"]\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: { HOUSE_SHOW: "" } }))
		expect(cfg.show).toEqual([])
	})

	test("CLI show beats env and file (replacement, not merge)", async () => {
		await writeFile(cfgPath, `show = ["hidden", "gitignored"]\n`)
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_SHOW: "gitignored" },
				cli: { theme: null, tone: null, mdx: null, show: ["hidden"], focus: null },
			}),
		)
		expect(cfg.show).toEqual(["hidden"])
	})

	test("invalid show token in file → ConfigError naming the token", async () => {
		await writeFile(cfgPath, `show = ["bogus"]\n`)
		await expect(run(loadConfig({ filePath: cfgPath, env: {} }))).rejects.toThrow(/bogus/)
	})

	test("invalid show token in env → ConfigError naming the token", async () => {
		await expect(
			run(loadConfig({ filePath: cfgPath, env: { HOUSE_SHOW: "hidden,gremlin" } })),
		).rejects.toThrow(/gremlin/)
	})

	test("show tokens are trimmed and de-duped", async () => {
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_SHOW: " hidden , hidden , gitignored " },
			}),
		)
		expect(cfg.show).toEqual(["hidden", "gitignored"])
	})

	test('focus = "reader" in file is honored', async () => {
		await writeFile(cfgPath, `focus = "reader"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.focus).toBe("reader")
	})

	test("HOUSE_FOCUS env beats file", async () => {
		await writeFile(cfgPath, `focus = "filter"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: { HOUSE_FOCUS: "sidebar" } }))
		expect(cfg.focus).toBe("sidebar")
	})

	test("CLI focus beats env and file", async () => {
		await writeFile(cfgPath, `focus = "reader"\n`)
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_FOCUS: "sidebar" },
				cli: { theme: null, tone: null, mdx: null, show: null, focus: "filter" },
			}),
		)
		expect(cfg.focus).toBe("filter")
	})

	test("invalid focus value → ConfigError", async () => {
		await writeFile(cfgPath, `focus = "maybe"\n`)
		await expect(run(loadConfig({ filePath: cfgPath, env: {} }))).rejects.toThrow(/focus/i)
	})

	test("partial file: only theme set, tone defaults", async () => {
		await writeFile(cfgPath, `theme = "${altTheme}"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.tone).toBe("dark")
		expect(cfg.theme).toBe(altTheme)
	})
})
