/**
 * Resolve `$VISUAL` / `$EDITOR` into a spawnable `{ cmd, args }`.
 *
 * The string is POSIX shell-split so users with values like
 * `code --wait` or `"/Applications/Sublime Text/subl" --wait` get the
 * expected argv. We deliberately do *not* shell out via `sh -c`: the
 * caller appends the file path as a separate argv element, which avoids
 * command-injection risk for paths containing shell metacharacters.
 *
 * Resolution order: `$VISUAL` → `$EDITOR` → `null`. No silent fallback to
 * `vi`; the caller surfaces a footer notice when neither is set.
 */

export interface ResolvedEditor {
	readonly cmd: string
	readonly args: readonly string[]
}

/**
 * Split a command string the way `sh` would for the simple cases users
 * actually put in `$EDITOR`: single quotes (literal), double quotes
 * (with `\"`, `\\` escapes), backslash escapes outside quotes, and
 * whitespace separation. No variable expansion, no globbing, no command
 * substitution — by design. If the input is unbalanced (an unclosed
 * quote), the partial token is emitted as-is so the caller's spawn
 * surfaces a real error instead of us throwing.
 */
export const splitEditorString = (input: string): string[] => {
	const tokens: string[] = []
	let buf = ""
	let inSingle = false
	let inDouble = false
	let pendingToken = false

	for (let i = 0; i < input.length; i++) {
		const ch = input[i]!
		if (inSingle) {
			if (ch === "'") inSingle = false
			else buf += ch
			continue
		}
		if (inDouble) {
			if (ch === "\\" && i + 1 < input.length) {
				const next = input[i + 1]!
				// In double quotes, `sh` only treats `\` as an escape before
				// `$`, `` ` ``, `"`, `\`, or newline. Otherwise the backslash
				// is literal. We collapse it for `"` and `\` (the cases users
				// hit with Windows-style paths in double quotes) and keep it
				// literal otherwise.
				if (next === '"' || next === "\\") {
					buf += next
					i++
					continue
				}
			}
			if (ch === '"') {
				inDouble = false
				continue
			}
			buf += ch
			continue
		}
		if (ch === "'") {
			inSingle = true
			pendingToken = true
			continue
		}
		if (ch === '"') {
			inDouble = true
			pendingToken = true
			continue
		}
		if (ch === "\\" && i + 1 < input.length) {
			buf += input[i + 1]!
			i++
			pendingToken = true
			continue
		}
		if (ch === " " || ch === "\t") {
			if (pendingToken) {
				tokens.push(buf)
				buf = ""
				pendingToken = false
			}
			continue
		}
		buf += ch
		pendingToken = true
	}
	if (pendingToken) tokens.push(buf)
	return tokens
}

/**
 * Pick the user's editor from env vars. Returns `null` when neither
 * `$VISUAL` nor `$EDITOR` is set to a non-empty, non-whitespace value.
 *
 * `env` is parameterised so tests don't need to mutate `process.env`.
 */
export const resolveEditor = (
	env: Readonly<Record<string, string | undefined>>,
): ResolvedEditor | null => {
	const raw = pickEnv(env["VISUAL"]) ?? pickEnv(env["EDITOR"])
	if (raw == null) return null
	const parts = splitEditorString(raw)
	if (parts.length === 0) return null
	const [cmd, ...args] = parts
	if (!cmd) return null
	return { cmd, args }
}

const pickEnv = (value: string | undefined): string | null => {
	if (value == null) return null
	const trimmed = value.trim()
	return trimmed.length === 0 ? null : trimmed
}

/** Result of a launched editor session. Never throws — every failure is
 *  surfaced as a tagged value so the caller can decide UX. */
export type EditorRunResult =
	| { readonly ok: true; readonly exitCode: number }
	| {
			readonly ok: false
			readonly reason: "spawn-failed" | "non-zero"
			readonly detail?: string
	  }

export interface OpenInEditorOptions {
	readonly editor: ResolvedEditor
	readonly filePath: string
}

/**
 * Launch the resolved editor on `filePath`, inheriting stdio so the
 * editor takes over the TTY. Caller is responsible for suspending /
 * resuming the renderer around this call (see Browser.tsx).
 *
 * The file path is passed as a separate argv element — never interpolated
 * into a shell string — so paths with shell metacharacters can't be
 * misinterpreted.
 *
 * Windows note: `Bun.spawn` resolves bare names against PATH but does not
 * walk PATHEXT, so `.cmd` shims (typical for `code`, `nvim`, etc. on
 * Windows) won't resolve. POSIX-only for now; Windows handling is a
 * follow-up.
 */
export const openInEditor = async ({
	editor,
	filePath,
}: OpenInEditorOptions): Promise<EditorRunResult> => {
	const argv = [editor.cmd, ...editor.args, filePath]
	try {
		const proc = Bun.spawn(argv, {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		})
		const exitCode = await proc.exited
		if (exitCode === 0) return { ok: true, exitCode }
		return { ok: false, reason: "non-zero", detail: String(exitCode) }
	} catch (err) {
		return { ok: false, reason: "spawn-failed", detail: String(err) }
	}
}
