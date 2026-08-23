/**
 * PromptModal — centered overlay for a single-line prompt.
 *
 * Render-only: Browser owns the value, status messages, and keyboard.
 * Overlay grammar matches CommandPalette (scrim + bordered box).
 */

import { RGBA } from "@opentui/core"
import { colors } from "./theme/colors.ts"
import { PromptRow } from "./PromptRow.tsx"

const SCRIM = RGBA.fromInts(0, 0, 0, 150)

export type PromptStatusKind = "error" | "warning"

export interface PromptStatus {
	readonly kind: PromptStatusKind
	readonly lines: readonly string[]
}

export interface PromptModalProps {
	readonly title: string
	readonly query: string
	readonly placeholder: string
	readonly hints: string
	readonly status: PromptStatus | null
	readonly viewportWidth: number
	readonly viewportHeight: number
}

const PromptStatusLine = ({
	kind,
	text,
	width,
}: {
	readonly kind: PromptStatusKind
	readonly text: string
	readonly width: number
}) => {
	const content = text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + "…"
	return (
		<text
			wrapMode="none"
			content={content}
			style={{ fg: kind === "error" ? colors.error : colors.warning }}
		/>
	)
}

export const PromptModal = ({
	title,
	query,
	placeholder,
	hints,
	status,
	viewportWidth,
	viewportHeight,
}: PromptModalProps) => {
	const overlayWidth = Math.min(viewportWidth - 4, 64)
	const statusLines = status?.lines ?? []
	const statusHeight = Math.max(1, statusLines.length)
	const overlayHeight = 2 + 1 + statusHeight + 1
	const left = Math.max(0, Math.floor((viewportWidth - overlayWidth) / 2))
	const top = Math.max(0, Math.floor((viewportHeight - overlayHeight) / 2))
	const rowWidth = Math.max(4, overlayWidth - 4)

	const fit = (s: string, width: number): string =>
		s.length === width
			? s
			: s.length > width
				? s.slice(0, Math.max(0, width - 1)) + "…"
				: s + " ".repeat(width - s.length)

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width={viewportWidth}
			height={viewportHeight}
			zIndex={20}
			style={{ backgroundColor: SCRIM }}
		>
			<box
				position="absolute"
				left={left}
				top={top}
				width={overlayWidth}
				height={overlayHeight}
				title={` ${title} `}
				titleAlignment="left"
				paddingLeft={1}
				paddingRight={1}
				style={{
					border: true,
					borderColor: colors.textMuted,
					flexDirection: "column",
					backgroundColor: colors.backgroundPanel,
				}}
			>
				<PromptRow
					query={query}
					editing={true}
					placeholder={placeholder}
					showPlaceholderWhileEditing
					width={rowWidth}
				/>
				{status === null || statusLines.length === 0 ? (
					<text content=" " />
				) : (
					statusLines.map((line, i) => (
						<PromptStatusLine key={i} kind={status.kind} text={line} width={rowWidth} />
					))
				)}
				<text wrapMode="none" content={fit(hints, rowWidth)} style={{ fg: colors.textMuted }} />
			</box>
		</box>
	)
}
