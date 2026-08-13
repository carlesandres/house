import type { BorderSides } from "@opentui/core"
import { useEffect, useState } from "react"
import type { SidebarProps } from "./types.ts"

const DEFAULT_APPEARANCE = {
	border: ["top", "right", "bottom", "left"] as const,
	borderColor: "#4b5563",
	backgroundColor: "#111827",
	panelColor: "#1f2937",
	selectedColor: "#374151",
	selectedTextColor: "#f9fafb",
	inactiveOpacity: 0.62,
	horizontalPadding: 1,
}

const borderCount = (border: boolean | readonly BorderSides[]): number => {
	if (border === true) return 2
	if (border === false) return 0
	return Number(border.includes("left")) + Number(border.includes("right"))
}

export const Sidebar = <TItem, TId extends string | number>({
	items,
	selectedId,
	getId,
	renderItem,
	width,
	height,
	active,
	visible,
	header,
	emptyState,
	appearance,
}: SidebarProps<TItem, TId>) => {
	const [scroll, setScroll] = useState(0)
	const resolved = { ...DEFAULT_APPEARANCE, ...appearance }
	const hasHeader = header !== undefined && header !== null && header !== false
	const visibleRows = Math.max(1, height - 2 - (hasHeader ? 1 : 0))
	const selectedIndex =
		selectedId === null ? null : items.findIndex((item) => getId(item) === selectedId)
	const maxScroll = Math.max(0, items.length - visibleRows)
	const desiredScroll = (() => {
		let next = scroll
		if (selectedIndex !== null && selectedIndex >= 0) {
			if (selectedIndex < next) next = selectedIndex
			else if (selectedIndex >= next + visibleRows) next = selectedIndex - visibleRows + 1
		}
		return Math.max(0, Math.min(maxScroll, next))
	})()

	useEffect(() => {
		if (desiredScroll !== scroll) setScroll(desiredScroll)
	}, [desiredScroll, scroll])

	if (!visible) return null

	const border: boolean | BorderSides[] =
		resolved.border === true || resolved.border === false ? resolved.border : [...resolved.border]
	const rowWidth = Math.max(0, width - borderCount(resolved.border) - resolved.horizontalPadding)
	const visibleItems = items.slice(desiredScroll, desiredScroll + visibleRows)

	return (
		<box
			style={{
				border,
				borderColor: resolved.borderColor,
				width,
				height,
				flexDirection: "column",
				backgroundColor: resolved.panelColor,
			}}
			{...(resolved.borderChars === undefined ? {} : { customBorderChars: resolved.borderChars })}
		>
			<box
				style={{
					flexGrow: 1,
					flexShrink: 1,
					flexDirection: "column",
					paddingLeft: resolved.horizontalPadding,
					backgroundColor: active ? resolved.backgroundColor : resolved.panelColor,
					opacity: active ? 1 : resolved.inactiveOpacity,
				}}
			>
				{header}
				{items.length === 0 ? (
					emptyState === undefined ? (
						<text content="No results found." />
					) : (
						emptyState
					)
				) : (
					visibleItems.map((item, offset) => {
						const index = desiredScroll + offset
						const selected = selectedIndex === index
						return (
							<box
								key={getId(item)}
								style={{
									width: rowWidth,
									height: 1,
									flexDirection: "row",
									...(selected ? { backgroundColor: resolved.selectedColor } : {}),
								}}
							>
								{renderItem({ item, index, selected, width: rowWidth, appearance: resolved })}
							</box>
						)
					})
				)}
			</box>
		</box>
	)
}
