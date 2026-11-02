import { describe, expect, test } from "bun:test"
import pkg from "../package.json" with { type: "json" }
import { createPublicPackageManifest } from "../dev/public-package-manifest.ts"

describe("createPublicPackageManifest", () => {
	test("publishes no runtime dependencies, devDependencies or scripts", () => {
		const staged = createPublicPackageManifest(pkg)
		expect(Object.keys(pkg.dependencies)).not.toHaveLength(0)
		expect("dependencies" in staged).toBe(false)
		expect("devDependencies" in staged).toBe(false)
		expect("scripts" in staged).toBe(false)
		expect(Object.keys(staged.optionalDependencies)).toEqual(Object.keys(pkg.optionalDependencies))
	})

	test("publishes only the shim and changelog alongside the files npm always includes", () => {
		const staged = createPublicPackageManifest(pkg)
		expect(staged.files).toEqual(["dist/bin.js", "CHANGELOG.md"])
		expect(staged.bin).toEqual({ house: "dist/bin.js" })
		expect(staged.type).toBe("module")
	})

	test("states the published Node floor in the README and smokes the install on it", async () => {
		const floor = createPublicPackageManifest(pkg).engines.node
		const major = /^>=(\d+)$/.exec(floor)?.[1]
		const readme = await Bun.file(new URL("../../../README.md", import.meta.url)).text()
		const ci = Bun.YAML.parse(
			await Bun.file(new URL("../../../.github/workflows/ci.yml", import.meta.url)).text(),
		) as { jobs: Record<string, { strategy: { matrix: { "node-version": string[] } } }> }
		expect(major).toBeDefined()
		expect(readme.includes(`Node/npm (\`${floor}\`)`)).toBe(true)
		expect(ci.jobs["npm-install-smoke"]!.strategy.matrix["node-version"]).toContain(`${major}.0.0`)
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

	test("rejects unexpected workspace protocols in optional dependencies", () => {
		expect(() =>
			createPublicPackageManifest({
				name: "example",
				optionalDependencies: { platform: "workspace:*" },
			}),
		).toThrow("Public package manifest cannot contain workspace dependency platform")
	})
})
