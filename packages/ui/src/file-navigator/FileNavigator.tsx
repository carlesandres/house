import type { BorderSides } from "@opentui/core"
import { Sidebar } from "../sidebar/index.ts"
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
}: FileNavigatorProps<TFile, TId>) => (
	<Sidebar
		items={controller.filteredFiles}
		selectedId={controller.selectedFile === null ? null : controller.getId(controller.selectedFile)}
		getId={controller.getId}
		width={width}
		height={paneHeight}
		active={active}
		visible={visible}
		header={header}
		emptyState={
			emptyState === undefined ? null : (
				<NavigatorEmptyState
					emptyState={emptyState}
					width={Math.max(4, width - (variant === "inline" ? 2 : 1))}
					theme={theme}
					withTopSpacer={header !== undefined && header !== null && header !== false}
				/>
			)
		}
		renderItem={({ item, index, selected, width: rowWidth }) =>
			renderFile ? (
				renderFile({ file: item, index, selected, width: rowWidth, theme })
			) : (
				<DefaultFileRow
					path={controller.getPath(item)}
					selected={selected}
					width={rowWidth}
					theme={theme}
				/>
			)
		}
		appearance={{
			border: variant === "inline" ? INLINE_BORDER_SIDES : STACKED_BORDER_SIDES,
			...(variant === "inline" ? { borderChars: INLINE_BORDER_CHARS } : {}),
			borderColor: theme.border,
			backgroundColor: theme.background,
			panelColor: theme.backgroundPanel,
			selectedColor: theme.backgroundElement,
			selectedTextColor: theme.selectedListItemText,
			horizontalPadding: 1,
		}}
	/>
)
