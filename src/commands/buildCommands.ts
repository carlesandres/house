/**
 * Derive palette commands from `browserBindings` plus the annotation map.
 *
 * The annotation map is the *only* hand-written list keyed by binding id:
 * it carries title rewrites and metadata for bindings whose raw
 * `description` reads awkwardly as a palette command. Every enabled binding is exposed
 * verbatim — its `description` becomes the palette `title`, its first key
 * becomes the `shortcut`.
 *
 * Commands close over the per-render `BrowserCtx`, same shape the keymap
 * dispatcher uses, so the palette and the keymap fire the same action via
 * different surfaces. See #70 design log §list construction (option 3b)
 * for why this beat (a) a fully hand-written palette list and (b) deriving
 * everything via #92's atom-driven registry.
 */

import { browserBindings, type BrowserCtx } from "../keymap/browser.ts"
import { paletteOnlyCommands } from "./paletteOnlyCommands.ts"
import type { AppCommand } from "./types.ts"

interface Annotation {
	/** Override the binding's `description` for palette display. */
	readonly title?: string
	/** Carried for #91's category headers; unused in v1's flat list. */
	readonly category?: string
	/** If true, the binding does not appear in the palette. */
	readonly hidden?: boolean
	readonly keywords?: readonly string[]
}

/**
 * Title rewrites convert keymap phrasing into imperative palette phrasing.
 * With the help overlay removed (#139), the palette is the only in-app full
 * action index, so all currently-enabled actions stay discoverable here.
 */
const annotations: Record<string, Annotation> = {
	// --- Keep, with title rewrites where the binding description reads awkwardly as a command ---
	quit: { category: "App" },
	"focus.toggle": { title: "Toggle focus", category: "View" },
	"sidebar.toggle": { title: "Toggle sidebar", category: "View" },
	"sidebar.down": { category: "Navigation" },
	"sidebar.up": { category: "Navigation" },
	"sidebar.jumpDown": { category: "Navigation" },
	"sidebar.jumpUp": { category: "Navigation" },
	"sidebar.pageDown": { category: "Navigation" },
	"sidebar.pageUp": { category: "Navigation" },
	"sidebar.top": { category: "Navigation" },
	"sidebar.bottom": { category: "Navigation" },
	"sidebar.open": { title: "Open file", category: "Navigation" },
	"filter.open": { title: "Filter files…", category: "Navigation" },
	"discovery.toggleAll": {
		title: "Toggle hidden / gitignored files",
		category: "Navigation",
		keywords: ["hidden", "gitignore", "dotfiles", "all"],
	},
	"reader.back": { title: "Back to sidebar", category: "Navigation" },
	"reader.prevFile": { title: "Previous file", category: "Navigation" },
	"reader.nextFile": { title: "Next file", category: "Navigation" },
	"serve.current": { title: "Open in browser", category: "File" },
	"file.edit": { title: "Open in editor", category: "File", keywords: ["editor", "vim", "vscode"] },
	"theme.next": { category: "Appearance" },
	"theme.prev": { category: "Appearance" },
	"theme.toneToggle": { title: "Toggle dark/light tone", category: "Appearance" },

	// --- Hide: the palette opener itself shouldn't appear in the palette ---
	"palette.open": { hidden: true },
}

/**
 * Build the AppCommand list for a given render. Iterates `browserBindings`
 * in array order (the empty-query palette renders in this order, by design
 * — see #70 design log §empty-state ordering), drops explicitly-hidden entries
 * and those whose `when` predicate currently returns false, and resolves
 * annotations to populate title / category / keywords.
 */
export const buildCommands = (ctx: BrowserCtx): readonly AppCommand[] => {
	const out: AppCommand[] = []
	for (const binding of browserBindings) {
		const ann = annotations[binding.id]
		if (ann?.hidden) continue
		// Same gating the keymap dispatcher uses. Disabled bindings stay out of
		// the palette; #96 tracks a future show-with-reason mode.
		if (binding.when && !binding.when(ctx)) continue
		const cmd: AppCommand = {
			id: binding.id,
			title: ann?.title ?? binding.description,
			...(ann?.category !== undefined && { category: ann.category }),
			...(ann?.keywords !== undefined && { keywords: ann.keywords }),
			...(binding.keys[0] !== undefined && { shortcut: binding.keys[0] }),
			run: () => binding.run(ctx),
		}
		out.push(cmd)
	}
	for (const cmd of paletteOnlyCommands(ctx)) out.push(cmd)
	return out
}
