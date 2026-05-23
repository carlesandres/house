/**
 * PromptRow — single-line `> query` row shared by the sidebar filter and
 * the command palette query input.
 *
 * Render-only: the parent owns query state and the focus/editing flag.
 * The `> ` prefix always renders in `textStrong` regardless of state so it
 * reads as chrome, not placeholder text — only the body span shifts color
 * (textStrong while editing, text when applied, textMuted as placeholder).
 *
 * Overflow: when editing, an overflowing body anchors its right edge with a
 * leading `…` so the cursor stays on screen; otherwise it anchors the left
 * edge with a trailing `…`.
 */

import { colors } from "./theme/colors.ts"

export interface PromptRowProps {
	readonly query: string
	/** True while the input is focused — shows a cursor and uses textStrong fg. */
	readonly editing: boolean
	/** Body fallback when !editing && query === "". Pass without the `> ` prefix. */
	readonly placeholder?: string
	/** Total cell width available for the row (prefix + body). */
	readonly width: number
}

const PREFIX = "> "
const CURSOR = "▏"

export const PromptRow = ({ query, editing, placeholder = "", width }: PromptRowProps) => {
	const bodyBudget = Math.max(1, width - PREFIX.length)

	const rawBody = editing ? `${query}${CURSOR}` : query.length > 0 ? query : placeholder
	const bodyFg = editing ? colors.textStrong : query.length > 0 ? colors.text : colors.textMuted

	const body =
		rawBody.length <= bodyBudget
			? rawBody
			: editing
				? "…" + rawBody.slice(rawBody.length - bodyBudget + 1)
				: rawBody.slice(0, bodyBudget - 1) + "…"

	return (
		<text wrapMode="none">
			<span style={{ fg: colors.textStrong }}>{PREFIX}</span>
			<span style={{ fg: bodyFg }}>{body}</span>
		</text>
	)
}
