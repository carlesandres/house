/**
 * CommandPalette — modal overlay for searching and running commands.
 *
 * Render-only: state lives in Browser.tsx alongside filterOpen
 * (#70 design log §state location). Key handling sits in Browser.tsx's
 * `useKeyboard` palette-branch, mirroring the filterOpen pattern.
 *
 * V1 ships a flat list in `browserBindings` order — no category headers,
 * no mouse, no recency. See #91/#93/#94/#95/#96 for the follow-ups.
 */

import { RGBA } from "@opentui/core"
import { colors } from "./theme/colors.ts"
import { PromptRow } from "./PromptRow.tsx"
import type { AppCommand } from "./commands/types.ts"

// Semi-transparent black scrim painted across the viewport behind the modal.
// Opentui composites it over the chrome underneath, so the rest of the UI
// reads as darkened while the modal stays fully opaque. Mirrors opencode's
// dialog backdrop (cli/cmd/tui/ui/dialog.tsx).
const SCRIM = RGBA.fromInts(0, 0, 0, 150)

export interface CommandPaletteProps {
	readonly commands: readonly AppCommand[]
	readonly query: string
	readonly selectedIndex: number
	readonly viewportWidth: number
	readonly viewportHeight: number
}

const FOOTER_HINT = "↑↓ select  enter run  esc close"
const CATEGORY_ORDER = ["Navigation", "View", "File", "Appearance", "App"] as const

type PaletteRow =
	| { readonly kind: "spacer"; readonly key: string }
	| { readonly kind: "header"; readonly key: string; readonly text: string }
	| {
			readonly kind: "command"
			readonly key: string
			readonly command: AppCommand
			readonly commandIndex: number
	  }

const buildRows = (commands: readonly AppCommand[]): readonly PaletteRow[] => {
	const grouped = new Map<string, AppCommand[]>()
	for (const command of commands) {
		const category = command.category ?? "Other"
		const list = grouped.get(category)
		if (list) list.push(command)
		else grouped.set(category, [command])
	}

	const orderedCategories = [
		...CATEGORY_ORDER.filter((category) => grouped.has(category)),
		...Array.from(grouped.keys()).filter((category) => !CATEGORY_ORDER.includes(category as never)),
	]

	const rows: PaletteRow[] = []
	let commandIndex = 0
	for (const [index, category] of orderedCategories.entries()) {
		if (index > 0) rows.push({ kind: "spacer", key: `spacer-${category}` })
		rows.push({ kind: "header", key: `header-${category}`, text: category })
		for (const command of grouped.get(category) ?? []) {
			rows.push({ kind: "command", key: command.id, command, commandIndex })
			commandIndex += 1
		}
	}
	return rows
}

export const CommandPalette = ({
	commands,
	query,
	selectedIndex,
	viewportWidth,
	viewportHeight,
}: CommandPaletteProps) => {
	const overlayWidth = Math.min(viewportWidth - 4, 64)
	// Reserve: 2 for border (top+bottom), 1 query row, 1 spacer below query,
	// 1 spacer above footer, 1 footer row. Body gets the rest.
	const chrome = 2 + 1 + 1 + 1 + 1
	const maxBody = Math.max(1, viewportHeight - 4 - chrome)
	const desiredBody = Math.max(1, commands.length || 1)
	const bodyHeight = Math.min(desiredBody, maxBody)
	const overlayHeight = chrome + bodyHeight
	const left = Math.max(0, Math.floor((viewportWidth - overlayWidth) / 2))
	const top = Math.max(0, Math.floor((viewportHeight - overlayHeight) / 2))

	// Inner content width: overlay minus 1-cell border + 1-cell padding on each side.
	const rowWidth = Math.max(4, overlayWidth - 4)

	// Window the visible slice around the selection. With 9 commands in v1
	// this is usually a no-op (list fits), but the math is in place for the
	// inevitable backlog growth.
	const rows = buildRows(commands)
	const scrollTop = (() => {
		if (rows.length <= bodyHeight) return 0
		const maxScroll = rows.length - bodyHeight
		let s = 0
		const selectedRowIndex = rows.findIndex(
			(row) => row.kind === "command" && row.commandIndex === selectedIndex,
		)
		if (selectedRowIndex >= bodyHeight) s = selectedRowIndex - bodyHeight + 1
		return Math.max(0, Math.min(s, maxScroll))
	})()
	const visible = rows.slice(scrollTop, scrollTop + bodyHeight)

	// Shortcut column width — long enough for `shift+t`-style chords but
	// trimmed to prevent the title from being squeezed below ~16 cells.
	const SHORTCUT_WIDTH = 10
	const titleWidth = Math.max(8, rowWidth - 2 /* selector */ - SHORTCUT_WIDTH - 1 /* gap */)

	const fit = (s: string, width: number): string =>
		s.length === width
			? s
			: s.length > width
				? s.slice(0, Math.max(0, width - 1)) + "…"
				: s + " ".repeat(width - s.length)

	const fitRight = (s: string, width: number): string =>
		s.length >= width ? s.slice(0, width) : " ".repeat(width - s.length) + s

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
				title=" Commands "
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
				<PromptRow query={query} editing={true} width={rowWidth} />
				<text content=" " />
				{commands.length === 0 ? (
					<text wrapMode="none" content="  (no matches)" style={{ fg: colors.textMuted }} />
				) : (
					visible.map((row) => {
						if (row.kind === "spacer") {
							return <text key={row.key} content=" " />
						}
						if (row.kind === "header") {
							return (
								<text
									key={row.key}
									wrapMode="none"
									content={fit(row.text, rowWidth)}
									style={{ fg: colors.textMuted, attributes: 1 }}
								/>
							)
						}
						const cmd = row.command
						const isSelected = row.commandIndex === selectedIndex
						const selector = isSelected ? "▸ " : "  "
						const titleText = fit(cmd.title, titleWidth)
						const shortcutText = cmd.shortcut
							? fitRight(cmd.shortcut, SHORTCUT_WIDTH)
							: " ".repeat(SHORTCUT_WIDTH)
						// Title and shortcut render as separate spans so the shortcut
						// can use `textMuted` while the title uses `text`/`primary`.
						// Same trick opencode pulls with `--text-weak` — the theme
						// guarantees the contrast, we just pick the right role.
						const titleFg = isSelected ? colors.primary : colors.text
						return (
							<text
								key={cmd.id}
								wrapMode="none"
								style={isSelected ? { bg: colors.backgroundElement } : {}}
							>
								<span style={{ fg: titleFg }}>{`${selector}${titleText} `}</span>
								<span style={{ fg: colors.textMuted }}>{shortcutText}</span>
							</text>
						)
					})
				)}
				<text content=" " />
				<text
					wrapMode="none"
					content={fit(FOOTER_HINT, rowWidth)}
					style={{ fg: colors.textMuted }}
				/>
			</box>
		</box>
	)
}
