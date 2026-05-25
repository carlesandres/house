/**
 * Reusable tip definitions derived from the keymap. Surfaces pick a small set
 * of binding ids; the rendered key label always comes from the real binding so
 * copy cannot drift when shortcuts change.
 */

import type { KeyBinding } from "./keymap/keymap.ts"
import { displayKey } from "./keymap/displayKey.ts"

export interface Tip {
	readonly id: string
	readonly key: string
	readonly label: string
}

interface TipDefinition {
	readonly label?: string
}

const tipDefinitions: Readonly<Record<string, TipDefinition>> = {
	"filter.open": { label: "Filter files" },
	"focus.toggle": { label: "Switch focus" },
	"sidebar.toggle": { label: "Toggle sidebar" },
	"help.toggle": { label: "Show help" },
	"theme.next": { label: "Next theme" },
	"theme.prev": { label: "Previous theme" },
	"theme.toneToggle": { label: "Toggle light/dark" },
	quit: { label: "Quit" },
}

export const readerEmptyStateTipIds = [
	"filter.open",
	"focus.toggle",
	"sidebar.toggle",
	"help.toggle",
] as const

export const buildTips = <C>(
	bindings: readonly KeyBinding<C>[],
	tipIds: readonly string[],
): readonly Tip[] => {
	const bindingById = new Map(bindings.map((binding) => [binding.id, binding]))
	const out: Tip[] = []

	for (const id of tipIds) {
		const binding = bindingById.get(id)
		const firstKey = binding?.keys[0]
		if (!binding || !firstKey) continue
		out.push({
			id,
			key: displayKey(firstKey),
			label: tipDefinitions[id]?.label ?? binding.description,
		})
	}

	return out
}
