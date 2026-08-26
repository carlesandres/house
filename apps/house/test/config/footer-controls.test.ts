import { describe, expect, test } from "bun:test"
import { defineOptions } from "@house/options"
import { footerControlsFromSession } from "../../src/config/footerControls.ts"

const catalog = defineOptions({
	wrap: {
		type: "boolean",
		default: false,
		persist: "session",
		footer: { icon: "W" },
	},
	theme: {
		type: "string",
		default: "opencode",
		choices: ["opencode", "nord"],
		footer: { icon: "✦" },
	},
	width: {
		type: "number",
		default: 80,
		integer: true,
		min: 1,
	},
})

describe("footerControlsFromSession", () => {
	test("builds indicators for footer-opted keys only", () => {
		const session = catalog.createSession({
			wrap: true,
			theme: "nord",
			width: 80,
		})
		const controls = footerControlsFromSession(catalog, session)
		expect(controls.map((c) => c.id)).toEqual(["wrap", "theme"])
		expect(controls[0]).toMatchObject({
			id: "wrap",
			icon: "W",
			active: true,
			variant: "info",
		})
		expect(controls[1]).toMatchObject({
			id: "theme",
			icon: "✦",
			active: true,
		})
		expect(typeof controls[0]?.onMouseUp).toBe("function")
	})

	test("default Activate toggles and cycles through the session", async () => {
		const session = catalog.createSession(catalog.defaults)
		const controls = footerControlsFromSession(catalog, session)
		controls[0]?.onMouseUp?.()
		await Promise.resolve()
		expect(session.get("wrap")).toBe(true)
		controls[1]?.onMouseUp?.()
		await Promise.resolve()
		expect(session.get("theme")).toBe("nord")
	})

	test("onActivate override skips default session mutation", async () => {
		const session = catalog.createSession(catalog.defaults)
		let calls = 0
		const controls = footerControlsFromSession(catalog, session, {
			wrap: {
				onActivate: () => {
					calls += 1
				},
				active: false,
			},
		})
		expect(controls[0]?.active).toBe(false)
		controls[0]?.onMouseUp?.()
		await Promise.resolve()
		expect(calls).toBe(1)
		expect(session.get("wrap")).toBe(false)
	})
})
