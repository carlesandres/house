/**
 * PromptRow — single-line `> query` row shared by the sidebar filter,
 * command palette, and name prompts.
 *
 * While editing, the body is OpenTUI `<input>` so left/right/home/end and
 * in-place insert/delete work. Overlay chords (Esc, Enter, Up/Down, ctrl+p, ctrl+c)
 * stay in Browser's useKeyboard branch and call preventDefault.
 *
 * Idle / applied filter state stays render-only text (no native input).
 */

import { useLayoutEffect } from "react"
import { colors } from "./theme/colors.ts"

export interface PromptRowProps {
	readonly query: string
	/** True while the input is focused — uses OpenTUI `<input>` for editing. */
	readonly editing: boolean
	/** Body fallback when !editing && query === "". Pass without the `> ` prefix. */
	readonly placeholder?: string
	/** When set, an empty editing field still shows `placeholder` (muted). */
	readonly showPlaceholderWhileEditing?: boolean
	/** Total cell width available for the row (prefix + body). */
	readonly width: number
	/** Called as the native input value changes while editing. */
	readonly onInput?: (value: string) => void
	/** Fired after the native input is focused (and again false on teardown). */
	readonly onEditingReady?: (ready: boolean) => void
}

const PREFIX = "> "

export const PromptRow = ({
	query,
	editing,
	placeholder = "",
	showPlaceholderWhileEditing = false,
	width,
	onInput,
	onEditingReady,
}: PromptRowProps) => {
	const bodyBudget = Math.max(1, width - PREFIX.length)
	const prefixFg = editing ? colors.secondary : colors.primary

	useLayoutEffect(() => {
		onEditingReady?.(editing)
		return () => onEditingReady?.(false)
	}, [editing, onEditingReady])

	if (editing) {
		return (
			<box style={{ flexDirection: "row", width, height: 1, flexShrink: 0 }}>
				<text wrapMode="none">
					<span style={{ fg: prefixFg }}>{PREFIX}</span>
				</text>
				<input
					focused
					value={query}
					placeholder={showPlaceholderWhileEditing ? placeholder : ""}
					{...(onInput === undefined ? {} : { onInput })}
					backgroundColor="transparent"
					focusedBackgroundColor="transparent"
					textColor={colors.primary}
					focusedTextColor={colors.primary}
					cursorColor={colors.primary}
					placeholderColor={colors.textMuted}
					width={bodyBudget}
				/>
			</box>
		)
	}

	const rawBody = query.length > 0 ? query : placeholder
	const bodyFg = query.length > 0 ? colors.text : colors.textMuted
	const body = rawBody.length <= bodyBudget ? rawBody : rawBody.slice(0, bodyBudget - 1) + "…"

	return (
		<text wrapMode="none">
			<span style={{ fg: prefixFg }}>{PREFIX}</span>
			<span style={{ fg: bodyFg }}>{body}</span>
		</text>
	)
}
