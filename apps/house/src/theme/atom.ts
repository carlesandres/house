/**
 * themeAtom — signals the active theme identity to React.
 *
 * Components read this atom only to subscribe to re-renders; they pull the
 * actual token values from the `colors` singleton (mutated by
 * `setActiveTheme` before the re-render fires).
 *
 * Shape: `{ id, tone }` so that a future theme picker can write both fields
 * atomically and the component sees a single re-render.
 */

import * as Atom from "effect/unstable/reactivity/Atom"
import type { Tone } from "./types.ts"

export interface ThemeState {
	readonly id: string
	readonly tone: Tone
}

export const themeAtom: Atom.Writable<ThemeState, ThemeState> = Atom.make<ThemeState>({
	id: "opencode",
	tone: "dark",
})
