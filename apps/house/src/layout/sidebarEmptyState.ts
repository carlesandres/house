const HEAD_ELISION_PREFIX = "…"

export const fitSidebarEmptyValue = (value: string, width: number): string => {
	if (value.length <= width) return value
	if (width <= 1) return value.slice(value.length - 1)
	return HEAD_ELISION_PREFIX + value.slice(value.length - width + 1)
}
