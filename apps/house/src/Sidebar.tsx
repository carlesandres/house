import { FileNavigator } from "@house/ui"
import type { FileNavigatorController, FileNavigatorEmptyState } from "@house/ui"
import type { FileEntry } from "./discovery/walk.ts"
import { FOOTER_HEIGHT } from "./Footer.tsx"
import { HEADER_HEIGHT } from "./Header.tsx"
import { PromptRow } from "./PromptRow.tsx"
import { colors } from "./theme/colors.ts"

/** Inputs for the House-specific file navigator adapter. */
export interface SidebarProps {
	readonly files: readonly FileEntry[]
	readonly controller: FileNavigatorController<FileEntry, string>
	readonly filterInput: string
	readonly filterOpen: boolean
	readonly discoveryActive: boolean
	readonly rootLabel: string
	readonly viewportHeight: number
	readonly paneWidth: number
	readonly narrow: boolean
	readonly active: boolean
	readonly visible: boolean
}

/** Maps House product copy, dimensions, and theme tokens into the shared navigator. */
export const Sidebar = ({
	files,
	controller,
	filterInput,
	filterOpen,
	discoveryActive,
	rootLabel,
	viewportHeight,
	paneWidth,
	narrow,
	active,
	visible,
}: SidebarProps) => {
	const headerVisible = files.length > 0 || discoveryActive
	const emptyState: FileNavigatorEmptyState | undefined =
		controller.filteredFiles.length > 0
			? undefined
			: files.length === 0
				? discoveryActive
					? { label: "Scanning", value: "…" }
					: { label: "No markdown files in", value: rootLabel }
				: { label: "No files match", value: controller.appliedQuery }
	const rowWidth = Math.max(4, paneWidth - (narrow ? 1 : 2))

	return (
		<FileNavigator
			controller={controller}
			width={paneWidth}
			paneHeight={Math.max(1, viewportHeight - HEADER_HEIGHT - FOOTER_HEIGHT)}
			variant={narrow ? "stacked" : "inline"}
			active={active}
			visible={visible}
			theme={{
				background: colors.background,
				backgroundPanel: colors.backgroundPanel,
				backgroundElement: colors.backgroundElement,
				text: colors.text,
				textMuted: colors.textMuted,
				border: colors.border,
				selectedListItemText: colors.selectedListItemText,
			}}
			{...(headerVisible
				? {
						header: (
							<PromptRow
								query={filterInput}
								editing={filterOpen}
								placeholder="type / to filter"
								width={rowWidth}
							/>
						),
					}
				: {})}
			{...(emptyState === undefined ? {} : { emptyState })}
		/>
	)
}
