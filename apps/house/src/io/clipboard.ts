/**
 * Best-effort clipboard write for macOS/Linux.
 *
 * The selected tool is fed through stdin so large or multiline markdown can be
 * copied without shell quoting issues.
 */

export interface ClipboardCommand {
	readonly cmd: string
	readonly args: readonly string[]
}

type WhichFn = (command: string) => string | null | undefined

interface CopyToClipboardDeps {
	readonly platform?: NodeJS.Platform
	readonly which?: WhichFn
	readonly spawn?: (command: ClipboardCommand, text: string) => Promise<number>
}

export const resolveClipboardCommand = (
	platform: NodeJS.Platform,
	which: WhichFn,
): ClipboardCommand | null => {
	if (platform === "darwin") return { cmd: "pbcopy", args: [] }
	if (platform !== "linux") return null
	if (which("wl-copy")) return { cmd: "wl-copy", args: [] }
	if (which("xclip")) return { cmd: "xclip", args: ["-selection", "clipboard"] }
	return null
}

const spawnClipboardCommand = async (command: ClipboardCommand, text: string): Promise<number> => {
	const proc = Bun.spawn([command.cmd, ...command.args], {
		stdin: new Response(text),
		stdout: "ignore",
		stderr: "ignore",
	})
	return await proc.exited
}

export const copyTextToClipboard = async (
	text: string,
	{
		platform = process.platform,
		which = Bun.which.bind(Bun),
		spawn = spawnClipboardCommand,
	}: CopyToClipboardDeps = {},
): Promise<void> => {
	const command = resolveClipboardCommand(platform, which)
	if (!command) throw new Error("no clipboard tool found")
	const exitCode = await spawn(command, text)
	if (exitCode !== 0) throw new Error("clipboard command failed")
}
