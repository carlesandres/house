import type { FileNavigatorEmptyState, FileNavigatorTheme } from "./types.ts"

const fitValue = (value: string, width: number): string => {
	if (value.length <= width) return value
	if (width <= 1) return value.slice(value.length - 1)
	return "…" + value.slice(value.length - width + 1)
}

/** Renders caller-provided empty-state copy within the navigator body. */
export const NavigatorEmptyState = ({
	emptyState,
	width,
	theme,
	withTopSpacer,
}: {
	readonly emptyState: FileNavigatorEmptyState
	readonly width: number
	readonly theme: FileNavigatorTheme
	readonly withTopSpacer: boolean
}) => (
	<>
		{withTopSpacer && <text content="" />}
		<box
			style={{
				width,
				flexDirection: "row",
				flexWrap: "wrap",
				justifyContent: "center",
				gap: 1,
			}}
		>
			<text content={emptyState.label} wrapMode="none" style={{ fg: theme.textMuted }} />
			<text
				content={`"${fitValue(emptyState.value, width)}"`}
				wrapMode="none"
				style={{ fg: theme.textMuted }}
			/>
		</box>
	</>
)
