import { afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Theme/tone changes persist to `$XDG_CONFIG_HOME/house/config.toml` and update checks cache under
// `$XDG_CACHE_HOME`; keep tests away from the user's real dirs. Spawned children only inherit this
// when given `env: { ...process.env }`.
const xdgHome = mkdtempSync(join(tmpdir(), "house-test-xdg-"))
process.env["XDG_CONFIG_HOME"] = join(xdgHome, "config")
process.env["XDG_CACHE_HOME"] = join(xdgHome, "cache")
afterAll(() => rmSync(xdgHome, { recursive: true, force: true }))
