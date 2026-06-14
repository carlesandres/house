/**
 * Middle truncation for technical strings.
 *
 * Keeps the start and end of a string visible while compressing the middle
 * to a single ellipsis glyph (`…`). Use for paths, IDs, branch names, and
 * other values whose head and tail both matter.
 */

export interface MiddleTruncateOptions {
	readonly ellipsis?: string
}

export const middleTruncate = (
	value: string,
	width: number,
	options: MiddleTruncateOptions = {},
): string => {
	const ellipsis = options.ellipsis ?? "…"
	if (width <= 0) return ""
	if (value.length <= width) return value
	if (width <= ellipsis.length) return value.slice(0, width)

	const available = width - ellipsis.length
	const left = Math.ceil(available / 2)
	const right = Math.floor(available / 2)
	return value.slice(0, left) + ellipsis + value.slice(value.length - right)
}
