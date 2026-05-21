/**
 * Commands that exist *only* in the palette — no `browserBindings` entry.
 *
 * Empty in v1 by design (#70 Q6c). This file exists as scaffolding so
 * future palette-only commands (#93 reveal-in-OS, #94 copy-path, …) have
 * an obvious home that's already wired into `buildCommands.ts`.
 *
 * Commands here follow the same shape as keymap-derived ones: they take
 * the per-render `BrowserCtx` so they can read selection state, mutate
 * focus, surface notices, etc.
 */

import type { BrowserCtx } from "../keymap/browser.ts"
import type { AppCommand } from "./types.ts"

export const paletteOnlyCommands = (_ctx: BrowserCtx): readonly AppCommand[] => []
