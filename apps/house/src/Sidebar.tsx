import { FileNavigator } from "@house/ui/file-navigator"
import type {
	BrowseOrder,
	DiscoveryPolicy,
	FileNavigatorHandle,
	FileNavigatorProps,
	FileNavigatorSnapshot,
} from "@house/ui/file-navigator"
import type { Ref } from "react"
import { FOOTER_HEIGHT } from "./Footer.tsx"
import { HEADER_HEIGHT } from "./Header.tsx"
import { PromptRow } from "./PromptRow.tsx"
import { colors } from "./theme/colors.ts"

/** Inputs for the House-specific file navigator adapter. */
export interface SidebarProps {
	readonly root: string
	readonly policy: DiscoveryPolicy
	readonly watch: boolean
	readonly debounceMs: number
	readonly navigatorRef: Ref<FileNavigatorHandle>
	readonly snapshot: FileNavigatorSnapshot
	readonly filterInput: string
	readonly filterOpen: boolean
	readonly discoveryActive: boolean
	readonly rootLabel: string
	readonly viewportHeight: number
	readonly paneWidth: number
	readonly narrow: boolean
	readonly active: boolean
	readonly visible: boolean
	readonly onSelectionChange: NonNullable<FileNavigatorProps["onSelectionChange"]>
	readonly onSnapshot: NonNullable<FileNavigatorProps["onSnapshot"]>
	readonly onSelectedFileInvalidated: NonNullable<FileNavigatorProps["onSelectedFileInvalidated"]>
	readonly onDiagnostic: NonNullable<FileNavigatorProps["onDiagnostic"]>
	readonly order?: BrowseOrder
}

/** Maps House product copy, dimensions, and theme tokens into the shared navigator. */
export const Sidebar = ({
	root,
	policy,
	watch,
	debounceMs,
	navigatorRef,
	snapshot,
	filterInput,
	filterOpen,
	discoveryActive,
	rootLabel,
	viewportHeight,
	paneWidth,
	narrow,
	active,
	visible,
	onSelectionChange,
	onSnapshot,
	onSelectedFileInvalidated,
	onDiagnostic,
	order = "recently-modified",
}: SidebarProps) => {
	const headerVisible = snapshot.files.length > 0 || discoveryActive
	const emptyState =
		snapshot.filteredFiles.length > 0
			? undefined
			: snapshot.files.length === 0
				? discoveryActive
					? { label: "Scanning", value: "…" }
					: { label: "No markdown files in", value: rootLabel }
				: { label: "No files match", value: snapshot.appliedQuery }
	const rowWidth = Math.max(4, paneWidth - (narrow ? 1 : 2))

	return (
		<FileNavigator
			root={root}
			query={filterInput}
			policy={policy}
			watch={watch}
			order={order}
			debounceMs={debounceMs}
			ref={navigatorRef}
			width={paneWidth}
			height={Math.max(1, viewportHeight - HEADER_HEIGHT - FOOTER_HEIGHT)}
			active={active}
			visible={visible}
			onSelectionChange={onSelectionChange}
			onSnapshot={onSnapshot}
			onSelectedFileInvalidated={onSelectedFileInvalidated}
			onDiagnostic={onDiagnostic}
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
			{...(emptyState === undefined
				? {}
				: {
						renderEmpty: () => (
							<box style={{ width: "100%", alignItems: "center", paddingTop: 1 }}>
								<text
									content={`${emptyState.label}: "${emptyState.value}"`}
									style={{ fg: colors.textMuted }}
								/>
							</box>
						),
					})}
			appearance={{
				border: narrow ? (["top", "bottom"] as const) : (["top", "bottom", "right"] as const),
				borderColor: colors.border,
				backgroundColor: colors.background,
				panelColor: colors.backgroundPanel,
				selectedColor: colors.backgroundElement,
				selectedTextColor: colors.selectedListItemText,
				horizontalPadding: 1,
			}}
		/>
	)
}
