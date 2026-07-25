import type { BorderSides } from "@opentui/core"
import { useEffect, useState } from "react"
import type { FileEntry } from "./discovery/walk.ts"
import { FOOTER_HEIGHT } from "./Footer.tsx"
import { HEADER_HEIGHT } from "./Header.tsx"
import { fitSidebarEmptyValue } from "./layout/sidebarEmptyState.ts"
import { formatSidebarRow } from "./layout/sidebarRow.ts"
import { PromptRow } from "./PromptRow.tsx"
import { colors } from "./theme/colors.ts"
import { middleTruncate } from "./ui/middleTruncate.ts"

/** Inputs for the House-specific sidebar pane. Browser retains all product state. */
export interface SidebarProps {
	readonly files: readonly FileEntry[]
	readonly displayedFiles: readonly FileEntry[]
	readonly selectedIndex: number
	readonly filterInput: string
	readonly filterApplied: string
	readonly filterOpen: boolean
	readonly discoveryActive: boolean
	readonly rootLabel: string
	readonly viewportHeight: number
	readonly paneWidth: number
	readonly narrow: boolean
	readonly active: boolean
	readonly visible: boolean
}

const SidebarEmptyMessage = ({
	label,
	value,
	width,
	withTopSpacer,
}: {
	readonly label: string
	readonly value: string
	readonly width: number
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
			<text wrapMode="none">
				<span style={{ fg: colors.textMuted }}>{label}</span>
			</text>
			<text wrapMode="none">
				<span style={{ fg: colors.textMuted }}>{`"${fitSidebarEmptyValue(value, width)}"`}</span>
			</text>
		</box>
	</>
)

const SIDEBAR_BORDER_SIDES: BorderSides[] = ["top", "bottom", "right"]
const NARROW_BORDER_SIDES: BorderSides[] = ["top", "bottom"]
const SIDEBAR_BORDER_CHARS = {
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

/** Renders the local file sidebar frame, virtualized rows, and filter chrome. */
export const Sidebar = ({
	files,
	displayedFiles,
	selectedIndex,
	filterInput,
	filterApplied,
	filterOpen,
	discoveryActive,
	rootLabel,
	viewportHeight,
	paneWidth,
	narrow,
	active,
	visible,
}: SidebarProps) => {
	const [sidebarScroll, setSidebarScroll] = useState<number>(0)
	const filterRowVisible = files.length > 0 || discoveryActive
	const sidebarBodyHeight = Math.max(
		1,
		viewportHeight - FOOTER_HEIGHT - HEADER_HEIGHT - 2 - (filterRowVisible ? 1 : 0),
	)
	const maxScroll = Math.max(0, displayedFiles.length - sidebarBodyHeight)
	const desiredScroll = (() => {
		let scroll = sidebarScroll
		if (selectedIndex < scroll) scroll = selectedIndex
		else if (selectedIndex >= scroll + sidebarBodyHeight) {
			scroll = selectedIndex - sidebarBodyHeight + 1
		}
		return Math.max(0, Math.min(maxScroll, scroll))
	})()

	useEffect(() => {
		if (desiredScroll !== sidebarScroll) setSidebarScroll(desiredScroll)
	}, [desiredScroll, sidebarScroll])

	const visibleFiles = displayedFiles.slice(desiredScroll, desiredScroll + sidebarBodyHeight)
	const sidebarTextWidth = Math.max(4, paneWidth - (narrow ? 1 : 2))

	if (!visible) return null

	return (
		<box
			style={{
				border: narrow ? NARROW_BORDER_SIDES : SIDEBAR_BORDER_SIDES,
				borderColor: colors.border,
				...(narrow ? { flexGrow: 1, flexShrink: 1 } : { width: paneWidth, flexShrink: 0 }),
				flexDirection: "column",
				backgroundColor: colors.backgroundPanel,
			}}
			{...(narrow ? {} : { customBorderChars: SIDEBAR_BORDER_CHARS })}
		>
			<box
				style={{
					flexGrow: 1,
					flexShrink: 1,
					flexDirection: "column",
					paddingLeft: 1,
					backgroundColor: active ? colors.background : colors.backgroundPanel,
					opacity: active ? 1 : INACTIVE_PANE_OPACITY,
				}}
			>
				{filterRowVisible && (
					<PromptRow
						query={filterInput}
						editing={filterOpen}
						placeholder="type / to filter"
						width={sidebarTextWidth}
					/>
				)}
				{displayedFiles.length === 0 ? (
					<SidebarEmptyMessage
						withTopSpacer={filterRowVisible}
						width={sidebarTextWidth}
						label={
							files.length === 0
								? discoveryActive
									? "Scanning"
									: "No markdown files in"
								: "No files match"
						}
						value={files.length === 0 ? (discoveryActive ? "…" : rootLabel) : filterApplied}
					/>
				) : (
					visibleFiles.map((file, idx) => {
						const realIdx = desiredScroll + idx
						const isSelected = realIdx === selectedIndex
						const { basename, separator, parent } = formatSidebarRow(
							file.relativePath,
							sidebarTextWidth,
						)
						const basenameFg = isSelected ? colors.selectedListItemText : colors.text
						const rowStyle = {
							width: sidebarTextWidth,
							height: 1,
							flexDirection: "row",
							...(isSelected ? { backgroundColor: colors.backgroundElement } : {}),
						} as const
						return (
							<box key={file.path} style={rowStyle}>
								<text wrapMode="none">
									<span style={{ fg: basenameFg }}>{basename}</span>
									{parent !== "" && (
										<span style={{ fg: colors.textMuted }}>
											{middleTruncate(
												`${separator}${parent}`,
												Math.max(0, sidebarTextWidth - basename.length),
											)}
										</span>
									)}
								</text>
							</box>
						)
					})
				)}
			</box>
		</box>
	)
}
