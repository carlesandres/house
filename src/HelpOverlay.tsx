/**
 * HelpOverlay — modal panel listing the keymap.
 *
 * Renders absolute-positioned over the rest of the UI. Iterates the
 * KeyBinding[] array directly; there is no separate hand-written list of
 * keys — the dispatcher and the help text are the same source of truth.
 */

import { RGBA } from "@opentui/core"
import type { KeyBinding } from "./keymap/keymap.ts"
import { colors } from "./theme/colors.ts"

// See CommandPalette.tsx for the scrim rationale.
const SCRIM = RGBA.fromInts(0, 0, 0, 150)

export interface HelpOverlayProps<C> {
	readonly bindings: readonly KeyBinding<C>[]
	readonly viewportWidth: number
	readonly viewportHeight: number
}

const formatKeys = (keys: readonly string[]): string => keys.join(", ")

interface Row {
	readonly key: string
	readonly text: string
	readonly kind: "header" | "binding" | "spacer" | "footer"
}

const buildRows = <C,>(bindings: readonly KeyBinding<C>[]): Row[] => {
	const order: string[] = []
	const grouped = new Map<string, KeyBinding<C>[]>()
	for (const b of bindings) {
		if (!b.group) continue
		if (!grouped.has(b.group)) {
			grouped.set(b.group, [])
			order.push(b.group)
		}
		grouped.get(b.group)!.push(b)
	}

	// Width of the keys column: longest formatted-keys string across all
	// shown bindings, plus a small gap before descriptions.
	let keyColumn = 0
	for (const list of grouped.values()) {
		for (const b of list) keyColumn = Math.max(keyColumn, formatKeys(b.keys).length)
	}
	const gap = 2
	const padTo = keyColumn + gap

	const rows: Row[] = []
	for (let i = 0; i < order.length; i++) {
		const group = order[i]!
		// A spacer before *every* group, including the first. Without one
		// before the first, opentui collapses the header onto the first
		// binding row — appears to be an interaction between the title
		// border and the first child of a padded column.
		rows.push({ key: `spacer-before-${group}`, text: " ", kind: "spacer" })
		rows.push({ key: `header-${group}`, text: group, kind: "header" })
		for (const b of grouped.get(group)!) {
			rows.push({
				key: `binding-${b.id}`,
				text: `  ${formatKeys(b.keys).padEnd(padTo)}${b.description}`,
				kind: "binding",
			})
		}
	}
	rows.push({ key: "spacer-footer", text: " ", kind: "spacer" })
	rows.push({ key: "footer", text: "press ? or esc to dismiss", kind: "footer" })
	return rows
}

export const HelpOverlay = <C,>({
	bindings,
	viewportWidth,
	viewportHeight,
}: HelpOverlayProps<C>) => {
	const rows = buildRows(bindings)

	const overlayWidth = Math.min(viewportWidth - 4, 64)
	const desiredHeight = rows.length + 2 // border top + bottom
	const overlayHeight = Math.min(viewportHeight - 4, desiredHeight + 2) // +2 for vertical padding
	const left = Math.max(0, Math.floor((viewportWidth - overlayWidth) / 2))
	const top = Math.max(0, Math.floor((viewportHeight - overlayHeight) / 2))

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width={viewportWidth}
			height={viewportHeight}
			zIndex={10}
			style={{ backgroundColor: SCRIM }}
		>
			<box
				position="absolute"
				left={left}
				top={top}
				width={overlayWidth}
				height={overlayHeight}
				title=" Help "
				titleAlignment="left"
				style={{
					border: true,
					borderColor: colors.borderActive,
					padding: 1,
					flexDirection: "column",
					backgroundColor: colors.surface,
				}}
			>
				{rows.map((row) => {
					switch (row.kind) {
						case "header":
							return (
								<text
									key={row.key}
									wrapMode="none"
									content={row.text}
									style={{ fg: colors.borderActive, attributes: 1 /* bold */ }}
								/>
							)
						case "footer":
							return (
								<text
									key={row.key}
									wrapMode="none"
									content={row.text}
									style={{ fg: colors.textMuted }}
								/>
							)
						case "spacer":
							return <text key={row.key} content=" " />
						case "binding":
							return (
								<text
									key={row.key}
									wrapMode="none"
									content={row.text}
									style={{ fg: colors.text }}
								/>
							)
					}
				})}
			</box>
		</box>
	)
}
