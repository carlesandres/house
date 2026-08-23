import { defineOptions } from "@house/options"

/**
 * Session-mutable House options whose initial values come from CLI / env /
 * config. Launch-only keys (theme registry, show vocabulary, focus, …) stay
 * on the Effect Config path until they grow an in-app setter.
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
})
