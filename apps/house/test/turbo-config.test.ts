import { expect, test } from "bun:test"
import rootPackage from "../../../package.json" with { type: "json" }

test("root House launchers retain direct terminal control", () => {
	expect(rootPackage.scripts.dev).toBe("bun run --cwd apps/house dev")
	expect(rootPackage.scripts.start).toBe("bun run --cwd apps/house start")
})
