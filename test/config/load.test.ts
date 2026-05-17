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
		expect(cfg).toEqual({ theme: "opencode", tone: "dark" })
	})

	test("file overrides defaults; missing key falls through to default", async () => {
		await writeFile(cfgPath, `theme = "${altTheme}"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg).toEqual({ theme: altTheme, tone: "dark" })
	})

	test("env beats file (per-key)", async () => {
		await writeFile(cfgPath, `theme = "${altTheme}"\ntone = "dark"\n`)
		const cfg = await run(
			loadConfig({ filePath: cfgPath, env: { HOUSE_THEME: altTheme2, HOUSE_TONE: "light" } }),
		)
		expect(cfg).toEqual({ theme: altTheme2, tone: "light" })
	})

	test("CLI beats env (per-key)", async () => {
		const cfg = await run(
			loadConfig({
				filePath: cfgPath,
				env: { HOUSE_TONE: "dark" },
				cli: { theme: null, tone: "light" },
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
				cli: { theme: "opencode", tone: null },
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

	test("unknown key in file → ConfigError listing the bad key", async () => {
		await writeFile(cfgPath, `them = "${altTheme}"\n`)
		await expect(run(loadConfig({ filePath: cfgPath, env: {} }))).rejects.toThrow(
			/"them"/,
		)
	})

	test("partial file: only theme set, tone defaults", async () => {
		await writeFile(cfgPath, `theme = "${altTheme}"\n`)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.tone).toBe("dark")
		expect(cfg.theme).toBe(altTheme)
	})
})
