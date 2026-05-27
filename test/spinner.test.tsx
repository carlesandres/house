import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { testRender } from "@opentui/react/test-utils"
import { Spinner } from "../src/Spinner.tsx"
import { destroyTestRenderer } from "./helpers/opentui-test-cleanup.ts"

beforeAll(() => {
	// @ts-expect-error — globalThis.IS_REACT_ACT_ENVIRONMENT is a React internal
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let setup: Awaited<ReturnType<typeof testRender>> | null = null
let originalSetInterval: typeof globalThis.setInterval
let originalClearInterval: typeof globalThis.clearInterval

afterEach(() => {
	destroyTestRenderer(setup)
	setup = null
})

beforeAll(() => {
	originalSetInterval = globalThis.setInterval
	originalClearInterval = globalThis.clearInterval
	globalThis.setInterval = ((handler: Parameters<typeof setInterval>[0], _timeout?: number) => {
		return originalSetInterval(() => {
			if (typeof handler === "function") return handler()
		}, 60_000)
	}) as typeof setInterval
})

afterAll(() => {
	globalThis.setInterval = originalSetInterval
	globalThis.clearInterval = originalClearInterval
})

describe("Spinner", () => {
	test("renders a frame", async () => {
		await act(async () => {
			setup = await testRender(<Spinner />, { width: 10, height: 1 })
		})
		expect(setup!.captureCharFrame()).toContain("⠋")
	})

	test("can start on a later frame", async () => {
		await act(async () => {
			setup = await testRender(<Spinner initialFrameIndex={3} />, { width: 10, height: 1 })
		})
		expect(setup!.captureCharFrame()).toContain("⠸")
	})

	test("cleans up its interval on unmount", async () => {
		let clears = 0
		const originalClearInterval = globalThis.clearInterval
		globalThis.clearInterval = ((id: Timer) => {
			clears += 1
			return originalClearInterval(id)
		}) as typeof clearInterval
		try {
			await act(async () => {
				setup = await testRender(<Spinner intervalMs={5} />, { width: 10, height: 1 })
			})
			destroyTestRenderer(setup)
			setup = null
			expect(clears).toBeGreaterThan(0)
		} finally {
			globalThis.clearInterval = originalClearInterval
		}
	})
})
