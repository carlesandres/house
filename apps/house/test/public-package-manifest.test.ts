import { describe, expect, test } from "bun:test"
import pkg from "../package.json" with { type: "json" }
import { createPublicPackageManifest } from "../dev/public-package-manifest.ts"

describe("createPublicPackageManifest", () => {
	test("removes private @house workspace dependencies", () => {
		const staged = createPublicPackageManifest(pkg)
		expect(staged.dependencies["@house/ui"]).toBeUndefined()
		expect(staged.dependencies["@house/options"]).toBeUndefined()
		for (const [name, version] of Object.entries(pkg.dependencies)) {
			if (name.startsWith("@house/")) continue
			expect(Object.entries(staged.dependencies)).toContainEqual([name, version])
		}
	})

	test("pins every public optional platform dependency to the package version", () => {
		const staged = createPublicPackageManifest({
			...pkg,
			version: "9.9.9",
			optionalDependencies: {
				"@carlesandres/house-darwin-arm64": "0.1.0",
				"@carlesandres/house-linux-x64": "0.1.0",
			},
		})
		expect(staged.optionalDependencies).toEqual({
			"@carlesandres/house-darwin-arm64": "9.9.9",
			"@carlesandres/house-linux-x64": "9.9.9",
		})
	})

	test("retains non-platform optional dependencies unchanged", () => {
		const staged = createPublicPackageManifest({
			version: "1.2.3",
			optionalDependencies: {
				"@carlesandres/house-linux-x64": "0.1.0",
				"some-other-optional": "2.0.0",
			},
		})
		expect(staged.optionalDependencies).toEqual({
			"@carlesandres/house-linux-x64": "1.2.3",
			"some-other-optional": "2.0.0",
		})
	})

	test("rejects unexpected workspace protocols in runtime dependencies", () => {
		expect(() =>
			createPublicPackageManifest({
				name: "example",
				dependencies: { public: "workspace:^" },
			}),
		).toThrow("Public package manifest cannot contain workspace dependency public")
	})

	test("rejects unexpected workspace protocols in optional dependencies", () => {
		expect(() =>
			createPublicPackageManifest({
				name: "example",
				optionalDependencies: { platform: "workspace:*" },
			}),
		).toThrow("Public package manifest cannot contain workspace dependency platform")
	})
})
