import { describe, expect, test } from "bun:test"
import { updatePlatformVersions } from "../dev/set-version-lockfile.ts"

const packageName = "@carlesandres/house-linux-x64"

/**
 * updatePlatformVersions remains available for post-publish lockfile hygiene
 * (align monorepo optional pins with npm after a release). Release-time
 * version:set no longer calls it — that chicken-egg broke CI when platform
 * packages were not yet on the registry.
 */
describe("updatePlatformVersions", () => {
	test("updates workspace dependencies and resolved platform packages together", () => {
		const lockfile = `{
  "workspaces": {
    "apps/house": {
      "optionalDependencies": {
        "${packageName}": "0.5.1",
      },
    },
  },
  "packages": {
    "${packageName}": ["${packageName}@0.5.1", "", { "os": "linux" }],
  },
}`

		const updated = updatePlatformVersions(lockfile, [packageName], "0.5.2")

		expect(updated).toContain(`"${packageName}": "0.5.2"`)
		expect(updated).toContain(`"${packageName}": ["${packageName}@0.5.2"`)
		expect(updated).not.toContain("0.5.1")
	})

	test("fails when the resolved package entry is missing", () => {
		const lockfile = `"${packageName}": "0.5.1"`

		expect(() => updatePlatformVersions(lockfile, [packageName], "0.5.2")).toThrow(
			`${packageName} package resolution is missing from bun.lock`,
		)
	})
})
