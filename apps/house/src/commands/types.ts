/**
 * Palette command shape.
 *
 * Commands are derived at render time from `browserBindings` via the
 * annotation map (`buildCommands.ts`). The `run` field closes over the
 * per-render `BrowserCtx` so dispatching a command is equivalent to firing
 * the corresponding key binding — single source of truth for the action,
 * two surfaces (keymap + palette) that can invoke it.
 *
 * See issue #70 (and its design-log comments) for the rejected alternatives
 * — atom-driven registry (#92), fully hand-written list, fuzzysort dep, etc.
 */

export interface AppCommand {
	/** Stable id; matches the binding's id for keymap-derived commands. */
	readonly id: string
	/** Imperative-phrased label shown in the palette row. */
	readonly title: string
	/** Optional category for #91's grouped headers. Carried but unused in v1. */
	readonly category?: string
	/** Extra match terms (synonyms, alt phrasings). */
	readonly keywords?: readonly string[]
	/** Display-only shortcut hint (first key of the binding, if any). */
	readonly shortcut?: string
	readonly run: () => void
}
