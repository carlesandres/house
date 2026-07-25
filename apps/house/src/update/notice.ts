/**
 * Notice formatting for the update check. Kept separate from the probe so
 * the surfaces (in-app footer, quit-time stderr print) can be reshaped
 * without touching the network or cache code.
 *
 * Install-method note: we don't try to detect npm vs bun vs Homebrew. The
 * runtime probe (`process.versions.bun`) only tells us how house was
 * launched, not how it was installed — a user who ran `npm i -g …` and
 * then happens to invoke via a bun-installed shim would be misled.
 * Showing both commands is unambiguous and lets the user pick the one
 * matching their install.
 */

import type { UpdateInfo } from "./check.ts"

/** One-liner for the footer toast — must fit a tight viewport. */
export const formatFooterNotice = (info: UpdateInfo): string =>
	`update available: ${info.latestVersion} (current ${info.currentVersion})`

/** Multi-line block printed to stderr after the renderer tears down. The
 *  user keeps this in scrollback and can copy the command directly. */
export const formatQuitNotice = (info: UpdateInfo): string =>
	[
		"",
		`house ${info.latestVersion} is available (you have ${info.currentVersion}).`,
		`  npm i -g ${info.pkgName}`,
		`  bun add -g ${info.pkgName}`,
		"",
	].join("\n")
