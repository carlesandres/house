interface PackageManifest {
	readonly version?: string
	readonly optionalDependencies?: Readonly<Record<string, string>>
	readonly [key: string]: unknown
}

const PLATFORM_PACKAGE_PREFIX = "@carlesandres/house-"

/**
 * Clones the app manifest for the published npm package, which ships only the launcher shim
 * (`dist/bin.js`); the app itself runs from a platform binary package.
 * - drops `dependencies`, `devDependencies` and `scripts`: the shim imports only Node built-ins,
 *   so installs fetch nothing but the matching platform binary and run no package scripts
 * - pins platform optionalDependencies to this package's version so the published main package
 *   always requests matching platform binaries
 *
 * Monorepo `package.json` may keep platform pins on the last *published* versions so
 * `pnpm install` works before a release is on npm. The public tarball always rewrites those
 * pins to `manifest.version`.
 */
export const createPublicPackageManifest = <TManifest extends PackageManifest>(
	manifest: TManifest,
): Omit<TManifest, "dependencies" | "devDependencies" | "scripts"> => {
	const published: Record<string, unknown> = { ...manifest }
	delete published.dependencies
	delete published.devDependencies
	delete published.scripts

	const version = typeof manifest.version === "string" ? manifest.version : undefined
	const optionalDependencies = { ...manifest.optionalDependencies }
	for (const name of Object.keys(optionalDependencies)) {
		if (version !== undefined && name.startsWith(PLATFORM_PACKAGE_PREFIX)) {
			optionalDependencies[name] = version
		}
	}
	for (const [name, range] of Object.entries(optionalDependencies)) {
		if (range.startsWith("workspace:")) {
			throw new Error(`Public package manifest cannot contain workspace dependency ${name}`)
		}
	}

	if (manifest.optionalDependencies !== undefined)
		published.optionalDependencies = optionalDependencies
	return published as Omit<TManifest, "dependencies" | "devDependencies" | "scripts">
}
