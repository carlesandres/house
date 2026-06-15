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
				cli: { theme: null, tone: null, extensions: ["log"], show: null, focus: null },
			}),
		)
		expect(cfg.extensions).toEqual(["log"])
	})
})
