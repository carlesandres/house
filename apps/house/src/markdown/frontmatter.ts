export interface FrontmatterField {
	readonly key: string
	readonly value: string
}

export interface FrontmatterRenderModel {
	readonly body: string
	readonly fields: readonly FrontmatterField[]
}

const FRONTMATTER_OPEN = "---"
const FRONTMATTER_CLOSE = "---"

const normalizeValue = (raw: string): string => {
	const value = raw.trim()
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1)
	}
	return value
}

const formatKey = (key: string): string => key.replace(/[-_]+/g, " ")

const toDisplayField = (key: string, value: string): FrontmatterField => ({
	key: formatKey(key),
	value: normalizeValue(value),
})

export const parseFrontmatter = (content: string): FrontmatterRenderModel => {
	if (
		!content.startsWith(`${FRONTMATTER_OPEN}\n`) &&
		!content.startsWith(`${FRONTMATTER_OPEN}\r\n`)
	) {
		return { body: content, fields: [] }
	}

	const lines = content.split(/\r?\n/)
	if (lines[0] !== FRONTMATTER_OPEN) return { body: content, fields: [] }

	const closeIndex = lines.indexOf(FRONTMATTER_CLOSE, 1)
	if (closeIndex <= 0) return { body: content, fields: [] }

	const fields: FrontmatterField[] = []
	for (const line of lines.slice(1, closeIndex)) {
		if (line.trim().length === 0) continue
		const colon = line.indexOf(":")
		if (colon <= 0) return { body: content, fields: [] }
		const key = line.slice(0, colon).trim()
		const value = line.slice(colon + 1)
		if (key.length === 0) return { body: content, fields: [] }
		fields.push(toDisplayField(key, value))
	}

	const body = lines
		.slice(closeIndex + 1)
		.join("\n")
		.replace(/^\n+/, "")
	return { body, fields }
}
