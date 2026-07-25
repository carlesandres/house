#!/usr/bin/env bun
/**
 * dev/build-themes.ts — Theme library generator
 *
 * PURPOSE
 * -------
 * Fetches every JSON theme from the upstream opencode repository on GitHub,
 * strips tokens that house doesn't know about (the `diff*` cluster and
 * others), rewrites the `$schema` URL to point at our local schema file, and
 * regenerates `src/theme/loader.ts` so the new themes are bundled at runtime.
 *
 * The opencode repo is the single source of truth for theme content. There is
 * no local copy to keep in sync — running this script always pulls the latest
 * version of every theme from the upstream `dev` branch.
 *
 * This script is a **dev-only tool** — it is not part of the CI pipeline and
 * it does not run on install. Run it manually whenever you want to pull in
 * new or updated themes from upstream. The generated files are checked into
 * git so end-users don't need network access.
 *
 * USAGE
 * -----
 *   bun run build:themes [--dry-run]
 *
 *   --dry-run   Print what would be written without touching disk.
 *               Useful to audit what will change before committing.
 *
 * WHAT IT DOES (step by step)
 * ---------------------------
 * 1. Fetches the directory listing from GitHub Contents API to get all
 *    *.json filenames in the upstream theme folder.
 * 2. Fetches each theme file via the GitHub raw content URL.
 * 3. Validates the raw JSON (must have a `theme` object; all `theme` values
 *    must be hex strings or `{dark, light}` string pairs).
 * 4. Strips tokens outside KNOWN_TOKENS (diff*, backgroundMenu, etc.).
 * 5. Rewrites `$schema` to the local schema path.
 * 6. Derives a human-readable `name` from the filename if the JSON doesn't
 *    already carry one.
 * 7. Writes the cleaned JSON to DEST_DIR (preserving filenames).
 * 8. Regenerates src/theme/loader.ts with one import per theme file.
 *
 * UPSTREAM URLs
 * -------------
 * Directory listing:
 *   https://api.github.com/repos/anomalyco/opencode/contents/packages/opencode/src/cli/cmd/tui/context/theme
 *
 * Individual files (raw):
 *   https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/cli/cmd/tui/context/theme/<name>.json
 *
 * RATE LIMITS
 * -----------
 * The GitHub Contents API allows 60 unauthenticated requests per hour per IP.
 * Each run makes 1 directory-listing request + N file requests (≈33 today).
 * If you hit the rate limit, set a GITHUB_TOKEN environment variable:
 *
 *   GITHUB_TOKEN=ghp_... bun run build:themes
 *
 * A token is never required; it only raises the limit to 5000 req/hour.
 */

import { writeFile, mkdir } from "node:fs/promises"
import { join, relative, basename, extname } from "node:path"

// ---------------------------------------------------------------------------
// Upstream GitHub coordinates
// ---------------------------------------------------------------------------

const GITHUB_API_DIR =
	"https://api.github.com/repos/anomalyco/opencode/contents/packages/opencode/src/cli/cmd/tui/context/theme"

const RAW_BASE =
	"https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/cli/cmd/tui/context/theme"

// ---------------------------------------------------------------------------
// Local paths
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..")
const DEST_DIR = join(REPO_ROOT, "src/theme/themes")
const LOADER_PATH = join(REPO_ROOT, "src/theme/loader.ts")
const SCHEMA_REWRITE = "../../../schema/house-theme.schema.json"

// ---------------------------------------------------------------------------
// Token allow-list
// Derived from ThemeTokens in src/theme/types.ts. Any token from upstream
// that is NOT in this set (e.g. diff*, backgroundMenu, thinkingOpacity) is
// stripped — it is simply not part of house's rendering surface.
// If you add a token to ThemeTokens, add it here too.
// ---------------------------------------------------------------------------

const KNOWN_TOKENS = new Set([
	"primary",
	"secondary",
	"accent",
	"error",
	"warning",
	"success",
	"info",
	"text",
	"textMuted",
	"selectedListItemText",
	"background",
	"backgroundPanel",
	"backgroundElement",
	"border",
	"borderActive",
	"borderSubtle",
	"markdownText",
	"markdownHeading",
	"markdownLink",
	"markdownLinkText",
	"markdownCode",
	"markdownBlockQuote",
	"markdownEmph",
	"markdownStrong",
	"markdownHorizontalRule",
	"markdownListItem",
	"markdownListEnumeration",
	"markdownImage",
	"markdownImageText",
	"markdownCodeBlock",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
])

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Build fetch headers. Adds Authorization if GITHUB_TOKEN is set. */
const githubHeaders = (): Record<string, string> => {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": "house-build-themes",
	}
	const token = process.env["GITHUB_TOKEN"]
	if (token) headers["Authorization"] = `Bearer ${token}`
	return headers
}

/**
 * Fetch a URL and return the parsed JSON body.
 * Throws a descriptive error on non-2xx responses or network failures.
 */
const fetchJson = async (url: string): Promise<unknown> => {
	let res: Response
	try {
		res = await fetch(url, { headers: githubHeaders() })
	} catch (err) {
		throw new Error(
			`Network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}\n` +
				`Check your internet connection and try again.`,
		)
	}

	if (res.status === 403 || res.status === 429) {
		const remaining = res.headers.get("x-ratelimit-remaining")
		const reset = res.headers.get("x-ratelimit-reset")
		const resetTime = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : "unknown"
		throw new Error(
			`GitHub API rate limit exceeded (HTTP ${res.status}).\n` +
				`Remaining requests: ${remaining ?? "unknown"}. Resets at: ${resetTime}.\n` +
				`Set GITHUB_TOKEN=<your-token> to raise the limit to 5000 req/hour:\n` +
				`  GITHUB_TOKEN=ghp_... bun run build:themes`,
		)
	}

	if (res.status === 404) {
		throw new Error(
			`GitHub returned 404 for ${url}.\n` +
				`The upstream theme directory may have moved. Check:\n` +
				`  ${GITHUB_API_DIR}`,
		)
	}

	if (!res.ok) {
		throw new Error(
			`GitHub returned HTTP ${res.status} for ${url}.\n` +
				`Response: ${await res.text().catch(() => "(unreadable)")}`,
		)
	}

	return res.json()
}

/**
 * Fetch raw text from a URL.
 * Throws a descriptive error on non-2xx responses or network failures.
 */
const fetchText = async (url: string): Promise<string> => {
	let res: Response
	try {
		res = await fetch(url, { headers: githubHeaders() })
	} catch (err) {
		throw new Error(
			`Network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`,
		)
	}

	if (!res.ok) {
		throw new Error(`HTTP ${res.status} fetching ${url}`)
	}

	return res.text()
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const isHex = (v: unknown): v is string => typeof v === "string" && HEX_RE.test(v)

const isColorValue = (v: unknown): boolean => {
	if (isHex(v)) return true
	if (typeof v === "string") return true // defs ref — validated indirectly
	if (typeof v === "object" && v !== null) {
		const obj = v as Record<string, unknown>
		return typeof obj["dark"] === "string" && typeof obj["light"] === "string"
	}
	return false
}

type RawThemeJson = {
	$schema?: string
	name?: string
	defs?: Record<string, string>
	theme: Record<string, unknown>
}

/**
 * Validate the raw parsed JSON fetched from GitHub.
 * Throws a descriptive Error if the file does not meet the minimum contract.
 *
 * We are deliberately permissive about which tokens are present — missing
 * tokens are handled at runtime by TOKEN_FALLBACK / HARD_FALLBACK in
 * resolve.ts. What we do assert:
 *   - The file parses as a JSON object.
 *   - It has a `theme` key whose value is an object.
 *   - Every value in `theme` is a valid ColorValue (hex, string ref, or
 *     {dark, light} pair).
 *   - If a `defs` block is present it must be a string→string map.
 */
function validateThemeJson(raw: unknown, filename: string): asserts raw is RawThemeJson {
	if (typeof raw !== "object" || raw === null) {
		throw new Error(
			`${filename}: expected a JSON object at the top level, got ${typeof raw}. ` +
				`The file may be empty or malformed.`,
		)
	}

	const obj = raw as Record<string, unknown>

	if (typeof obj["theme"] !== "object" || obj["theme"] === null) {
		throw new Error(
			`${filename}: missing or non-object "theme" key. ` +
				`Every theme file must have a "theme": { ... } block. ` +
				`This may mean the upstream file format changed — check the raw URL:\n` +
				`  ${RAW_BASE}/${filename}`,
		)
	}

	const theme = obj["theme"] as Record<string, unknown>
	const badTokens: string[] = []
	for (const [key, val] of Object.entries(theme)) {
		if (!isColorValue(val)) {
			badTokens.push(
				`  "${key}": expected a hex string, a defs ref (string), or ` +
					`{dark: string, light: string} — got ${JSON.stringify(val)}`,
			)
		}
	}
	if (badTokens.length > 0) {
		throw new Error(
			`${filename}: invalid token values:\n${badTokens.join("\n")}\n` +
				`This likely means the upstream theme format has changed. ` +
				`File a bug or skip this theme by adding it to the SKIP_THEMES set.`,
		)
	}

	if (obj["defs"] !== undefined) {
		if (typeof obj["defs"] !== "object" || obj["defs"] === null) {
			throw new Error(
				`${filename}: "defs" must be a string→string object when present, ` +
					`got ${typeof obj["defs"]}.`,
			)
		}
		const defs = obj["defs"] as Record<string, unknown>
		const badDefs = Object.entries(defs)
			.filter(([, v]) => typeof v !== "string")
			.map(([k]) => k)
		if (badDefs.length > 0) {
			throw new Error(
				`${filename}: defs entries must be strings. Non-string keys: ${badDefs.join(", ")}.`,
			)
		}
	}
}

// ---------------------------------------------------------------------------
// Naming helper
// "catppuccin-frappe.json" → "Catppuccin Frappe"
// ---------------------------------------------------------------------------

const filenameToDisplayName = (filename: string): string =>
	basename(filename, extname(filename))
		.split(/[-_]/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")

// ---------------------------------------------------------------------------
// loader.ts generator
// ---------------------------------------------------------------------------

/**
 * Generate the content of src/theme/loader.ts from a list of theme ids.
 * The file is fully regenerated — do not hand-edit it; run this script instead.
 */
const generateLoader = (ids: readonly string[]): string => {
	const sorted = [...ids].sort()

	const imports = sorted
		.map((id) => `import ${camelId(id)}Json from "./themes/${id}.json" with { type: "json" }`)
		.join("\n")

	const entries = sorted.map((id) => `\t{ id: "${id}", json: ${camelId(id)}Json },`).join("\n")

	return `// THIS FILE IS AUTO-GENERATED by dev/build-themes.ts — do not edit by hand.
// Run \`bun run build:themes\` to regenerate after adding or updating themes.
${imports}
import { isThemeJson } from "./resolve.ts"
import type { ThemeDefinition, ThemeJson } from "./types.ts"

interface BundledEntry {
\treadonly id: string
\treadonly json: unknown
}

const bundled: readonly BundledEntry[] = [
${entries}
]

const toDefinition = (id: string, raw: unknown): ThemeDefinition | null => {
\tif (!isThemeJson(raw)) return null
\tconst json = raw as ThemeJson
\treturn { id, name: json.name ?? id, source: json }
}

/** Load all bundled themes, indexed by id. Invalid entries are dropped. */
export const loadBundledThemes = (): Map<string, ThemeDefinition> => {
\tconst map = new Map<string, ThemeDefinition>()
\tfor (const { id, json } of bundled) {
\t\tconst def = toDefinition(id, json)
\t\tif (def) map.set(id, def)
\t}
\treturn map
}

/**
 * Stub for user-supplied themes. A future release will load these from the
 * XDG config dir and from project-local \`.house/themes/\`. Until then,
 * returns an empty map.
 */
export const loadUserThemes = async (): Promise<Map<string, ThemeDefinition>> => {
\treturn new Map()
}

/** Bundled + user themes merged. User themes override built-ins by id. */
export const loadAllThemes = async (): Promise<Map<string, ThemeDefinition>> => {
\tconst all = loadBundledThemes()
\tfor (const [id, def] of await loadUserThemes()) all.set(id, def)
\treturn all
}
`
}

/** "catppuccin-frappe" → "catppuccinFrappe" (camelCase, no suffix). */
const camelId = (id: string): string =>
	id
		.split(/[-_]/)
		.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
		.join("")

// ---------------------------------------------------------------------------
// GitHub Contents API response shape (partial)
// ---------------------------------------------------------------------------

type GithubEntry = {
	name: string
	type: string
	download_url: string | null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const isDryRun = Bun.argv.includes("--dry-run")

if (isDryRun) {
	console.log("[dry-run] No files will be written.\n")
}

// 1. Fetch directory listing from GitHub Contents API
console.log("Fetching theme list from GitHub...")

let dirListing: unknown
try {
	dirListing = await fetchJson(GITHUB_API_DIR)
} catch (err) {
	console.error(`\nERROR: ${err instanceof Error ? err.message : String(err)}`)
	process.exit(1)
}

if (!Array.isArray(dirListing)) {
	console.error(
		`ERROR: GitHub API returned an unexpected response shape (expected an array).\n` +
			`This may mean the upstream directory has moved or the API changed.\n` +
			`Check: ${GITHUB_API_DIR}`,
	)
	process.exit(1)
}

const themeEntries = (dirListing as GithubEntry[]).filter(
	(e) => e.type === "file" && e.name.endsWith(".json"),
)

if (themeEntries.length === 0) {
	console.error(
		`ERROR: No *.json files found in the upstream directory.\n` +
			`Check that the path is still correct: ${GITHUB_API_DIR}`,
	)
	process.exit(1)
}

console.log(`Found ${themeEntries.length} theme files upstream.\n`)

// 2. Ensure destination directory exists
if (!isDryRun) {
	await mkdir(DEST_DIR, { recursive: true })
}

// 3. Fetch, validate, and write each theme
const writtenIds: string[] = []
const skipped: Array<{ file: string; reason: string }> = []

for (const entry of themeEntries) {
	const filename = entry.name
	const id = basename(filename, ".json")
	const rawUrl = `${RAW_BASE}/${filename}`
	const destPath = join(DEST_DIR, filename)

	// Fetch raw content
	let text: string
	try {
		text = await fetchText(rawUrl)
	} catch (err) {
		skipped.push({
			file: filename,
			reason: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
		})
		continue
	}

	// Parse JSON
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch (err) {
		skipped.push({
			file: filename,
			reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
		})
		continue
	}

	// Validate structure — abort the whole run on a bad file so we don't
	// silently produce a broken theme library
	try {
		validateThemeJson(raw, filename)
	} catch (err) {
		console.error(
			`\nERROR while validating ${filename}:\n  ${err instanceof Error ? err.message : String(err)}\n`,
		)
		console.error(
			`Aborting. The upstream theme format may have changed.\n` +
				`Options:\n` +
				`  1. File a bug at https://github.com/carlesandres/house/issues\n` +
				`  2. Add "${id}" to a SKIP_THEMES set in this script and re-run.`,
		)
		process.exit(1)
	}

	const obj = raw as Record<string, unknown>
	const theme = obj["theme"] as Record<string, unknown>

	// Strip tokens outside our allow-list (diff*, backgroundMenu, etc.)
	const strippedTokens: string[] = []
	const cleanTheme: Record<string, unknown> = {}
	for (const [key, val] of Object.entries(theme)) {
		if (KNOWN_TOKENS.has(key)) {
			cleanTheme[key] = val
		} else {
			strippedTokens.push(key)
		}
	}

	// Build cleaned JSON — field order: defs, theme, name, $schema
	const cleaned: Record<string, unknown> = {}
	if (obj["defs"]) cleaned["defs"] = obj["defs"]
	cleaned["theme"] = cleanTheme
	cleaned["name"] = typeof obj["name"] === "string" ? obj["name"] : filenameToDisplayName(filename)
	cleaned["$schema"] = SCHEMA_REWRITE

	const output = JSON.stringify(cleaned, null, "\t") + "\n"
	const relDest = relative(REPO_ROOT, destPath)

	if (isDryRun) {
		console.log(`[dry-run] Would write: ${relDest}`)
		if (strippedTokens.length > 0) {
			console.log(`          Stripped tokens: ${strippedTokens.join(", ")}`)
		}
	} else {
		await writeFile(destPath, output, "utf8")
		process.stdout.write(`  wrote  ${relDest}`)
		if (strippedTokens.length > 0) {
			process.stdout.write(`  (stripped: ${strippedTokens.join(", ")})`)
		}
		process.stdout.write("\n")
	}

	writtenIds.push(id)
}

// 4. Report skipped files
if (skipped.length > 0) {
	console.warn(`\nWARNING: ${skipped.length} file(s) were skipped:`)
	for (const { file, reason } of skipped) {
		console.warn(`  ${file}: ${reason}`)
	}
	console.warn(
		`\nSkipped themes will NOT appear in the loader.\n` +
			`If this is unexpected, re-run with GITHUB_TOKEN set or check your network.`,
	)
}

// 5. Regenerate loader.ts
const loaderContent = generateLoader(writtenIds)
const relLoader = relative(REPO_ROOT, LOADER_PATH)

if (isDryRun) {
	console.log(`\n[dry-run] Would regenerate: ${relLoader}`)
	console.log(`          Themes that would be registered (${writtenIds.length}):`)
	for (const id of [...writtenIds].sort()) {
		console.log(`            ${id}`)
	}
} else {
	await writeFile(LOADER_PATH, loaderContent, "utf8")
	console.log(`\n  wrote  ${relLoader}`)
	console.log(`\nRegistered ${writtenIds.length} theme(s):`)
	for (const id of [...writtenIds].sort()) {
		console.log(`  ${id}`)
	}
}

console.log(`\nDone. Run \`bun run typecheck\` and \`bun test\` to verify.`)
