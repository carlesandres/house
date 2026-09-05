/**
 * Layered configuration loader.
 *
 * Precedence (high to low): CLI args → env vars → user TOML file → built-in defaults.
 * Scalar options resolve through `@house/options`. List keys (`extensions`,
 * `show`) still go through Effect `ConfigProvider.orElse`.
 *
 * Validation failures and TOML parse errors surface from `loadConfig`.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { formatResolveError } from "@house/options"
import { Config, ConfigProvider, Effect, Schema } from "effect"
import { parseShowList, SHOW_CATEGORIES, type ShowCategory } from "../discovery/show.ts"
import { FILE_NAVIGATOR_ORDERS, houseOptions, type FileNavigatorOrder } from "./options.ts"

export interface HouseConfig {
	readonly theme: string
	readonly tone: "dark" | "light"
	readonly extensions: readonly string[]
	/** Reader wrap width used when wrapping is enabled. */
	readonly width: number
	/** Whether the reader starts with fixed-width wrapping enabled. */
	readonly wrap: boolean
	/** Default discovery-root strategy when no explicit `--root` flag is passed. */
	readonly defaultRoot: "cwd" | "git"
	/** Categories of normally-skipped entries to opt into. See
	 *  `src/discovery/show.ts` for the vocabulary. Empty array (the
	 *  default) yields the conservative discovery set. */
	readonly show: readonly ShowCategory[]
	/** Startup pane/input target. `filter` opens the sidebar filter prompt and
	 *  focuses it immediately. */
	readonly focus: "sidebar" | "reader" | "filter"
	/** File Navigator browse order when no filter query is active. */
	readonly order: FileNavigatorOrder
}

export interface CliOverrides {
	readonly theme: string | null
	readonly tone: string | null
	readonly extensions: readonly string[] | null
	/** When non-null, the parsed `--show` list completely replaces env/file
	 *  (no per-category merging — sets compose by replacement, like every
	 *  other CLI override here). `--show ""` sets the empty set. */
	readonly show: readonly ShowCategory[] | null
	readonly focus: string | null
	readonly width: number | null
	readonly wrap: boolean | null
	readonly order: string | null
}

const DEFAULT_EXTENSIONS: readonly string[] = []
const DEFAULT_SHOW = ""

/**
 * Top-level keys the config file is allowed to set. Kept in sync by hand
 * with `houseOptions` and `schema` below — when adding a key, add it both
 * places. Used by `readUserFile` to warn about unrecognized keys (with a
 * did-you-mean hint when one is close) while still loading the rest.
 */
const KNOWN_FILE_KEYS: ReadonlySet<string> = new Set([
	"theme",
	"tone",
	"extensions",
	"show",
	"focus",
	"width",
	"wrap",
	"defaultRoot",
	"order",
])

const schema = Config.all({
	// Comma-separated extension list. Empty string means no extra extensions.
	extensions: Config.schema(Schema.String, "extensions"),
	// `show` arrives as a comma-separated string from every provider
	// (`fileProvider` coerces TOML arrays via `String()`, which produces
	// `"hidden,gitignored"`). Token-level validation happens in `loadConfig`
	// so the error message can list valid categories at the field's path.
	show: Config.schema(Schema.String, "show"),
})

const fromUnknown = (root: unknown): ConfigProvider.ConfigProvider =>
	// Empty `extensions` / `show` are encoded as `""`. Effect 4.0.0-beta.107+
	// treats literal empty strings as missing unless this flag is set.
	ConfigProvider.fromUnknown(root, { preserveEmptyStrings: true })

const defaultsProvider = (): ConfigProvider.ConfigProvider =>
	fromUnknown({
		extensions: DEFAULT_EXTENSIONS.join(","),
		show: DEFAULT_SHOW,
	})

const sourceError = (message: string, cause?: unknown): ConfigProvider.SourceError =>
	new ConfigProvider.SourceError({ message, cause })

/**
 * Levenshtein edit distance, capped at `cap` for early exit.
 * Used only to suggest "did you mean X?" when a config key looks like a
 * typo of a known one. Tiny inputs (≤ ~20 chars), so the naive O(n·m)
 * fill is fine.
 */
const editDistance = (a: string, b: string, cap: number): number => {
	if (Math.abs(a.length - b.length) > cap) return cap + 1
	const prev: number[] = Array.from({ length: b.length + 1 })
	const curr: number[] = Array.from({ length: b.length + 1 })
	for (let j = 0; j <= b.length; j++) prev[j] = j
	for (let i = 1; i <= a.length; i++) {
		curr[0] = i
		let rowMin = curr[0]!
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
			if (curr[j]! < rowMin) rowMin = curr[j]!
		}
		if (rowMin > cap) return cap + 1
		for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!
	}
	return prev[b.length]!
}

const suggestKey = (unknown: string, known: readonly string[]): string | null => {
	let best: { key: string; dist: number } | null = null
	for (const k of known) {
		const d = editDistance(unknown, k, 2)
		if (d <= 2 && (best === null || d < best.dist)) best = { key: k, dist: d }
	}
	return best?.key ?? null
}

const formatUnknownKeyWarning = (path: string, key: string, known: readonly string[]): string => {
	const suggestion = suggestKey(key, known)
	const hint = suggestion ? ` — did you mean "${suggestion}"?` : ""
	return `house: ignoring unknown key "${key}" in ${path}${hint}`
}

/**
 * Reads a TOML file at `path`. Missing file → `null` (per-key fallthrough).
 * Malformed TOML → `SourceError` (hard fail upstream). Unknown top-level keys
 * are warned about via `onWarning` and dropped — this preserves forward-compat
 * with newer config schemas while still flagging typos like `them = "..."`.
 */
const readUserFile = (
	path: string,
	onWarning: (message: string) => void,
): Effect.Effect<Record<string, unknown> | null, ConfigProvider.SourceError> =>
	Effect.gen(function* () {
		const file = Bun.file(path)
		const exists = yield* Effect.promise(() => file.exists())
		if (!exists) return null
		const text = yield* Effect.promise(() => file.text())
		const parsed = yield* Effect.try({
			try: () => Bun.TOML.parse(text) as Record<string, unknown>,
			catch: (cause) =>
				sourceError(
					`invalid TOML in ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				),
		})
		const known = [...KNOWN_FILE_KEYS]
		const filtered: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(parsed)) {
			if (KNOWN_FILE_KEYS.has(k)) {
				filtered[k] = v
			} else {
				onWarning(formatUnknownKeyWarning(path, k, known))
			}
		}
		return filtered
	})

const fileProvider = (data: Record<string, unknown> | null): ConfigProvider.ConfigProvider =>
	ConfigProvider.make((path) =>
		Effect.sync(() => {
			if (data === null) return undefined
			if (path.length === 0) {
				return ConfigProvider.makeRecord(new Set(Object.keys(data)))
			}
			const head = path[0]
			if (typeof head !== "string") return undefined
			const value = data[head]
			if (value === undefined) return undefined
			if (typeof value === "string") return ConfigProvider.makeValue(value)
			// Numbers/booleans coerced to their string form so Schema.Literals matches.
			return ConfigProvider.makeValue(String(value))
		}),
	)

/**
 * Reads `HOUSE_EXTENSIONS` / `HOUSE_SHOW` directly into a `fromUnknown` provider.
 *
 * We don't use `fromEnv().pipe(nested("HOUSE"), constantCase)` here because
 * `ConfigProvider.orElse` composes providers via `.get(path)` (raw store
 * access), which bypasses `mapInput`/`prefix`. That means an env provider
 * built with `nested` + `constantCase` silently returns `undefined` once it
 * sits behind an `orElse`. Reading env vars eagerly sidesteps the issue.
 */
const envProvider = (env: Record<string, string | undefined>): ConfigProvider.ConfigProvider => {
	const entries: Array<[string, string]> = []
	const extensions = env["HOUSE_EXTENSIONS"]
	const show = env["HOUSE_SHOW"]
	if (extensions !== undefined) entries.push(["extensions", extensions])
	if (show !== undefined) entries.push(["show", show])
	return fromUnknown(Object.fromEntries(entries))
}

const cliProvider = (overrides: CliOverrides): ConfigProvider.ConfigProvider => {
	const entries: Array<[string, string]> = []
	if (overrides.extensions !== null) entries.push(["extensions", overrides.extensions.join(",")])
	if (overrides.show !== null) entries.push(["show", overrides.show.join(",")])
	return fromUnknown(Object.fromEntries(entries))
}

export interface LoadOptions {
	readonly cli?: CliOverrides
	/** Override the TOML path (tests). Defaults to `$XDG_CONFIG_HOME/house/config.toml`. */
	readonly filePath?: string
	/** Override env (tests). Defaults to `process.env`. */
	readonly env?: Record<string, string>
	/** Sink for non-fatal warnings (unknown keys). Defaults to stderr. */
	readonly onWarning?: (message: string) => void
}

export const defaultConfigPath = (): string =>
	join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "house", "config.toml")

/**
 * Renders a `ConfigError` (or any error) as a short single-line message
 * suitable for `console.error("house: " + ...)`. Strips Effect's
 * `ConfigError(SchemaError(...))` wrapping when present.
 */
export const formatConfigError = (err: unknown): string => {
	if (err instanceof Config.ConfigError) {
		const cause = err.cause
		const raw = "message" in cause ? cause.message : String(cause)
		return raw
			.replace(/\s+at \[[^\]]+\]\s*$/, "")
			.replace(/\s+/g, " ")
			.trim()
	}
	if (err instanceof Error) return err.message
	return String(err)
}

export const loadConfig = (
	options: LoadOptions = {},
): Effect.Effect<HouseConfig, Config.ConfigError | Error> =>
	Effect.gen(function* () {
		const cli = options.cli ?? {
			theme: null,
			tone: null,
			extensions: null,
			show: null,
			focus: null,
			width: null,
			wrap: null,
			order: null,
		}
		const onWarning = options.onWarning ?? ((msg) => process.stderr.write(`${msg}\n`))
		const filePath = options.filePath ?? defaultConfigPath()
		const env = options.env ?? process.env
		const fileData = yield* readUserFile(filePath, onWarning)
		const provider = cliProvider(cli).pipe(
			ConfigProvider.orElse(envProvider(env)),
			ConfigProvider.orElse(fileProvider(fileData)),
			ConfigProvider.orElse(defaultsProvider()),
		)
		const raw = yield* schema.parse(provider)
		const parsed = parseShowList(raw.show)
		if (!parsed.ok) {
			// Effect's `Config.ConfigError` requires a `SchemaError` or
			// `SourceError` cause that we don't have a clean constructor
			// for here — surface as a plain Error and let the boot
			// layer's existing `formatConfigError` (which already handles
			// `instanceof Error`) render it.
			return yield* Effect.fail(
				new Error(
					`show: unknown category "${parsed.invalid.join('", "')}" (valid: ${SHOW_CATEGORIES.join(", ")})`,
				),
			)
		}
		const resolved = houseOptions.resolve({
			cli: {
				wrap: cli.wrap,
				width: cli.width,
				theme: cli.theme,
				tone: cli.tone,
				focus: cli.focus,
				order: cli.order,
			},
			env: {
				wrap: env["HOUSE_WRAP"],
				width: env["HOUSE_WIDTH"],
				theme: env["HOUSE_THEME"],
				tone: env["HOUSE_TONE"],
				focus: env["HOUSE_FOCUS"],
				defaultRoot: env["HOUSE_DEFAULT_ROOT"],
				order: env["HOUSE_ORDER"],
			},
			file: {
				wrap: fileData?.["wrap"],
				width: fileData?.["width"],
				theme: fileData?.["theme"],
				tone: fileData?.["tone"],
				focus: fileData?.["focus"],
				defaultRoot: fileData?.["defaultRoot"],
				order: fileData?.["order"],
			},
		})
		if (!resolved.ok) {
			return yield* Effect.fail(new Error(formatResolveError(resolved.error, filePath)))
		}
		const tone = resolved.value.tone
		const focus = resolved.value.focus
		const defaultRoot = resolved.value.defaultRoot
		const order = resolved.value.order
		if (tone !== "dark" && tone !== "light") {
			return yield* Effect.fail(
				new Error(`tone: expected one of dark, light, got ${JSON.stringify(tone)}`),
			)
		}
		if (focus !== "sidebar" && focus !== "reader" && focus !== "filter") {
			return yield* Effect.fail(
				new Error(`focus: expected one of sidebar, reader, filter, got ${JSON.stringify(focus)}`),
			)
		}
		if (defaultRoot !== "cwd" && defaultRoot !== "git") {
			return yield* Effect.fail(
				new Error(`defaultRoot: expected one of cwd, git, got ${JSON.stringify(defaultRoot)}`),
			)
		}
		if (order !== "tree" && order !== "recently-modified") {
			return yield* Effect.fail(
				new Error(
					`order: expected one of ${FILE_NAVIGATOR_ORDERS.join(", ")}, got ${JSON.stringify(order)}`,
				),
			)
		}
		return {
			theme: resolved.value.theme,
			tone,
			defaultRoot,
			width: resolved.value.width,
			wrap: resolved.value.wrap,
			order,
			extensions:
				raw.extensions === ""
					? []
					: raw.extensions
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean),
			show: parsed.value,
			focus,
		}
	})
