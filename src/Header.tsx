/**
 * Header — single-row chrome above the two-pane area.
 *
 * Borderless single line modeled on ghui's PlainLine header: brand and
 * current filename on the left, version on the right. The row is
 * informational, not interactive — see issue #38 for the design discussion.
 *
 * Width degrades gracefully: the discovery root truncates/drops first, then
 * the wordmark, then the version, then the filename truncates, leaving the
 * brand mark as the irreducible identity element. Always rendered — the row is
 * worth one cell on any viewport so the user never loses the filename/root
 * indicator (notably, when the sidebar drawer overlays the reader on narrow
 * viewports).
 */

import pkg from "../package.json" with { type: "json" }
import { BRAND, BRAND_NAME } from "./brand.ts"
import { colors } from "./theme/colors.ts"
import { middleTruncate } from "./ui/middleTruncate.ts"

export const HEADER_HEIGHT = 1

const FILE_SEPARATOR = " · "
const HEADER_HORIZONTAL_PADDING = 2
const HEADER_GROUP_GAP = 1
const MIN_TRUNCATED_ROOT_WIDTH = 5

export interface HeaderSegment {
	readonly id: "brand" | "file" | "root"
	readonly text: string
	readonly tone: "brand" | "primary" | "muted"
}

export interface HeaderLayout {
	readonly left: readonly HeaderSegment[]
	readonly right: string | null
}

export interface HeaderLayoutInput {
	readonly width: number
	readonly currentFile?: string | null | undefined
	readonly rootLabel?: string | null | undefined
	readonly version: string
}

export const layoutHeaderSegments = ({
	width,
	currentFile,
	rootLabel,
	version,
}: HeaderLayoutInput): HeaderLayout => {
	const usableWidth = Math.max(0, width - HEADER_HORIZONTAL_PADDING)
	const file = currentFile && currentFile.length > 0 ? currentFile : null
	const root = rootLabel && rootLabel.length > 0 ? rootLabel : null
	const right = `v${version}`
	const brand: HeaderSegment = { id: "brand", text: `${BRAND} ${BRAND_NAME}`, tone: "brand" }
	const iconBrand: HeaderSegment = { id: "brand", text: BRAND, tone: "brand" }
	const fileSegment: HeaderSegment | null =
		file === null ? null : { id: "file", text: file, tone: "primary" }
	const rootSegment: HeaderSegment | null =
		root === null ? null : { id: "root", text: root, tone: "muted" }
	const segments = [brand, ...(fileSegment === null ? [] : [fileSegment])]

	if (rootSegment !== null && fits([...segments, rootSegment], right, usableWidth)) {
		return { left: [...segments, rootSegment], right }
	}

	const rootWidth =
		rootSegment === null
			? 0
			: usableWidth -
				joinedLength(segments) -
				FILE_SEPARATOR.length -
				HEADER_GROUP_GAP -
				right.length
	if (root !== null && root.length > rootWidth && rootWidth >= MIN_TRUNCATED_ROOT_WIDTH) {
		return {
			left: [...segments, { id: "root", text: middleTruncate(root, rootWidth), tone: "muted" }],
			right,
		}
	}

	if (fits(segments, right, usableWidth)) return { left: segments, right }

	const iconSegments = [iconBrand, ...(fileSegment === null ? [] : [fileSegment])]
	if (fits(iconSegments, right, usableWidth)) return { left: iconSegments, right }
	if (fits(iconSegments, null, usableWidth)) return { left: iconSegments, right: null }
	if (file !== null) {
		const fileWidth = usableWidth - BRAND.length - FILE_SEPARATOR.length
		if (fileWidth > 0) {
			return {
				left: [iconBrand, { id: "file", text: middleTruncate(file, fileWidth), tone: "primary" }],
				right: null,
			}
		}
	}

	return { left: [iconBrand], right: null }
}

const joinedLength = (segments: readonly HeaderSegment[]): number =>
	segments.reduce(
		(total, segment, idx) => total + segment.text.length + (idx === 0 ? 0 : FILE_SEPARATOR.length),
		0,
	)

const fits = (
	segments: readonly HeaderSegment[],
	right: string | null,
	usableWidth: number,
): boolean => {
	const rightWidth = right === null ? 0 : HEADER_GROUP_GAP + right.length
	return joinedLength(segments) + rightWidth <= usableWidth
}

export interface HeaderProps {
	readonly width: number
	/** Currently selected file's relative path. When set, the Header shows
	 *  it next to the brand mark — replaces the per-pane border title that
	 *  used to carry this information. */
	readonly currentFile?: string | null
	/** Canonical discovery root / scan-scope label. */
	readonly rootLabel?: string | null
	/** Optional override for the version string (testing). Defaults to
	 *  the running package's version. */
	readonly version?: string
}

export const Header = ({ width, currentFile, rootLabel, version = pkg.version }: HeaderProps) => {
	const layout = layoutHeaderSegments({ width, currentFile, rootLabel, version })

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
				backgroundColor: colors.backgroundPanel,
			}}
		>
			<text wrapMode="none">
				{layout.left.map((segment, idx) => (
					<span
						key={`${segment.id}-${idx}`}
						style={{ fg: segment.tone === "muted" ? colors.textMuted : colors.text }}
					>
						{`${idx === 0 ? "" : FILE_SEPARATOR}${segment.text}`}
					</span>
				))}
			</text>
			{layout.right !== null && (
				<text content={layout.right} wrapMode="none" style={{ fg: colors.text }} />
			)}
		</box>
	)
}
