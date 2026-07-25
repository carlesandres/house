import { describe, expect, test } from "bun:test"
import { bumpStableVersion, isStableVersion, releaseChangelog } from "../dev/release-plan.ts"

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
})
