/** Terminal-friendly display form for a binding's first key chord. */
export const displayKey = (raw: string): string => {
	switch (raw) {
		case "return":
			return "↵"
		case "escape":
			return "esc"
		case "space":
			return "␣"
		case "pageup":
			return "pgup"
		case "pagedown":
			return "pgdn"
		default:
			return raw
	}
}
