/**
 * Best-effort "open URL in default browser". Fire and forget — failures are
 * silent because the URL has already been printed; user can click it.
 */

import { spawn } from "node:child_process"

export const openInBrowser = (url: string): void => {
	const cmd =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
	try {
		const child = spawn(cmd, args, { stdio: "ignore", detached: true })
		child.on("error", () => {})
		child.unref()
	} catch {
		// platform without a launcher; URL was printed already.
	}
}
