import type { PersistEvent } from "@house/options"
import { houseOptions } from "./options.ts"
import { saveThemePreference } from "./save.ts"

export const persistHouseOption = async (
	event: PersistEvent<typeof houseOptions.specs>,
	path?: string,
): Promise<void> => {
	if (event.key !== "theme" && event.key !== "tone") return
	const tone = event.values.tone
	if (tone !== "dark" && tone !== "light") return
	await saveThemePreference({ theme: event.values.theme, tone }, path)
}
