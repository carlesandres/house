import type { BorderSides } from "@opentui/core"
import { useEffect, useState } from "react"
import { NavigatorEmptyState } from "./emptyState.tsx"
import { DefaultFileRow } from "./row.tsx"
import type { FileId, FileNavigatorProps } from "./types.ts"

const INLINE_BORDER_SIDES: BorderSides[] = ["top", "bottom", "right"]
const STACKED_BORDER_SIDES: BorderSides[] = ["top", "bottom"]
const INLINE_BORDER_CHARS = {
	topLeft: "┌",
	topRight: "┬",
	bottomLeft: "└",
	bottomRight: "┴",
	horizontal: "─",
	vertical: "│",
	topT: "┬",
	bottomT: "┴",
	leftT: "├",
	rightT: "┤",
	cross: "┼",
} as const
const INACTIVE_PANE_OPACITY = 0.62

/** Renders a complete controlled file navigator pane. */
export const FileNavigator = <TFile, TId extends FileId>({
	controller,
	width,
	paneHeight,
	variant,
	active,
	visible,
	theme,
	header,
	emptyState,
	renderFile,
}: FileNavigatorProps<TFile, TId>) => {
	const [scroll, setScroll] = useState(0)
	const hasHeader = header !== undefined && header !== null && header !== false
	const visibleRows = Math.max(1, paneHeight - 2 - (hasHeader ? 1 : 0))
	const maxScroll = Math.max(0, controller.filteredFiles.length - visibleRows)
	const selectedIndex = controller.selectedIndex
	const desiredScroll = (() => {
		let next = scroll
		if (selectedIndex !== null) {
			if (selectedIndex < next) next = selectedIndex
			else if (selectedIndex >= next + visibleRows) next = selectedIndex - visibleRows + 1
		}
		return Math.max(0, Math.min(maxScroll, next))
	})()

	useEffect(() => {
		if (desiredScroll !== scroll) setScroll(desiredScroll)
	}, [desiredScroll, scroll])

	const rowWidth = Math.max(4, width - (variant === "inline" ? 2 : 1))
	const visibleFiles = controller.filteredFiles.slice(desiredScroll, desiredScroll + visibleRows)

	if (!visible) return null

	return (
		<box
			style={{
				border: variant === "inline" ? INLINE_BORDER_SIDES : STACKED_BORDER_SIDES,
				borderColor: theme.border,
				width,
				height: paneHeight,
				...(variant === "inline" ? { flexShrink: 0 } : { flexGrow: 1, flexShrink: 1 }),
				flexDirection: "column",
				backgroundColor: theme.backgroundPanel,
			}}
			{...(variant === "inline" ? { customBorderChars: INLINE_BORDER_CHARS } : {})}
		>
			<box
				style={{
					flexGrow: 1,
					flexShrink: 1,
					flexDirection: "column",
					paddingLeft: 1,
					backgroundColor: active ? theme.background : theme.backgroundPanel,
					opacity: active ? 1 : INACTIVE_PANE_OPACITY,
				}}
			>
				{header}
				{controller.filteredFiles.length === 0
					? emptyState && (
							<NavigatorEmptyState
								emptyState={emptyState}
								width={rowWidth}
								theme={theme}
								withTopSpacer={hasHeader}
							/>
						)
					: visibleFiles.map((file, offset) => {
							const index = desiredScroll + offset
							const selected = index === controller.selectedIndex
							return (
								<box
									key={controller.getId(file)}
									style={{
										width: rowWidth,
										height: 1,
										flexDirection: "row",
										...(selected ? { backgroundColor: theme.backgroundElement } : {}),
									}}
								>
									{renderFile ? (
										renderFile({ file, index, selected, width: rowWidth, theme })
									) : (
										<DefaultFileRow
											path={controller.getPath(file)}
											selected={selected}
											width={rowWidth}
											theme={theme}
										/>
									)}
								</box>
							)
						})}
			</box>
		</box>
	)
}
