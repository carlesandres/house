interface PackageManifest {
	readonly version?: string
	readonly dependencies?: Readonly<Record<string, string>>
	readonly optionalDependencies?: Readonly<Record<string, string>>
	readonly [key: string]: unknown
}

const PLATFORM_PACKAGE_PREFIX = "@carlesandres/house-"

const assertNoWorkspaceProtocols = (
	section: Readonly<Record<string, string>> | undefined,
): void => {
	if (!section) return
	for (const [name, version] of Object.entries(section)) {
		if (version.startsWith("workspace:")) {
			throw new Error(`Public package manifest cannot contain workspace dependency ${name}`)
		}
	}
}

/**
 * Clones the app manifest for the published npm package:
 * - drops private workspace-only dependencies (`@house/ui`, `@house/options`)
 * - pins platform optionalDependencies to this package's version so the
 *   published main package always requests matching platform binaries
 *
 * Monorepo `package.json` may keep platform pins on the last *published*
 * versions so `bun install` works before a release is on npm. The public
 * tarball always rewrites those pins to `manifest.version`.
 */
export const createPublicPackageManifest = <TManifest extends PackageManifest>(
	manifest: TManifest,
): TManifest => {
	const dependencies = { ...manifest.dependencies }
	for (const name of Object.keys(dependencies)) {
		if (name.startsWith("@house/")) delete dependencies[name]
	}

	const version = typeof manifest.version === "string" ? manifest.version : undefined
	const optionalDependencies = { ...manifest.optionalDependencies }
	if (version !== undefined) {
		for (const name of Object.keys(optionalDependencies)) {
			if (name.startsWith(PLATFORM_PACKAGE_PREFIX)) {
				optionalDependencies[name] = version
			}
		}
	}

	assertNoWorkspaceProtocols(dependencies)
	assertNoWorkspaceProtocols(optionalDependencies)
	return {
		...manifest,
		...(manifest.dependencies === undefined ? {} : { dependencies }),
		...(manifest.optionalDependencies === undefined ? {} : { optionalDependencies }),
	}
}
