import type { BrowserCtx } from "./keymap/browser.ts"
import type { KeyBinding } from "./keymap/keymap.ts"
import { displayKey } from "./keymap/displayKey.ts"

export interface TipLine {
	readonly id: string
	readonly text: string
}

interface TipDefinition {
	readonly id: string
	readonly bindingId?: string
	readonly render: (parts: { readonly key: string | null }) => string
	readonly when?: (ctx: BrowserCtx) => boolean
}

const tipDefinitions: readonly TipDefinition[] = [
	{
		id: "filter.start",
		bindingId: "filter.open",
		render: ({ key }) => `Press ${key ?? "/"} to start filtering files by path.`,
		when: (ctx) => ctx.filterQuery.length === 0 && !ctx.filterOpen,
	},
	{
		id: "filter.resume",
		bindingId: "filter.open",
		render: ({ key }) => `Press ${key ?? "/"} to reopen the current filter and keep refining it.`,
		when: (ctx) => ctx.filterQuery.length > 0 && !ctx.filterOpen,
	},
	{
		id: "filter.commit",
		bindingId: "filter.open",
		render: () => "Press Enter in the filter to open the selected match in the reader.",
		when: (ctx) => ctx.filterQuery.length === 0,
	},
	{
		id: "filter.clear",
		bindingId: "filter.clearOrOpen",
		render: ({ key }) => `Press ${key ?? "ctrl+\\"} to clear the current filter and start over.`,
		when: (ctx) => ctx.filterQuery.length > 0,
	},
	{
		id: "filtered-navigation",
		render: () => "Use [ and ] to move through files while the current filter stays applied.",
		when: (ctx) => ctx.filterQuery.length > 0,
	},
	{
		id: "focus.toggle",
		bindingId: "focus.toggle",
		render: ({ key }) => `Press ${key ?? "tab"} to switch between the sidebar and reader.`,
	},
	{
		id: "sidebar.toggle",
		bindingId: "sidebar.toggle",
		render: ({ key }) =>
			`Press ${key ?? "s"} to hide or show the sidebar without losing your place.`,
	},
	{
		id: "help.open",
		bindingId: "help.toggle",
		render: ({ key }) => `Press ${key ?? "?"} to open the full keyboard help at any time.`,
	},
]

const firstKeyByBindingId = <C>(bindings: readonly KeyBinding<C>[]): ReadonlyMap<string, string> =>
	new Map(
		bindings.flatMap((binding) => {
			const firstKey = binding.keys[0]
			return firstKey ? [[binding.id, displayKey(firstKey)] as const] : []
		}),
	)

export const buildReaderEmptyStateTips = (
	bindings: readonly KeyBinding<BrowserCtx>[],
	ctx: BrowserCtx,
): readonly TipLine[] => {
	const keyByBindingId = firstKeyByBindingId(bindings)

	return tipDefinitions
		.filter((tip) => !tip.when || tip.when(ctx))
		.map((tip) => ({
			id: tip.id,
			text: `Tip: ${tip.render({ key: tip.bindingId ? (keyByBindingId.get(tip.bindingId) ?? null) : null })}`,
		}))
}

export const pickTipByRotation = (
	tips: readonly TipLine[],
	rotationIndex: number,
): TipLine | null => {
	if (tips.length === 0) return null
	return tips[((rotationIndex % tips.length) + tips.length) % tips.length] ?? null
}
