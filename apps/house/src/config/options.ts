import { defineOptions } from "@house/options"
import { themeDefinitions } from "../theme/registry.ts"

/**
 * House options whose initial values come from CLI / env / config.
 * `wrap` is session-mutable; theme/tone persist from the TUI via `save.ts`
 * rather than the options session (step 2). Lists (`show`, `extensions`) stay
 * on the Effect Config path until `@house/options` has a list type.
 */
export const houseOptions = defineOptions({
	wrap: {
		type: "boolean",
		default: false,
		persist: "session",
	},
	width: {
		type: "number",
		default: 80,
		integer: true,
		min: 1,
	},
	theme: {
		type: "string",
		default: "opencode",
		persist: "file",
		choices: themeDefinitions.map((theme) => theme.id),
	},
	tone: {
		type: "string",
		default: "dark",
		persist: "file",
		choices: ["dark", "light"],
	},
	focus: {
		type: "string",
		default: "sidebar",
		choices: ["sidebar", "reader", "filter"],
	},
	defaultRoot: {
		type: "string",
		default: "cwd",
		choices: ["cwd", "git"],
	},
})
