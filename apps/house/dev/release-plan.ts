export type Bump = "patch" | "minor" | "major"

const stableSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function isStableVersion(version: string): boolean {
	return stableSemver.test(version)
}

export function bumpStableVersion(version: string, bump: Bump): string {
	if (!isStableVersion(version)) throw new Error(`not a stable semver: ${version}`)
	const parts = version.split(".").map(Number)
	const major = parts[0]!
	const minor = parts[1]!
	const patch = parts[2]!
	if (bump === "major") return `${major + 1}.0.0`
	if (bump === "minor") return `${major}.${minor + 1}.0`
	return `${major}.${minor}.${patch + 1}`
}

export function releaseChangelog(
	changelog: string,
	version: string,
	date: string,
	previousVersion?: string,
): string {
	if (!isStableVersion(version)) throw new Error(`not a stable semver: ${version}`)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid date: ${date}`)
	const heading = /^## \[Unreleased\]\s*$/m
	const match = heading.exec(changelog)
	if (!match) throw new Error("missing [Unreleased] section")
	const start = match.index
	const afterHeading = start + match[0].length
	const next = /\n## \[(?!Unreleased\])[^\n]+\n/.exec(changelog.slice(afterHeading))
	const end = next ? afterHeading + next.index : changelog.length
	const body = changelog.slice(afterHeading, end).replace(/^\n+/, "").replace(/\s+$/, "")
	if (!/^\s*###?\s|^- /m.test(body)) throw new Error("[Unreleased] section is empty")
	const released = `## [${version}] — ${date}\n\n${body}\n\n`
	const updated = `${changelog.slice(0, start)}## [Unreleased]\n\n${released}${changelog.slice(end)}`
	const previous = previousVersion === undefined ? undefined : `v${previousVersion}`
	const comparison = previous === undefined ? `v${version}` : previous
	return updated.replace(
		new RegExp(`\\[Unreleased\\]:.*$`, "m"),
		`[Unreleased]: https://github.com/carlesandres/house/compare/v${version}...HEAD\n[${version}]: https://github.com/carlesandres/house/compare/${comparison}...v${version}`,
	)
}
