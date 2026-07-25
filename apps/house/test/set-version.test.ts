import { describe, expect, test } from "bun:test"
import pkg from "../package.json" with { type: "json" }
import { updatePlatformVersions } from "../dev/set-version-lockfile.ts"

const packageName = "@carlesandres/house-linux-x64"

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

	test("updates every platform reference in the repository lockfile", async () => {
		const lockfile = await Bun.file(new URL("../../../bun.lock", import.meta.url)).text()
		const platformPackages = Object.keys(pkg.optionalDependencies)
		const updated = updatePlatformVersions(lockfile, platformPackages, "9.9.9")

		for (const name of platformPackages) {
			expect(updated).toContain(`"${name}": "9.9.9"`)
			expect(updated).toContain(`"${name}": ["${name}@9.9.9"`)
		}
	})
})
