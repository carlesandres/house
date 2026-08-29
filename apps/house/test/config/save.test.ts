import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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

	test("preserves existing comments and formatting", async () => {
		await writeFile(
			cfgPath,
			'# keep my comment\nextensions = ["mdx"]\n\ntheme = "opencode"\ntone = "dark"\n',
			"utf8",
		)
		await saveThemePreference({ theme: "nord", tone: "light" }, cfgPath)
		const raw = await readFile(cfgPath, "utf8")
		expect(raw).toBe('# keep my comment\nextensions = ["mdx"]\n\ntheme = "nord"\ntone = "light"\n')
	})

	test("inserts missing theme keys before TOML tables", async () => {
		await writeFile(cfgPath, '# config\nextensions = ["mdx"]\n\n[future]\nname = "kept"\n', "utf8")
		await saveThemePreference({ theme: "nord", tone: "light" }, cfgPath)
		const raw = await readFile(cfgPath, "utf8")
		expect(raw).toBe(
			'# config\nextensions = ["mdx"]\n\ntheme = "nord"\ntone = "light"\n[future]\nname = "kept"\n',
		)
	})

	test("serializes rapid saves so the latest call wins", async () => {
		await Promise.all([
			saveThemePreference({ theme: "opencode", tone: "dark" }, cfgPath),
			saveThemePreference({ theme: "nord", tone: "light" }, cfgPath),
			saveThemePreference({ theme: "vercel", tone: "dark" }, cfgPath),
		])
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg).toMatchObject({ theme: "vercel", tone: "dark" })
	})

	test("reports write failures to callers", async () => {
		await mkdir(cfgPath)
		await expect(saveThemePreference({ theme: "nord", tone: "light" }, cfgPath)).rejects.toThrow()
	})

	test("does not overwrite malformed TOML", async () => {
		await writeFile(cfgPath, 'theme = "opencode"\ntone =', "utf8")
		await expect(saveThemePreference({ theme: "nord", tone: "light" }, cfgPath)).rejects.toThrow()
		await expect(readFile(cfgPath, "utf8")).resolves.toBe('theme = "opencode"\ntone =')
	})

	test("preserves symlinked config files", async () => {
		const targetPath = join(dir, "dotfiles", "house.toml")
		await mkdir(dirname(targetPath), { recursive: true })
		await writeFile(targetPath, 'theme = "opencode"\ntone = "dark"\n', "utf8")
		await symlink(targetPath, cfgPath)

		await saveThemePreference({ theme: "nord", tone: "light" }, cfgPath)

		expect((await lstat(cfgPath)).isSymbolicLink()).toBe(true)
		await expect(readFile(targetPath, "utf8")).resolves.toBe('theme = "nord"\ntone = "light"\n')
	})

	test("round-trips through the normal loader", async () => {
		await saveThemePreference({ theme: "vercel", tone: "dark" }, cfgPath)
		const cfg = await run(loadConfig({ filePath: cfgPath, env: {} }))
		expect(cfg.theme).toBe("vercel")
		expect(cfg.tone).toBe("dark")
	})
})
