import { describe, expect, test } from "bun:test"
import { formatDiscoveryRootLabel } from "../src/discovery/rootLabel.ts"

describe("formatDiscoveryRootLabel", () => {
	test("uses ~ for the home directory", () => {
		expect(formatDiscoveryRootLabel({ discoveryRoot: "/Users/carles", home: "/Users/carles" })).toBe(
			"~",
		)
	})

	test("uses a home-relative label for roots inside home", () => {
		expect(
			formatDiscoveryRootLabel({
				discoveryRoot: "/Users/carles/src/house.more-tweaks",
				home: "/Users/carles",
			}),
		).toBe("~/src/house.more-tweaks")
	})

	test("keeps an absolute label for roots outside home", () => {
		expect(
			formatDiscoveryRootLabel({ discoveryRoot: "/tmp/project-docs", home: "/Users/carles" }),
		).toBe("/tmp/project-docs")
	})

	test("does not treat path-prefix siblings as inside home", () => {
		expect(
			formatDiscoveryRootLabel({
				discoveryRoot: "/Users/carles2/project",
				home: "/Users/carles",
			}),
		).toBe("/Users/carles2/project")
	})
})
