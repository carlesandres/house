export interface FileNavigatorTheme {
	readonly background: string
	readonly backgroundPanel: string
	readonly backgroundElement: string
	readonly text: string
	readonly textMuted: string
	readonly border: string
	readonly selectedListItemText: string
}

const SEPARATOR = " "
const MIN_PARENT_BUDGET = 3

const middleTruncate = (value: string, width: number): string => {
	if (width <= 0) return ""
	if (value.length <= width) return value
	if (width <= 1) return value.slice(0, width)
	const available = width - 1
	const left = Math.ceil(available / 2)
	const right = Math.floor(available / 2)
	return value.slice(0, left) + "…" + value.slice(value.length - right)
}

const fitTail = (value: string, width: number): string => {
	if (value.length <= width) return value
	if (width <= 1) return value.slice(0, 1)
	return value.slice(0, width - 1) + "…"
}

/** Splits and truncates a path for the internal basename-first row. */
export const formatFileRow = (
	path: string,
	width: number,
): { readonly basename: string; readonly parent: string; readonly separator: string } => {
	const slash = path.lastIndexOf("/")
	if (slash < 0) return { basename: fitTail(path, width), parent: "", separator: "" }

	const basename = path.slice(slash + 1)
	const parent = path.slice(0, slash)
	if (basename.length >= width) {
		return { basename: fitTail(basename, width), parent: "", separator: "" }
	}
	const remaining = width - basename.length - SEPARATOR.length
	if (remaining < MIN_PARENT_BUDGET || parent.length === 0) {
		return { basename, parent: "", separator: "" }
	}
	return {
		basename,
		parent: middleTruncate(parent, remaining),
		separator: SEPARATOR,
	}
}

/** Renders the navigator's basename-first default row. */
export const DefaultFileRow = ({
	path,
	selected,
	width,
	theme,
}: {
	readonly path: string
	readonly selected: boolean
	readonly width: number
	readonly theme: FileNavigatorTheme
}) => {
	const { basename, parent, separator } = formatFileRow(path, width)
	return (
		<text wrapMode="none">
			<span style={{ fg: selected ? theme.selectedListItemText : theme.text }}>{basename}</span>
			{parent !== "" && <span style={{ fg: theme.textMuted }}>{`${separator}${parent}`}</span>}
		</text>
	)
}
