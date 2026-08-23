import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { loadConfig } from "../../src/config/load.ts"
import { houseOptions } from "../../src/config/options.ts"
import { persistHouseOption } from "../../src/config/persist.ts"

let dir: string
let cfgPath: string

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "house-persist-"))
	cfgPath = join(dir, "config.toml")
})

afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff as Effect.Effect<A, E>)

describe("persistHouseOption", () => {
	test("writes theme and tone together when theme changes", async () => {
		await persistHouseOption(
			{
				key: "theme",
				value: "nord",
				values: { ...houseOptions.defaults, theme: "nord", tone: "light" },
			},
			cfgPath,
		)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.theme).toBe("nord")
		expect(cfg.tone).toBe("light")
	})

	test("ignores session-only keys", async () => {
		await persistHouseOption(
			{
				key: "wrap",
				value: true,
				values: { ...houseOptions.defaults, wrap: true },
			},
			cfgPath,
		)
		expect(await Bun.file(cfgPath).exists()).toBe(false)
	})

	test("writes both keys when tone changes", async () => {
		await persistHouseOption(
			{
				key: "tone",
				value: "light",
				values: { ...houseOptions.defaults, theme: "tokyonight", tone: "light" },
			},
			cfgPath,
		)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.theme).toBe("tokyonight")
		expect(cfg.tone).toBe("light")
	})

	test("session set of theme persists through persistHouseOption", async () => {
		const session = houseOptions.createSession(
			{ ...houseOptions.defaults, tone: "light" },
			{ persist: (event) => persistHouseOption(event, cfgPath) },
		)
		await session.set("theme", "nord")
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.theme).toBe("nord")
		expect(cfg.tone).toBe("light")
	})
})
