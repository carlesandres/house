import { describe, expect, test } from "bun:test"
import pkg from "../package.json" with { type: "json" }
import { createPublicPackageManifest } from "../dev/public-package-manifest.ts"

describe("createPublicPackageManifest", () => {
	test("removes only the private UI workspace dependency", () => {
		const staged = createPublicPackageManifest(pkg)
		expect(staged.dependencies["@house/ui"]).toBeUndefined()
		for (const [name, version] of Object.entries(pkg.dependencies)) {
			if (name === "@house/ui") continue
			expect(Object.entries(staged.dependencies)).toContainEqual([name, version])
		}
	})

	test("retains every public optional platform dependency", () => {
		const staged = createPublicPackageManifest(pkg)
		expect(staged.optionalDependencies).toEqual(pkg.optionalDependencies)
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
