import { describe, expect, test } from "bun:test"
import { filterCommands } from "../src/commands/score.ts"
import type { AppCommand } from "../src/commands/types.ts"

const command = (overrides: Omit<AppCommand, "run">): AppCommand => ({
	...overrides,
	run: () => {},
})

const ids = (commands: readonly AppCommand[]) => commands.map((cmd) => cmd.id)

describe("command palette scoring", () => {
	test("search ignores display-only shortcuts", () => {
		const commands = [command({ id: "quit", title: "Quit", category: "App", shortcut: "ctrl+c" })]

		expect(filterCommands(commands, "ctrl+c")).toEqual([])
		expect(filterCommands(commands, "ctrl")).toEqual([])
	})

	test("search matches title, category, and keywords", () => {
		const commands = [
			command({ id: "theme.next", title: "Next theme", category: "Appearance" }),
			command({ id: "sidebar.toggle", title: "Toggle sidebar", category: "View" }),
			command({
				id: "discovery.toggleAll",
				title: "Toggle hidden / gitignored files",
				category: "Navigation",
				keywords: ["gitignore", "dotfiles"],
			}),
		]

		expect(ids(filterCommands(commands, "next"))).toEqual(["theme.next"])
		expect(ids(filterCommands(commands, "appearance"))).toEqual(["theme.next"])
		expect(ids(filterCommands(commands, "dotfiles"))).toEqual(["discovery.toggleAll"])
	})
})
