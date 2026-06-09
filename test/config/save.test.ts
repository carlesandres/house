import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { loadConfig } from "../../src/config/load.ts"
import { saveThemePreference } from "../../src/config/save.ts"

let dir: string
let cfgPath: string

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "house-save-"))
	cfgPath = join(dir, "config.toml")
})

afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff as Effect.Effect<A, E>)

describe("saveThemePreference", () => {
	test("writes a fresh theme config", async () => {
		await saveThemePreference({ theme: "nord", tone: "light" }, cfgPath)
		const raw = await readFile(cfgPath, "utf8")
		expect(raw).toContain('theme = "nord"')
		expect(raw).toContain('tone = "light"')
	})

	test("merges over an existing config file", async () => {
		await writeFile(cfgPath, 'extensions = ["mdx"]\ntheme = "opencode"\ntone = "dark"\n', "utf8")
		await saveThemePreference({ theme: "nord", tone: "light" }, cfgPath)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg).toMatchObject({ theme: "nord", tone: "light", extensions: ["mdx"] })
	})

	test("round-trips through the normal loader", async () => {
		await saveThemePreference({ theme: "vercel", tone: "dark" }, cfgPath)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.theme).toBe("vercel")
		expect(cfg.tone).toBe("dark")
	})
})
