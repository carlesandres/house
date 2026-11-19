import type { BorderCharacters, BorderSides } from "@opentui/core"
import type { ReactNode } from "react"

/** Visual styling of the sidebar frame and rows; unset fields use built-in defaults. */
export interface SidebarAppearance {
	readonly border?: boolean | readonly BorderSides[]
	readonly borderChars?: BorderCharacters
	readonly borderColor?: string
	readonly backgroundColor?: string
	readonly panelColor?: string
	readonly selectedColor?: string
	readonly selectedTextColor?: string
	readonly inactiveOpacity?: number
	readonly horizontalPadding?: number
}

/** Passed to `renderItem` for each visible row. */
export interface SidebarItemRenderContext<TItem> {
	readonly item: TItem
	readonly index: number
	readonly selected: boolean
	readonly width: number
	readonly appearance: SidebarAppearance
}

/** Props for `Sidebar`. The caller owns the items, selection and row rendering. */
export interface SidebarProps<TItem, TId extends string | number> {
	readonly items: readonly TItem[]
	readonly selectedId: TId | null
	readonly getId: (item: TItem) => TId
	readonly renderItem: (context: SidebarItemRenderContext<TItem>) => ReactNode
	readonly width: number
	readonly height: number
	readonly active: boolean
	readonly visible: boolean
	readonly header?: ReactNode
	readonly emptyState?: ReactNode
	readonly appearance?: SidebarAppearance
}
