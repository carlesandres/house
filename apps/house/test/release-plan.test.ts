import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { bumpStableVersion, isStableVersion, releaseChangelog } from "../dev/release-plan.ts"
import { generateStandaloneHost } from "../dev/standalone-host.ts"
import { releaseTargets } from "../dev/release-targets.ts"

describe("release plan", () => {
	test("bumps stable versions", () => {
		expect(bumpStableVersion("1.2.3", "patch")).toBe("1.2.4")
		expect(bumpStableVersion("1.2.3", "minor")).toBe("1.3.0")
		expect(bumpStableVersion("1.2.3", "major")).toBe("2.0.0")
	})

	test("rejects prereleases and malformed versions", () => {
		expect(isStableVersion("1.2.3-beta.1")).toBe(false)
		expect(() => bumpStableVersion("1.2", "patch")).toThrow()
	})

	test("moves unreleased notes and updates references", () => {
		const input =
			"# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A fix.\n\n## [1.0.0]\n\n[Unreleased]: old\n[1.0.0]: old"
		const output = releaseChangelog(input, "1.1.0", "2026-07-25", "1.0.0")
		expect(output).toContain("## [1.1.0] — 2026-07-25")
		expect(output).toContain("## [Unreleased]\n\n## [1.1.0]")
		expect(output).toContain(
			"[1.1.0]: https://github.com/carlesandres/house/compare/v1.0.0...v1.1.0",
		)
	})

	test("maps every release target to its exact Parcel native package", () => {
		expect(releaseTargets.map((target) => target.parcelNativePackage)).toEqual([
			"@parcel/watcher-darwin-arm64",
			"@parcel/watcher-darwin-x64",
			"@parcel/watcher-linux-arm64-glibc",
			"@parcel/watcher-linux-x64-glibc",
		])
	})

	test("generates a static Parcel host before importing House", () => {
		const source = generateStandaloneHost(releaseTargets[0]!)
		expect(source).toContain('import binding from "@parcel/watcher-darwin-arm64"')
		expect(source).toContain('import { createWrapper } from "@parcel/watcher/wrapper"')
		expect(source.indexOf("createWrapper")).toBeLessThan(source.indexOf("await import"))
		expect(source).toContain("__house_file_navigator_watcher_factory__")
	})

	test("pins CI and publish jobs to the approved Bun runtime", () => {
		const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8")
		const publish = readFileSync(
			new URL("../../../.github/workflows/publish.yml", import.meta.url),
			"utf8",
		)
		const release = readFileSync(
			new URL("../../../.github/workflows/release.yml", import.meta.url),
			"utf8",
		)
		expect(ci.match(/bun-version: 1\.3\.10/g)).toHaveLength(2)
		expect(publish.match(/bun-version: 1\.3\.10/g)).toHaveLength(3)
		expect(release.match(/bun-version: 1\.3\.10/g)).toHaveLength(1)
		expect(`${ci}\n${publish}\n${release}`).not.toContain("bun-version: latest")
	})

	test("uses the release PR merge as the publication approval", () => {
		const release = readFileSync(
			new URL("../../../.github/workflows/release.yml", import.meta.url),
			"utf8",
		)
		const script = readFileSync(new URL("../dev/release.ts", import.meta.url), "utf8")
		expect(release).toContain("workflow_dispatch:")
		expect(release).toContain("types: [closed]")
		expect(release).toContain("github.event.pull_request.merged == true")
		expect(release).toContain("startsWith(github.event.pull_request.head.ref, 'release/v')")
		expect(release).toContain('--target "${MERGE_SHA}"')
		expect(release).toContain('gh workflow run publish.yml --ref "${TAG}"')
		expect(script).not.toContain('"pr", "merge"')
		expect(script).not.toContain('"release", "create"')
	})

	test("verifies every published package, the installed binary, and release assets", () => {
		const publish = readFileSync(
			new URL("../../../.github/workflows/publish.yml", import.meta.url),
			"utf8",
		)
		expect(publish).toContain("verify-published:")
		expect(publish).toContain("@carlesandres/house-darwin-arm64")
		expect(publish).toContain("@carlesandres/house-darwin-x64")
		expect(publish).toContain("@carlesandres/house-linux-arm64")
		expect(publish).toContain("@carlesandres/house-linux-x64")
		expect(publish).toContain('house-release-smoke/bin/house" --version')
		expect(publish).toContain('gh release view "v${VERSION}" --json assets')
	})
})
