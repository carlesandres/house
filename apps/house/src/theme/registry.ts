import { loadBundledThemes } from "./loader.ts"
import type { ThemeDefinition } from "./types.ts"

const map: Map<string, ThemeDefinition> = loadBundledThemes()

/** All known themes. Order is the bundled-themes order in `loader.ts`. */
export const themeDefinitions: readonly ThemeDefinition[] = [...map.values()]

export const getThemeDefinition = (id: string): ThemeDefinition | undefined => map.get(id)

export const isThemeId = (value: unknown): value is string =>
	typeof value === "string" && map.has(value)
