/**
 * Derive palette commands from `browserBindings` plus the annotation map.
 *
 * The annotation map is the *only* hand-written list keyed by binding id:
 * it carries (a) hide flags for bindings that are pure keystroke nav, and
 * (b) title rewrites for bindings whose `description` reads as a help-row
 * entry rather than a palette command. Every other binding is exposed
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
 * Pure-keystroke nav (j/k/space/b/[/]…) is intentionally hidden — those
 * bindings have no command-shaped meaning. Reader prev/next file (`[`/`]`)
 * and sidebar `open` (Return/l) are the borderline cases from #70 Q6a;
 * hidden in v1, reconsider if users ask. Title rewrites convert
 * help-overlay phrasing ("Toggle sidebar visibility") into imperative
 * palette phrasing ("Toggle sidebar"). See #70 design log §6.
 */
const annotations: Record<string, Annotation> = {
	// --- Keep, with title rewrites where the binding description reads awkwardly as a command ---
	quit: { category: "App" },
	"focus.toggle": { title: "Toggle focus", category: "View" },
	"sidebar.toggle": { title: "Toggle sidebar", category: "View" },
	"help.toggle": { title: "Show help", category: "App" },
	"filter.open": { title: "Filter files…", category: "Navigation" },
	"serve.current": { title: "Open in browser", category: "File" },
	"file.edit": { title: "Open in editor", category: "File", keywords: ["editor", "vim", "vscode"] },
	"theme.next": { category: "Appearance" },
	"theme.prev": { category: "Appearance" },
	"theme.toneToggle": { title: "Toggle dark/light tone", category: "Appearance" },

	// --- Hide: pure keystroke navigation (j/k/space/b/g/G…) ---
	"sidebar.down": { hidden: true },
	"sidebar.up": { hidden: true },
	"sidebar.jumpDown": { hidden: true },
	"sidebar.jumpUp": { hidden: true },
	"sidebar.pageDown": { hidden: true },
	"sidebar.pageUp": { hidden: true },
	"sidebar.top": { hidden: true },
	"sidebar.bottom": { hidden: true },

	// --- Hide: borderline reader nav. `[`/`]` and Return-to-open feel command-shaped
	//     but are pure keystroke navigation under the hood. #70 Q6a — reconsider
	//     if user feedback expects them in the palette.
	"sidebar.open": { hidden: true },
	"reader.back": { hidden: true },
	"reader.prevFile": { hidden: true },
	"reader.nextFile": { hidden: true },

	// --- Hide: the palette opener itself shouldn't appear in the palette ---
	"palette.open": { hidden: true },
}

/**
 * Build the AppCommand list for a given render. Iterates `browserBindings`
 * in array order (the empty-query palette renders in this order, by design
 * — see #70 design log §empty-state ordering), drops hidden entries and
 * those whose `when` predicate currently returns false, and resolves
 * annotations to populate title / category / keywords.
 */
export const buildCommands = (ctx: BrowserCtx): readonly AppCommand[] => {
	const out: AppCommand[] = []
	for (const binding of browserBindings) {
		const ann = annotations[binding.id]
		if (ann?.hidden) continue
		// Same gating the keymap dispatcher uses. Disabled bindings get
		// hidden from the palette (per #70 Q5b — see #96 for the show-with-
		// reason follow-up after the atom-driven migration).
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
