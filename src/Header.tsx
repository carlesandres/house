/**
 * Header — single-row chrome above the two-pane area.
 *
 * Borderless single line modeled on ghui's PlainLine header: identity on
 * the left (⌂ + app name), version on the right. The row is informational,
 * not interactive — see issue #38 for the design discussion.
 *
 * Hidden on tight (short) viewports via `shouldShowHeader` so short
 * terminals don't pay a vertical row for branding. Width is handled here
 * with a graceful degradation: the version drops first, leaving the brand
 * mark as the irreducible identity element.
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
	// Right-side version drops first when the row narrows. Brand stays — it's
	// the identity anchor and earns priority. `1` is the minimum gap between
	// the two strings so they never visually collide.
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
				backgroundColor: colors.background,
			}}
		>
			<text content={left} wrapMode="none" style={{ fg: colors.textMuted }} />
			{showRight && <text content={right} wrapMode="none" style={{ fg: colors.textMuted }} />}
		</box>
	)
}
