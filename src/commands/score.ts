/**
 * Command palette scorer — ported from ghui's pre-May `commands.ts`.
 *
 * Tiered ranking: title-prefix → text-prefix → title-includes →
 * text-includes → acronym → fuzzy-includes. Lower score wins. Ties broken
 * by `browserBindings` array order (the `index` field) so the empty-query
 * palette renders in the keymap's natural order. See #70 design log for
 * why we didn't reach for `fuzzysort`.
 */

import type { AppCommand } from "./types.ts"

const normalize = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9#]+/g, " ")
		.trim()

const acronym = (text: string): string =>
	normalize(text)
		.split(" ")
		.filter(Boolean)
		.map((word) => word[0])
		.join("")

const fuzzyIncludes = (text: string, query: string): boolean => {
	let index = 0
	for (const char of text) {
		if (char === query[index]) index++
		if (index >= query.length) return true
	}
	return query.length === 0
}

const searchText = (command: AppCommand): string =>
	normalize(
		[command.title, command.category, command.shortcut, ...(command.keywords ?? [])]
			.filter((s): s is string => Boolean(s))
			.join(" "),
	)

/** Returns the tier (lower = better) or `null` if the query doesn't match. */
const score = (command: AppCommand, query: string): number | null => {
	const q = normalize(query)
	if (q.length === 0) return 0
	const title = normalize(command.title)
	const text = searchText(command)
	if (title.startsWith(q)) return 0
	if (text.startsWith(q)) return 1
	if (title.includes(q)) return 2
	if (text.includes(q)) return 3
	if (acronym(command.title).startsWith(q)) return 4
	if (fuzzyIncludes(text, q.replaceAll(" ", ""))) return 5
	return null
}

/**
 * Filter and sort commands against a query. With an empty query, every
 * command tiers to 0 and the original index breaks ties — so the result is
 * the input list in its original order (which v1 uses as `browserBindings`
 * order). See #70 design log §empty-state ordering.
 */
export const filterCommands = (
	commands: readonly AppCommand[],
	query: string,
): readonly AppCommand[] =>
	commands
		.flatMap((command, index) => {
			const tier = score(command, query)
			return tier === null ? [] : [{ command, index, tier }]
		})
		.sort((a, b) => a.tier - b.tier || a.index - b.index)
		.map(({ command }) => command)

export const clampSelectedIndex = (index: number, commands: readonly AppCommand[]): number => {
	if (commands.length === 0) return 0
	return Math.max(0, Math.min(commands.length - 1, index))
}
