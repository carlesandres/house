const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const updatePlatformVersions = (
	lockfile: string,
	platformPackages: readonly string[],
	nextVersion: string,
): string => {
	let updated = lockfile

	for (const name of platformPackages) {
		const escapedName = escapeRegExp(name)
		const dependencyPattern = new RegExp(`("${escapedName}": )"[^"]+"`)
		const resolutionPattern = new RegExp(`("${escapedName}": \\["${escapedName}@)[^"]+(")`)

		if (!dependencyPattern.test(updated)) {
			throw new Error(`${name} workspace dependency is missing from bun.lock`)
		}
		if (!resolutionPattern.test(updated)) {
			throw new Error(`${name} package resolution is missing from bun.lock`)
		}

		updated = updated
			.replace(dependencyPattern, `$1"${nextVersion}"`)
			.replace(resolutionPattern, `$1${nextVersion}$2`)
	}

	return updated
}
