interface PackageManifest {
	readonly dependencies?: Readonly<Record<string, string>>
	readonly optionalDependencies?: Readonly<Record<string, string>>
	readonly [key: string]: unknown
}

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

/** Clones the app manifest and removes private workspace-only dependencies. */
export const createPublicPackageManifest = <TManifest extends PackageManifest>(
	manifest: TManifest,
): TManifest => {
	const dependencies = { ...manifest.dependencies }
	delete dependencies["@house/ui"]
	const optionalDependencies = { ...manifest.optionalDependencies }
	assertNoWorkspaceProtocols(dependencies)
	assertNoWorkspaceProtocols(optionalDependencies)
	return {
		...manifest,
		...(manifest.dependencies === undefined ? {} : { dependencies }),
		...(manifest.optionalDependencies === undefined ? {} : { optionalDependencies }),
	}
}
