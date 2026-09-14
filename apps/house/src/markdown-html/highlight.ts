import { createHighlighterCore, type HighlighterCore } from "@shikijs/core"
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript"
import bash from "@shikijs/langs/bash"
import c from "@shikijs/langs/c"
import cpp from "@shikijs/langs/cpp"
import csharp from "@shikijs/langs/csharp"
import css from "@shikijs/langs/css"
import diff from "@shikijs/langs/diff"
import docker from "@shikijs/langs/docker"
import go from "@shikijs/langs/go"
import html from "@shikijs/langs/html"
import java from "@shikijs/langs/java"
import javascript from "@shikijs/langs/javascript"
import json from "@shikijs/langs/json"
import jsonc from "@shikijs/langs/jsonc"
import jsx from "@shikijs/langs/jsx"
import markdown from "@shikijs/langs/markdown"
import python from "@shikijs/langs/python"
import rust from "@shikijs/langs/rust"
import sql from "@shikijs/langs/sql"
import toml from "@shikijs/langs/toml"
import tsx from "@shikijs/langs/tsx"
import typescript from "@shikijs/langs/typescript"
import yaml from "@shikijs/langs/yaml"
import githubDark from "@shikijs/themes/github-dark"
import githubLight from "@shikijs/themes/github-light"

const aliases = new Map<string, string>([
	["js", "javascript"],
	["ts", "typescript"],
	["sh", "bash"],
	["shell", "bash"],
	["py", "python"],
	["yml", "yaml"],
	["rs", "rust"],
	["golang", "go"],
	["c++", "cpp"],
	["c#", "csharp"],
	["cs", "csharp"],
	["md", "markdown"],
	["dockerfile", "docker"],
])

const languageIds = new Set([
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"json",
	"jsonc",
	"bash",
	"python",
	"css",
	"html",
	"markdown",
	"yaml",
	"toml",
	"sql",
	"rust",
	"go",
	"java",
	"c",
	"cpp",
	"csharp",
	"diff",
	"docker",
])

export const MAX_CODE_UNITS = 100_000
export const MAX_CODE_LINES = 2_000
export const MAX_HIGHLIGHT_UNITS = 1_000_000

export type HighlightAdmission = "admit" | "block-limit" | "document-limit"

export const highlightAdmission = (source: string, admittedUnits: number): HighlightAdmission => {
	let lines = 1
	for (const character of source) if (character === "\n") lines += 1
	if (source.length > MAX_CODE_UNITS || lines > MAX_CODE_LINES) return "block-limit"
	if (admittedUnits + source.length > MAX_HIGHLIGHT_UNITS) return "document-limit"
	return "admit"
}

export const normalizeLanguage = (info: string | undefined): string | null => {
	const first = info?.trim().split(/\s+/, 1)[0]?.toLowerCase()
	if (!first || first === "text" || first === "txt" || first === "plaintext") return null
	const normalized = aliases.get(first) ?? first
	return languageIds.has(normalized) ? normalized : null
}

export const createMarkdownHighlighter = async (): Promise<HighlighterCore> =>
	createHighlighterCore({
		engine: createJavaScriptRegexEngine(),
		themes: [githubLight, githubDark],
		langs: [
			javascript,
			typescript,
			jsx,
			tsx,
			json,
			jsonc,
			bash,
			python,
			css,
			html,
			markdown,
			yaml,
			toml,
			sql,
			rust,
			go,
			java,
			c,
			cpp,
			csharp,
			diff,
			docker,
		],
		warnings: false,
	})
