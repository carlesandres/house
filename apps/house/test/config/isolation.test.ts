import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname } from "node:path"
import { defaultConfigPath } from "../../src/config/load.ts"
import { cachePath } from "../../src/update/cache.ts"

// The preload creates only the XDG root; `config`/`cache` appear on first write, so walk up from
// `<root>/config/house/config.toml` (or `<root>/cache/house/update-check.json`) before `realpath`.
const xdgRoot = (path: string, depth: number): string => {
	let dir = path
	for (let i = 0; i < depth; i++) dir = dirname(dir)
	return realpathSync(dir)
}

describe("test XDG isolation", () => {
	const tempRoot = realpathSync(tmpdir())

	test("the config path points into a temp dir, not the user's config", () => {
		expect(xdgRoot(defaultConfigPath(), 3).startsWith(tempRoot)).toBe(true)
	})

	test("the update-check cache points into a temp dir, not the user's cache", () => {
		expect(xdgRoot(cachePath(), 3).startsWith(tempRoot)).toBe(true)
	})
})
