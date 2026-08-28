import { defineOptions } from "@house/options"
import { themeDefinitions } from "../theme/registry.ts"

export const FILE_NAVIGATOR_ORDERS = ["tree", "recently-modified"] as const
export type FileNavigatorOrder = (typeof FILE_NAVIGATOR_ORDERS)[number]

/**
 * House options whose initial values come from CLI / env / config.
 * Browser holds a session for runtime wrap/theme/tone/order; theme/tone persist
 * through `persistHouseOption`, while order footer flips stay session-only.
 * Lists (`show`, `extensions`) stay on the Effect Config path until
 * `@house/options` has a list type.
 */
export const houseOptions = defineOptions({
	wrap: {
		type: "boolean",
		default: false,
		persist: "session",
		footer: { icon: "W" },
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
		footer: { icon: "T" },
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
	order: {
		type: "string",
		default: "recently-modified",
		choices: FILE_NAVIGATOR_ORDERS,
		// Session-only for now: startup still comes from CLI/env/file; mid-session
		// Activate does not write the config file.
		persist: "session",
		footer: { icon: "O" },
	},
})
