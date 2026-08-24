/**
 * Pure markdown basename resolver for New file and Rename prompts.
 * Input is the prompt field string; output is a blocking error or a basename
 * plus warnings. Does not touch the filesystem or rewrite the typed field.
 *
 * ADR: Basename Rename via reused PromptModal
 * See: docs/adr/0003-rename-basename-prompt.md
 */

export type ResolveNameMode = "new-file" | "rename"

export type ResolveNameResult =
	| { readonly ok: true; readonly basename: string; readonly warnings: readonly string[] }
	| { readonly ok: false; readonly error: string }

const MD_SUFFIX = /\.md$/i

const pathShapedError = (mode: ResolveNameMode): string =>
	mode === "rename"
		? "name must be a single file name"
		: "name must be a single file in the discovery root"

const hasControlChar = (raw: string): boolean => {
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i)
		if (code <= 0x1f || code === 0x7f) return true
	}
	return false
}

export const resolveMarkdownBasename = (
	raw: string,
	mode: ResolveNameMode = "new-file",
): ResolveNameResult => {
	if (hasControlChar(raw)) return { ok: false, error: "name contains invalid characters" }

	const trimmed = raw.trim()
	if (trimmed.length === 0) return { ok: false, error: "name required" }

	if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
		return { ok: false, error: pathShapedError(mode) }
	}

	if (trimmed.startsWith(".")) return { ok: false, error: "hidden names aren't supported yet" }

	if (trimmed.endsWith(".md")) return { ok: true, basename: trimmed, warnings: [] }

	if (MD_SUFFIX.test(trimmed)) {
		return {
			ok: true,
			basename: `${trimmed.slice(0, -3)}.md`,
			warnings: ["extension will be saved as .md"],
		}
	}

	const basename = `${trimmed}.md`
	return {
		ok: true,
		basename,
		warnings: trimmed.includes(".") ? [`will be created as ${basename}`] : [],
	}
}

/** @deprecated Prefer resolveMarkdownBasename(raw, "new-file") — kept for call-site clarity. */
export const resolveNewFileName = (raw: string): ResolveNameResult =>
	resolveMarkdownBasename(raw, "new-file")
