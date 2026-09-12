import { expect, test } from "bun:test"
import rootPackage from "../../../package.json" with { type: "json" }
import turboConfig from "../../../turbo.json" with { type: "json" }

test("root House launchers retain direct terminal control", () => {
	expect(rootPackage.scripts.dev).toBe("bun run --cwd apps/house dev")
	expect(rootPackage.scripts.start).toBe("bun run --cwd apps/house start")
})

test("release tasks retain the GitHub Actions environment", () => {
	expect(turboConfig.tasks.release.passThroughEnv).toEqual(["GH_TOKEN", "GITHUB_OUTPUT"])
})
