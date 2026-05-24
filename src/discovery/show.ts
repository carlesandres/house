/**
 * Discovery visibility categories.
 *
 * Each name identifies a class of entries that the walker normally skips and
 * that the user can opt into showing. The set is intentionally an open vocab:
 * adding a future category (e.g. `"build-artifacts"`) means one entry here,
 * one branch in `walk`, and no churn in the CLI/config surface — `--show`,
 * `HOUSE_SHOW`, and TOML `show = [...]` all carry whatever names live in this
 * tuple.
 */
export const SHOW_CATEGORIES = ["hidden", "gitignored"] as const

export type ShowCategory = (typeof SHOW_CATEGORIES)[number]

export const isShowCategory = (value: string): value is ShowCategory =>
	(SHOW_CATEGORIES as readonly string[]).includes(value)

/**
 * Parse a comma-separated list of category names. Whitespace around tokens
 * is trimmed; empty tokens (trailing comma, double comma) are dropped.
 * Returns `{ ok, value }` on success or `{ ok: false, invalid }` listing
 * tokens that aren't known categories — callers shape the error message
 * for their surface (CLI vs config).
 */
export type ParseShowResult =
	| { readonly ok: true; readonly value: readonly ShowCategory[] }
	| { readonly ok: false; readonly invalid: readonly string[] }

export const parseShowList = (raw: string): ParseShowResult => {
	const tokens = raw
		.split(",")
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
	const invalid = tokens.filter((t) => !isShowCategory(t))
	if (invalid.length > 0) return { ok: false, invalid }
	// De-dupe while preserving the configured order — callers that care
	// about presence use Set membership; emitting a unique sequence keeps
	// the round-trip (encode/decode) stable.
	const seen = new Set<ShowCategory>()
	const out: ShowCategory[] = []
	for (const t of tokens as ShowCategory[]) {
		if (!seen.has(t)) {
			seen.add(t)
			out.push(t)
		}
	}
	return { ok: true, value: out }
}
