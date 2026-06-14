import { dirname } from "node:path"
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises"
import { defaultConfigPath } from "./load.ts"

export interface ThemePreference {
	readonly theme: string
	readonly tone: "dark" | "light"
}

let saveQueue: Promise<void> = Promise.resolve()

const encodeTomlString = (value: string): string => JSON.stringify(value)

const upsertTopLevelString = (raw: string, key: keyof ThemePreference, value: string): string => {
	const encoded = encodeTomlString(value)
	const lines = raw.split("\n")
	const keyPattern = new RegExp(`^(\\s*)${key}\\s*=.*$`)
	let inTopLevel = true
	let insertAt = lines.length

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		if (/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(line)) {
			inTopLevel = false
			insertAt = Math.min(insertAt, i)
		}
		if (!inTopLevel) continue
		const match = keyPattern.exec(line)
		if (match) {
			lines[i] = `${match[1]}${key} = ${encoded}`
			return lines.join("\n")
		}
	}

	const insertion = `${key} = ${encoded}`
	if (insertAt === lines.length) {
		if (lines.length === 0 || lines[lines.length - 1] !== "") return `${raw}\n${insertion}\n`
		lines.splice(lines.length - 1, 0, insertion)
		return lines.join("\n")
	}

	lines.splice(insertAt, 0, insertion)
	return lines.join("\n")
}

const updateThemePreferenceToml = (raw: string, record: ThemePreference): string => {
	// Validate the existing file before preserving and editing its text. If the
	// user has malformed TOML, fail loudly rather than replacing it wholesale.
	Bun.TOML.parse(raw)
	return upsertTopLevelString(upsertTopLevelString(raw, "theme", record.theme), "tone", record.tone)
}

const resolveWritableConfigPath = async (path: string): Promise<string> => {
	try {
		const stat = await lstat(path)
		if (stat.isSymbolicLink()) return await realpath(path)
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
	}
	return path
}

const writeThemePreference = async (record: ThemePreference, path: string): Promise<void> => {
	const targetPath = await resolveWritableConfigPath(path)
	path = targetPath
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
	try {
		await mkdir(dirname(path), { recursive: true })
		let next = `theme = ${encodeTomlString(record.theme)}\ntone = ${encodeTomlString(record.tone)}\n`
		try {
			const raw = await readFile(path, "utf8")
			next = updateThemePreferenceToml(raw, record)
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
		}
		await writeFile(tmp, next, "utf8")
		await rename(tmp, path)
	} catch (err) {
		try {
			await unlink(tmp)
		} catch {
			// best-effort cleanup
		}
		throw err
	}
}

export const saveThemePreference = async (
	record: ThemePreference,
	path = defaultConfigPath(),
): Promise<void> => {
	const run = saveQueue.catch(() => {}).then(() => writeThemePreference(record, path))
	saveQueue = run.catch(() => {})
	return run
}
