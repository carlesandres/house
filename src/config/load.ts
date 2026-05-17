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
import { themeDefinitions } from "../theme/registry.ts"

export interface HouseConfig {
	readonly theme: string
	readonly tone: "dark" | "light"
}

export interface CliOverrides {
	readonly theme: string | null
	readonly tone: string | null
}

const DEFAULT_THEME = "opencode"
const DEFAULT_TONE: "dark" | "light" = "dark"

const themeIds = themeDefinitions.map((t) => t.id)

/**
 * Top-level keys the config file is allowed to set. Kept in sync by hand
 * with `schema` below — when adding a key, add it both places.
 * Used by `fileProvider` to reject typo'd keys (e.g. `them = "..."`) loudly
 * rather than silently falling back to defaults.
 */
const KNOWN_FILE_KEYS: ReadonlySet<string> = new Set(["theme", "tone"])

const schema = Config.all({
	theme: Config.schema(Schema.Literals(themeIds), "theme"),
	tone: Config.schema(Schema.Literals(["dark", "light"] as const), "tone"),
})

const defaultsProvider = (): ConfigProvider.ConfigProvider =>
	ConfigProvider.fromUnknown({ theme: DEFAULT_THEME, tone: DEFAULT_TONE })

/**
 * Reads a TOML file at `path`. Missing file → `undefined` for every key
 * (per-key fallthrough). Malformed TOML → `SourceError` (hard fail upstream).
 */
const fileProvider = (path: string): ConfigProvider.ConfigProvider => {
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
		const unknown = Object.keys(parsed).filter((k) => !KNOWN_FILE_KEYS.has(k))
		if (unknown.length > 0) {
			const known = [...KNOWN_FILE_KEYS].join(", ")
			return yield* Effect.fail(
				new ConfigProvider.SourceError({
					message: `unknown key${unknown.length > 1 ? "s" : ""} in ${path}: ${unknown.map((k) => `"${k}"`).join(", ")} (known: ${known})`,
				}),
			)
		}
		cache = { data: parsed }
		return parsed
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
	if (theme !== undefined) entries.push(["theme", theme])
	if (tone !== undefined) entries.push(["tone", tone])
	return ConfigProvider.fromUnknown(Object.fromEntries(entries))
}

const cliProvider = (overrides: CliOverrides): ConfigProvider.ConfigProvider => {
	const entries: Array<[string, string]> = []
	if (overrides.theme !== null) entries.push(["theme", overrides.theme])
	if (overrides.tone !== null) entries.push(["tone", overrides.tone])
	return ConfigProvider.fromUnknown(Object.fromEntries(entries))
}

export interface LoadOptions {
	readonly cli?: CliOverrides
	/** Override the TOML path (tests). Defaults to `$XDG_CONFIG_HOME/house/config.toml`. */
	readonly filePath?: string
	/** Override env (tests). Defaults to `process.env`. */
	readonly env?: Record<string, string>
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
): Effect.Effect<HouseConfig, Config.ConfigError> => {
	const cli = options.cli ?? { theme: null, tone: null }
	const provider = cliProvider(cli).pipe(
		ConfigProvider.orElse(envProvider(options.env ?? process.env)),
		ConfigProvider.orElse(fileProvider(options.filePath ?? defaultConfigPath())),
		ConfigProvider.orElse(defaultsProvider()),
	)
	return schema.parse(provider)
}
