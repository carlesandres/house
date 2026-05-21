/**
 * Header — single-row chrome above the two-pane area.
 *
 * Borderless single line modeled on ghui's PlainLine header: identity on
 * the left (⌂ + app name), version on the right. The row is informational,
 * not interactive — see issue #38 for the design discussion.
 *
 * Hidden on tight viewports via `shouldShowHeader` so short terminals don't
 * pay a vertical row for branding.
 */

import pkg from "../package.json" with { type: "json" }
import { BRAND, BRAND_NAME } from "./brand.ts"
import { colors } from "./theme/colors.ts"

export const HEADER_HEIGHT = 1

export interface HeaderProps {
	readonly width: number
	/** Optional override for the version string (testing). Defaults to
	 *  the running package's version. */
	readonly version?: string
}

export const Header = ({ width, version = pkg.version }: HeaderProps) => {
	const left = `${BRAND} ${BRAND_NAME}`
	const right = `v${version}`
	const usableWidth = Math.max(0, width - 2) // 1-cell horizontal padding each side
	// Right-anchored version with a flex gap in the middle. When the row is
	// too narrow to fit both, the version drops off first — the brand mark is
	// the identity anchor and earns priority.
	const showRight = left.length + 1 + right.length <= usableWidth

	return (
		<box
			style={{
				width,
				height: HEADER_HEIGHT,
				flexShrink: 0,
				flexDirection: "row",
				paddingLeft: 1,
				paddingRight: 1,
				backgroundColor: colors.background,
			}}
		>
			<text content={left} wrapMode="none" style={{ fg: colors.textMuted }} />
			<box style={{ flexGrow: 1, flexShrink: 1, backgroundColor: colors.background }} />
			{showRight && <text content={right} wrapMode="none" style={{ fg: colors.textMuted }} />}
		</box>
	)
}
