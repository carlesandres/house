/**
 * Specs, values, and errors for a catalog of options.
 *
 * An option is a typed value whose initial value is resolved from layered
 * sources (CLI → env → file → default) and may then be mutated at runtime.
 * The catalog is the single declaration; consumers map argv/env/file onto
 * its keys and use the session for in-app changes.
 */

/** Where a runtime change is kept: `session` (memory only, default) or `file` (calls `persist`). */
export type PersistPolicy = "session" | "file"

/**
 * How a footer control advances its value on Activate (primary click).
 * Defaults: boolean → `"toggle"`; string with `choices` → `"cycle"`.
 */
export type FooterActivate = "toggle" | "cycle"

/**
 * Opt an option into compact chrome (House maps this to footer indicators).
 * Presentation only — no React, colors, or keymap ids.
 */
export interface FooterOptIn {
	/**
	 * Glyph when there is no value-specific label (booleans; unknown choice).
	 * Choice options with footer must also declare `labels` for every choice.
	 */
	readonly icon: string
	readonly activate?: FooterActivate
	/**
	 * Short abbreviations shown as the footer glyph for each choice value.
	 * Required for string options with `choices` that opt into the footer.
	 */
	readonly labels?: Readonly<Record<string, string>>
}

/** Spec for an on/off option. */
export interface BooleanOption {
	readonly type: "boolean"
	readonly default: boolean
	readonly persist?: PersistPolicy
	readonly footer?: FooterOptIn
}

/** Spec for a numeric option, optionally integer-only and bounded by `min` / `max`. */
export interface NumberOption {
	readonly type: "number"
	readonly default: number
	readonly persist?: PersistPolicy
	/** When true, reject non-integers (TOML floats, `"1.5"`, etc.). */
	readonly integer?: boolean
	readonly min?: number
	readonly max?: number
	readonly footer?: FooterOptIn
}

/** Spec for a string option; `choices` restricts it to a fixed set of values. */
export interface StringOption {
	readonly type: "string"
	readonly default: string
	readonly persist?: PersistPolicy
	readonly choices?: readonly string[]
	readonly footer?: FooterOptIn
}

/** Spec for one option in a catalog. */
export type OptionSpec = BooleanOption | NumberOption | StringOption

/** Option specs keyed by option name. */
export type Catalog = Record<string, OptionSpec>

/** The runtime value type a spec produces. */
export type OptionValue<S extends OptionSpec> = S["type"] extends "boolean"
	? boolean
	: S["type"] extends "number"
		? number
		: string

/** Resolved values for every key in a catalog. */
export type OptionValues<C extends Catalog> = {
	readonly [K in keyof C]: OptionValue<C[K]>
}

/** A key of a catalog. */
export type OptionKey<C extends Catalog> = keyof C & string

/** A source of initial values, highest precedence first: `cli`, `env`, `file`. */
export type ResolveLayer = "cli" | "env" | "file"

/** Why a value from one layer was rejected; format it with `formatResolveError`. */
export interface ResolveError {
	readonly key: string
	readonly layer: ResolveLayer
	readonly message: string
	readonly received: unknown
}

/** Result of `resolve`: the value, or the first error found. */
export type ResolveResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: ResolveError }

export type LayerValues<C extends Catalog> = {
	readonly [K in keyof C]?: unknown
}

/** Raw values from each layer passed to `resolve`; unset entries fall through to the next layer. */
export interface ResolveLayers<C extends Catalog> {
	/** Already-parsed CLI overrides. `null`/`undefined` means "not passed". */
	readonly cli?: LayerValues<C>
	/** Env values, typically strings. `null`/`undefined` means unset. */
	readonly env?: LayerValues<C>
	/** Native file values (boolean/number/string from TOML/JSON). */
	readonly file?: LayerValues<C>
}

/** Passed to `persist` when a `persist: "file"` option changes: its key, new value, all values. */
export interface PersistEvent<C extends Catalog> {
	readonly key: OptionKey<C>
	readonly value: OptionValues<C>[OptionKey<C>]
	readonly values: OptionValues<C>
}

/** Options for `createSession`. `persist` is called after a `persist: "file"` option changes. */
export interface SessionOptions<C extends Catalog> {
	readonly persist?: (event: PersistEvent<C>) => void | Promise<void>
}

/** Live option values: read, change (validated) and subscribe to changes. */
export interface Session<C extends Catalog> {
	get<K extends OptionKey<C>>(key: K): OptionValues<C>[K]
	set<K extends OptionKey<C>>(key: K, value: OptionValues<C>[K]): Promise<void>
	readonly values: OptionValues<C>
	subscribe: (listener: (values: OptionValues<C>) => void) => () => void
}

/** What `defineOptions` returns: the specs, their defaults, `resolve` and `createSession`. */
export interface Options<C extends Catalog> {
	readonly specs: C
	readonly defaults: OptionValues<C>
	resolve: (layers?: ResolveLayers<C>) => ResolveResult<OptionValues<C>>
	createSession: (values: OptionValues<C>, options?: SessionOptions<C>) => Session<C>
}
