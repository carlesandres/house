import { dirname } from "node:path"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { defaultConfigPath } from "./load.ts"

export interface ThemePreference {
	readonly theme: string
	readonly tone: "dark" | "light"
}

const isThemePreference = (value: unknown): value is ThemePreference => {
	if (typeof value !== "object" || value === null) return false
	const r = value as Record<string, unknown>
	return typeof r.theme === "string" && (r.tone === "dark" || r.tone === "light")
}

const stringifyTomlValue = (value: unknown): string | null => {
	if (typeof value === "string") return JSON.stringify(value)
	if (typeof value === "number" && Number.isFinite(value)) return String(value)
	if (typeof value === "boolean") return String(value)
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`
	}
	return null
}

const serializeToml = (record: Record<string, unknown>): string =>
	Object.entries(record)
		.map(([key, value]) => {
			const encoded = stringifyTomlValue(value)
			return encoded === null ? null : `${key} = ${encoded}`
		})
		.filter((line): line is string => line !== null)
		.join("\n") + "\n"

export const saveThemePreference = async (
	record: ThemePreference,
	path = defaultConfigPath(),
): Promise<void> => {
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
	try {
		await mkdir(dirname(path), { recursive: true })
		let merged: ThemePreference = record
		let extra: Record<string, unknown> = {}
		try {
			const raw = await readFile(path, "utf8")
			const parsed = Bun.TOML.parse(raw) as unknown
			if (typeof parsed === "object" && parsed !== null) {
				extra = parsed as Record<string, unknown>
				if (isThemePreference(parsed)) {
					merged = { ...parsed, ...record }
				}
			}
		} catch {
			// Missing or unreadable config falls back to the new record.
		}
		await writeFile(tmp, serializeToml({ ...extra, ...merged }), "utf8")
		await rename(tmp, path)
	} catch {
		try {
			await unlink(tmp)
		} catch {
			// best-effort cleanup
		}
	}
}
