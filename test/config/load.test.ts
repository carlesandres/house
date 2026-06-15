import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { loadConfig } from "../../src/config/load.ts"

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
			extensions: [],
			width: 80,
			wrap: false,
			show: [],
			focus: "sidebar",
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
})
