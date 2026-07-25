/**
 * Strict-greater version compare for the update notice.
 *
 * The notice fires only when the registry's published version is *strictly
 * greater* than the running version on its numeric base. Pre-release
 * suffixes are stripped before compare because:
 *
 *  - `dist-tags.latest` is by convention a stable, never a pre-release; the
 *    notice does not target users who opted into pre-releases via a custom
 *    install command.
 *  - A local dev build of `0.5.0-dev.3` should NOT be nagged toward the
 *    published `0.5.0` while iterating on the same base — they're "the
 *    same version" for nag purposes.
 */

const toBaseSegments = (version: string): readonly number[] | null => {
	const base = version.split("-", 1)[0] ?? ""
	const parts = base.split(".")
	const nums: number[] = []
	for (const p of parts) {
		const n = Number(p)
		if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null
		nums.push(n)
	}
	return nums.length > 0 ? nums : null
}

/** True iff `candidate` > `current` on the numeric base. Malformed input → false. */
export const isNewer = (candidate: string, current: string): boolean => {
	const a = toBaseSegments(candidate)
	const b = toBaseSegments(current)
	if (!a || !b) return false
	const len = Math.max(a.length, b.length)
	for (let i = 0; i < len; i++) {
		const x = a[i] ?? 0
		const y = b[i] ?? 0
		if (x > y) return true
		if (x < y) return false
	}
	return false
}
