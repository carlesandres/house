/**
 * Header — single-row chrome above the two-pane area.
 *
 * Borderless single line modeled on ghui's PlainLine header: brand and
 * current filename on the left, version on the right. The row is
 * informational, not interactive — see issue #38 for the design discussion.
 *
 * Width degrades gracefully: the version drops first when the row gets
 * tight, then the filename, leaving the brand mark as the irreducible
 * identity element. Hidden on tight (short) viewports via
 * `shouldShowHeader` so short terminals don't pay a vertical row for chrome.
 */

import pkg from "../package.json" with { type: "json" }
import { BRAND, BRAND_NAME } from "./brand.ts"
import { colors } from "./theme/colors.ts"

export const HEADER_HEIGHT = 1

const FILE_SEPARATOR = " · "

export interface HeaderProps {
	readonly width: number
	/** Currently selected file's relative path. When set, the Header shows
	 *  it next to the brand mark — replaces the per-pane border title that
	 *  used to carry this information. */
	readonly currentFile?: string | null
	/** Optional override for the version string (testing). Defaults to
	 *  the running package's version. */
	readonly version?: string
}

export const Header = ({ width, currentFile, version = pkg.version }: HeaderProps) => {
	const brand = `${BRAND} ${BRAND_NAME}`
	const right = `v${version}`
	const file = currentFile && currentFile.length > 0 ? currentFile : null
	const usableWidth = Math.max(0, width - 2) // 1-cell horizontal padding each side

	// Priority: brand > filename > version. Brand is the irreducible identity
	// anchor. Filename is per-selection useful info — keep it before the
	// largely-static version string. `1` is the minimum gap between left and
	// right groups so they never visually collide.
	const leftWithFile = file !== null ? `${brand}${FILE_SEPARATOR}${file}` : brand
	const showFileWithVersion = leftWithFile.length + 1 + right.length <= usableWidth
	const showFileWithoutVersion = leftWithFile.length <= usableWidth
	const showFile = file !== null && (showFileWithVersion || showFileWithoutVersion)
	const left = showFile ? leftWithFile : brand
	const showRight = left.length + 1 + right.length <= usableWidth

	return (
		<box
			style={{
				width,
				height: HEADER_HEIGHT,
				flexShrink: 0,
				flexDirection: "row",
				justifyContent: "space-between",
				paddingLeft: 1,
				paddingRight: 1,
				backgroundColor: colors.surface,
			}}
		>
			<text content={left} wrapMode="none" style={{ fg: colors.textMuted }} />
			{showRight && <text content={right} wrapMode="none" style={{ fg: colors.textMuted }} />}
		</box>
	)
}
