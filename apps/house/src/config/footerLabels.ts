/**
 * Build unique short footer glyphs for a list of choice ids.
 * Prefers a 2-character abbreviation from the id; on collision walks further
 * characters so every choice gets a distinct label.
 */
export const uniqueFooterLabels = (ids: readonly string[]): Readonly<Record<string, string>> => {
	const used = new Set<string>()
	const out: Record<string, string> = {}
	for (const id of ids) {
		const compact = id.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase()
		const source = compact.length > 0 ? compact : "x"
		let label = source.slice(0, 2).padEnd(2, "x")
		let offset = 2
		while (used.has(label)) {
			const next = source[offset]
			if (next !== undefined) {
				label = `${source[0]}${next}`
				offset += 1
			} else {
				label = `${source[0]}${used.size % 10}`
				offset += 1
				if (offset > source.length + 20) {
					throw new Error(`unable to allocate unique footer label for ${JSON.stringify(id)}`)
				}
			}
		}
		used.add(label)
		out[id] = label
	}
	return out
}
