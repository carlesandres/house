/**
 * Update-check cache. Stores the last npm-registry probe result on disk so
 * we hit the registry at most once per TTL window.
 *
 * Layout: `$XDG_CACHE_HOME/house/update-check.json` (fallback
 * `~/.cache/house/update-check.json`). All IO failures are non-fatal — a
 * missing or unparseable cache simply forces a fresh probe.
 *
 * Schema is intentionally minimal. `tarballOk` distinguishes "we saw the
 * version and confirmed the tarball is downloadable" from "we saw the
 * version but the CDN HEAD failed" — only the former gates the notice. A
 * `false` entry forces a retry on the next launch rather than waiting out
 * the TTL.
 */

import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"

export interface UpdateCacheRecord {
	readonly checkedAt: number
	readonly latestVersion: string
	readonly tarballOk: boolean
}

export const cacheDir = (): string => {
	const xdg = process.env.XDG_CACHE_HOME
	if (xdg && xdg.length > 0) return join(xdg, "house")
	return join(homedir(), ".cache", "house")
}

export const cachePath = (): string => join(cacheDir(), "update-check.json")

export const readCache = async (path = cachePath()): Promise<UpdateCacheRecord | null> => {
	try {
		const raw = await readFile(path, "utf8")
		const parsed = JSON.parse(raw) as unknown
		if (typeof parsed !== "object" || parsed === null) return null
		const r = parsed as Record<string, unknown>
		if (
			typeof r.checkedAt !== "number" ||
			typeof r.latestVersion !== "string" ||
			typeof r.tarballOk !== "boolean"
		) {
			return null
		}
		return {
			checkedAt: r.checkedAt,
			latestVersion: r.latestVersion,
			tarballOk: r.tarballOk,
		}
	} catch {
		return null
	}
}

export const writeCache = async (record: UpdateCacheRecord, path = cachePath()): Promise<void> => {
	// Atomic write: writeFile to a sibling tmp path, then rename. Rename is
	// atomic on POSIX, so a process.exit() racing the writer either leaves
	// the prior file intact or installs the new one fully — never a partial
	// JSON blob that readCache would have to ignore.
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
	try {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(tmp, JSON.stringify(record), "utf8")
		await rename(tmp, path)
	} catch {
		// Cache writes are best-effort. A read-only HOME or full disk should
		// not break the app; we'll just re-probe on the next launch. Clean up
		// the tmp file if writeFile partially succeeded but rename did not.
		try {
			await unlink(tmp)
		} catch {
			// best-effort
		}
	}
}
