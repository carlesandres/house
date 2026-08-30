import type {
	Catalog,
	FooterActivate,
	OptionKey,
	OptionSpec,
	OptionValue,
	OptionValues,
} from "./types.ts"

/** Resolve the Activate strategy for a spec, including footer defaults. */
export const footerActivate = (spec: OptionSpec): FooterActivate | undefined => {
	if (spec.footer?.activate !== undefined) return spec.footer.activate
	if (spec.type === "boolean") return "toggle"
	if (spec.type === "string" && spec.choices !== undefined && spec.choices.length > 0) {
		return "cycle"
	}
	return undefined
}

export const isFooterOption = (spec: OptionSpec): boolean => spec.footer !== undefined

/** Catalog keys that opted into footer chrome, in declaration order. */
export const footerKeys = <C extends Catalog>(specs: C): readonly OptionKey<C>[] => {
	const keys: OptionKey<C>[] = []
	for (const key of Object.keys(specs) as OptionKey<C>[]) {
		if (specs[key]?.footer !== undefined) keys.push(key)
	}
	return keys
}

/**
 * Next value after Activate for a footer-opted option.
 * Throws when the spec has no valid toggle/cycle strategy.
 */
export const nextFooterValue = <S extends OptionSpec>(
	spec: S,
	current: OptionValue<S>,
): OptionValue<S> => {
	const activate = footerActivate(spec)
	if (activate === "toggle") {
		if (spec.type !== "boolean") {
			throw new Error('footer activate "toggle" requires a boolean option')
		}
		return !current as OptionValue<S>
	}
	if (activate === "cycle") {
		if (spec.type !== "string" || spec.choices === undefined || spec.choices.length === 0) {
			throw new Error('footer activate "cycle" requires a string option with choices')
		}
		const choices = spec.choices
		const currentIndex = choices.indexOf(current as string)
		const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % choices.length
		return choices[nextIndex]! as OptionValue<S>
	}
	throw new Error("option has no footer activate strategy")
}

/** Whether a footer control should render as active/highlighted. */
export const footerControlActive = <S extends OptionSpec>(
	spec: S,
	value: OptionValue<S>,
): boolean => {
	if (spec.type === "boolean") return Boolean(value)
	// Choice controls stay lit; the glyph abbreviation carries the value.
	return true
}

/** Glyph to show for the current value (choice label, else static icon). */
export const footerControlGlyph = <S extends OptionSpec>(
	spec: S,
	value: OptionValue<S>,
): string => {
	const footer = spec.footer
	if (footer === undefined) {
		throw new Error("footerControlGlyph requires a footer-opted spec")
	}
	if (typeof value === "string" && footer.labels !== undefined) {
		const label = footer.labels[value]
		if (label !== undefined && label.length > 0) return label
	}
	return footer.icon
}

export const validateFooterSpecs = <C extends Catalog>(specs: C): void => {
	for (const key of Object.keys(specs) as OptionKey<C>[]) {
		const spec = specs[key]!
		const footer = spec.footer
		if (footer === undefined) continue
		if (footer.icon.length === 0) {
			throw new Error(`option ${JSON.stringify(key)}: footer.icon must be non-empty`)
		}
		const activate = footerActivate(spec)
		if (activate === undefined) {
			throw new Error(
				`option ${JSON.stringify(key)}: footer requires activate "toggle" or "cycle" ` +
					"(booleans toggle; strings with choices cycle; other types need an explicit strategy)",
			)
		}
		if (activate === "toggle" && spec.type !== "boolean") {
			throw new Error(
				`option ${JSON.stringify(key)}: footer activate "toggle" requires type "boolean"`,
			)
		}
		if (activate === "cycle") {
			if (spec.type !== "string" || spec.choices === undefined || spec.choices.length === 0) {
				throw new Error(
					`option ${JSON.stringify(key)}: footer activate "cycle" requires string choices`,
				)
			}
			const labels = footer.labels
			if (labels === undefined) {
				throw new Error(
					`option ${JSON.stringify(key)}: footer.labels is required for choice options`,
				)
			}
			for (const choice of spec.choices) {
				const label = labels[choice]
				if (label === undefined || label.length === 0) {
					throw new Error(
						`option ${JSON.stringify(key)}: footer.labels missing entry for ${JSON.stringify(choice)}`,
					)
				}
			}
		}
	}
}

/** Snapshot of footer-facing values for a catalog (testing / debug). */
export const footerValues = <C extends Catalog>(
	specs: C,
	values: OptionValues<C>,
): Partial<OptionValues<C>> => {
	const out: Partial<OptionValues<C>> = {}
	for (const key of footerKeys(specs)) {
		out[key] = values[key]
	}
	return out
}
