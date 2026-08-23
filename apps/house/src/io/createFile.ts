/**
 * Exclusive empty-file create. The only disk write House performs: a new
 * 0-byte file at a caller-chosen path, never an overwrite or truncate.
 */

import { open } from "node:fs/promises"

export type CreateEmptyFileResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: "already-exists"; readonly message?: undefined }
	| { readonly ok: false; readonly reason: "io"; readonly message: string }

export const createEmptyFileExclusive = async (path: string): Promise<CreateEmptyFileResult> => {
	try {
		const handle = await open(path, "wx")
		await handle.close()
		return { ok: true }
	} catch (err) {
		const code = (err as { code?: string } | null)?.code
		if (code === "EEXIST") return { ok: false, reason: "already-exists" }
		const message = err instanceof Error ? err.message : String(err)
		return { ok: false, reason: "io", message }
	}
}
