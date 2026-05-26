/**
 * Layered configuration loader.
 *
 * Precedence (high to low): CLI args → env vars → user TOML file → built-in defaults.
 * Each source is wrapped as a `ConfigProvider` and composed via `orElse`,
 * which falls through per-key when the upstream source returns `undefined`.
 *
 * The schema (`Config.schema` + `Schema.Literals`) validates `theme` against
 * the registered theme ids and `tone` against `"dark" | "light"`. Validation
 * failures and TOML parse errors both surface as `ConfigError` from `loadConfig`.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { Config, ConfigProvider, Effect, Schema } from "effect"
import { parseShowList, SHOW_CATEGORIES, type ShowCategory } from "../discovery/show.ts"
import { themeDefinitions } from "../theme/registry.ts"

export interface HouseConfig {
	readonly theme: string
	readonly tone: "dark" | "light"
	readonly mdx: boolean
	/** Default discovery-root strategy when no explicit `--root` flag is passed. */
	readonly defaultRoot: "cwd" | "git"
	/** Categories of normally-skipped entries to opt into. See
	 *  `src/discovery/show.ts` for the vocabulary. Empty array (the
	 *  default) yields the conservative discovery set. */
	readonly show: readonly ShowCategory[]
	/** Startup pane/input target. `filter` opens the sidebar filter prompt and
	 *  focuses it immediately. */
	readonly focus: "sidebar" | "reader" | "filter"
}

export interface CliOverrides {
	readonly theme: string | null
	readonly tone: string | null
	readonly mdx: boolean | null
	/** When non-null, the parsed `--show` list completely replaces env/file
	 *  (no per-category merging — sets compose by replacement, like every
	 *  other CLI override here). `--show ""` sets the empty set. */
	readonly show: readonly ShowCategory[] | null
	readonly focus: "sidebar" | "reader" | "filter" | null
}

const DEFAULT_THEME = "opencode"
const DEFAULT_TONE: "dark" | "light" = "dark"
const DEFAULT_MDX = true
const DEFAULT_ROOT: "cwd" | "git" = "cwd"
const DEFAULT_SHOW = ""
const DEFAULT_FOCUS: "sidebar" | "reader" | "filter" = "filter"

const themeIds = themeDefinitions.map((t) => t.id)

/**
 * Top-level keys the config file is allowed to set. Kept in sync by hand
 * with `schema` below — when adding a key, add it both places.
 * Used by `fileProvider` to warn about unrecognized keys (with a
 * did-you-mean hint when one is close) while still loading the rest.
 */
const KNOWN_FILE_KEYS: ReadonlySet<string> = new Set([
	"theme",
	"tone",
	"mdx",
	"show",
	"focus",
	"defaultRoot",
])

const schema = Config.all({
	theme: Config.schema(Schema.Literals(themeIds), "theme"),
	tone: Config.schema(Schema.Literals(["dark", "light"] as const), "tone"),
	defaultRoot: Config.schema(Schema.String, "defaultRoot"),
	// Boolean stored as string literal because providers stringify values
	// (TOML bools, env vars, CLI flags all flow through as text). Mapped to
	// a real boolean in `loadConfig` below.
	mdx: Config.schema(Schema.Literals(["true", "false"] as const), "mdx"),
	// `show` arrives as a comma-separated string from every provider
	// (`fileProvider` coerces TOML arrays via `String()`, which produces
	// `"hidden,gitignored"`). Token-level validation happens in `loadConfig`
	// so the error message can list valid categories at the field's path.
	show: Config.schema(Schema.String, "show"),
	focus: Config.schema(Schema.Literals(["sidebar", "reader", "filter"] as const), "focus"),
})

const defaultsProvider = (): ConfigProvider.ConfigProvider =>
	ConfigProvider.fromUnknown({
		theme: DEFAULT_THEME,
		tone: DEFAULT_TONE,
		defaultRoot: DEFAULT_ROOT,
		mdx: String(DEFAULT_MDX),
		show: DEFAULT_SHOW,
		focus: DEFAULT_FOCUS,
	})

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
 * Reads a TOML file at `path`. Missing file → `undefined` for every key
 * (per-key fallthrough). Malformed TOML → `SourceError` (hard fail
 * upstream). Unknown top-level keys are warned about via `onWarning` and
 * dropped — this preserves forward-compat with newer config schemas while
 * still flagging typos like `them = "..."`.
 */
const fileProvider = (
	path: string,
	onWarning: (message: string) => void,
): ConfigProvider.ConfigProvider => {
	let cache: { data: Record<string, unknown> | null } | null = null
	const load = Effect.gen(function* () {
		if (cache !== null) return cache.data
		const file = Bun.file(path)
		const exists = yield* Effect.promise(() => file.exists())
		if (!exists) {
			cache = { data: null }
			return null
		}
		const text = yield* Effect.promise(() => file.text())
		const parsed = yield* Effect.try({
			try: () => Bun.TOML.parse(text) as Record<string, unknown>,
			catch: (cause) =>
				new ConfigProvider.SourceError({
					message: `invalid TOML in ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
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
		cache = { data: filtered }
		return filtered
	})
	return ConfigProvider.make((path) =>
		Effect.gen(function* () {
			const data = yield* load
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
}

/**
 * Reads `HOUSE_THEME` / `HOUSE_TONE` directly into a `fromUnknown` provider.
 *
 * We don't use `fromEnv().pipe(nested("HOUSE"), constantCase)` here because
 * `ConfigProvider.orElse` composes providers via `.get(path)` (raw store
 * access), which bypasses `mapInput`/`prefix`. That means an env provider
 * built with `nested` + `constantCase` silently returns `undefined` once it
 * sits behind an `orElse`. Reading env vars eagerly sidesteps the issue.
 */
const envProvider = (env: Record<string, string | undefined>): ConfigProvider.ConfigProvider => {
	const entries: Array<[string, string]> = []
	const theme = env["HOUSE_THEME"]
	const tone = env["HOUSE_TONE"]
	const defaultRoot = env["HOUSE_DEFAULT_ROOT"]
	const mdx = env["HOUSE_MDX"]
	const show = env["HOUSE_SHOW"]
	const focus = env["HOUSE_FOCUS"]
	if (theme !== undefined) entries.push(["theme", theme])
	if (tone !== undefined) entries.push(["tone", tone])
	if (defaultRoot !== undefined) entries.push(["defaultRoot", defaultRoot])
	if (mdx !== undefined) entries.push(["mdx", mdx])
	if (show !== undefined) entries.push(["show", show])
	if (focus !== undefined) entries.push(["focus", focus])
	return ConfigProvider.fromUnknown(Object.fromEntries(entries))
}

const cliProvider = (overrides: CliOverrides): ConfigProvider.ConfigProvider => {
	const entries: Array<[string, string]> = []
	if (overrides.theme !== null) entries.push(["theme", overrides.theme])
	if (overrides.tone !== null) entries.push(["tone", overrides.tone])
	if (overrides.mdx !== null) entries.push(["mdx", String(overrides.mdx)])
	if (overrides.show !== null) entries.push(["show", overrides.show.join(",")])
	if (overrides.focus !== null) entries.push(["focus", overrides.focus])
	return ConfigProvider.fromUnknown(Object.fromEntries(entries))
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
): Effect.Effect<HouseConfig, Config.ConfigError | Error> => {
	const cli = options.cli ?? {
		theme: null,
		tone: null,
		mdx: null,
		show: null,
		focus: null,
	}
	const onWarning = options.onWarning ?? ((msg) => process.stderr.write(`${msg}\n`))
	const provider = cliProvider(cli).pipe(
		ConfigProvider.orElse(envProvider(options.env ?? process.env)),
		ConfigProvider.orElse(fileProvider(options.filePath ?? defaultConfigPath(), onWarning)),
		ConfigProvider.orElse(defaultsProvider()),
	)
	return schema.parse(provider).pipe(
		Effect.flatMap((raw) => {
			const defaultRoot =
				raw.defaultRoot === "cwd" || raw.defaultRoot === "git" ? raw.defaultRoot : DEFAULT_ROOT
			if (raw.defaultRoot !== defaultRoot) {
				onWarning(
					`house: ignoring invalid value ${JSON.stringify(raw.defaultRoot)} for defaultRoot in config/env; using "${DEFAULT_ROOT}"`,
				)
			}
			const parsed = parseShowList(raw.show)
			if (!parsed.ok) {
				// Effect's `Config.ConfigError` requires a `SchemaError` or
				// `SourceError` cause that we don't have a clean constructor
				// for here — surface as a plain Error and let the boot
				// layer's existing `formatConfigError` (which already handles
				// `instanceof Error`) render it.
				return Effect.fail(
					new Error(
						`show: unknown category "${parsed.invalid.join('", "')}" (valid: ${SHOW_CATEGORIES.join(", ")})`,
					),
				)
			}
			return Effect.succeed({
				theme: raw.theme,
				tone: raw.tone,
				defaultRoot,
				mdx: raw.mdx === "true",
				show: parsed.value,
				focus: raw.focus,
			})
		}),
	)
}
