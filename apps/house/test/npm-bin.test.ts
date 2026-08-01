import { describe, expect, test } from "bun:test"
import pkg from "../package.json" with { type: "json" }
import { binaryPackageNameFor, resolveBinaryPath, shouldCaptureOutput } from "../src/cli/npm-bin.js"

describe("npm bin shim", () => {
	test("published manifest pins platform packages to the main package version", async () => {
		const { createPublicPackageManifest } = await import("../dev/public-package-manifest.ts")
		const publicPkg = createPublicPackageManifest(pkg)
		const platformVersions = Object.entries(publicPkg.optionalDependencies ?? {})
			.filter(([name]) => name.startsWith(`${pkg.name}-`))
			.map(([, version]) => version)

		expect(platformVersions).not.toHaveLength(0)
		expect(platformVersions.every((version) => version === pkg.version)).toBe(true)
	})

	test("maps supported platforms to package names", () => {
		expect(binaryPackageNameFor("darwin", "arm64")).toBe("@carlesandres/house-darwin-arm64")
		expect(binaryPackageNameFor("darwin", "x64")).toBe("@carlesandres/house-darwin-x64")
		expect(binaryPackageNameFor("linux", "arm64", "glibc")).toBe("@carlesandres/house-linux-arm64")
		expect(binaryPackageNameFor("linux", "x64", "glibc")).toBe("@carlesandres/house-linux-x64")
	})

	test("rejects unsupported targets", () => {
		expect(binaryPackageNameFor("linux", "x64", "musl")).toBeUndefined()
		expect(binaryPackageNameFor("win32", "x64")).toBeUndefined()
	})

	test("resolves the binary entry point from a package name", () => {
		expect(resolveBinaryPath("@carlesandres/house-darwin-x64", (path: string) => path)).toBe(
			"@carlesandres/house-darwin-x64/bin/house",
		)
	})

	test("captures fast-exit output so command substitution sees it", () => {
		expect(shouldCaptureOutput(["--version"])).toBe(true)
		expect(shouldCaptureOutput(["--help"])).toBe(true)
		expect(shouldCaptureOutput(["README.md"])).toBe(false)
	})
})
