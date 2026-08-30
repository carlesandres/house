export { defineOptions } from "./define.ts"
export { formatResolveError } from "./decode.ts"
export {
	footerActivate,
	footerControlActive,
	footerControlGlyph,
	footerKeys,
	footerValues,
	isFooterOption,
	nextFooterValue,
	validateFooterSpecs,
} from "./footer.ts"
export type {
	BooleanOption,
	Catalog,
	FooterActivate,
	FooterOptIn,
	NumberOption,
	OptionKey,
	OptionSpec,
	OptionValue,
	OptionValues,
	Options,
	PersistEvent,
	PersistPolicy,
	ResolveError,
	ResolveLayer,
	ResolveLayers,
	ResolveResult,
	Session,
	SessionOptions,
	StringOption,
} from "./types.ts"
