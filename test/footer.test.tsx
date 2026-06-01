import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { Footer } from "../src/Footer.tsx"
import type { KeyBinding } from "../src/keymap/keymap.ts"
import { destroyTestRenderer } from "./helpers/opentui-test-cleanup.ts"

beforeAll(() => {
	// @ts-expect-error — globalThis.IS_REACT_ACT_ENVIRONMENT is a React internal
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let setup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(() => {
	destroyTestRenderer(setup)
	setup = null
})

const VIEWPORT = { width: 80, height: 20 }

const stepFrame = async (renderOnce: () => Promise<void>) => {
	await act(async () => {
		await renderOnce()
		await new Promise<void>((resolve) => setTimeout(resolve, 1))
	})
}

describe("Footer", () => {
	test("shows and opens the temporary status trigger", async () => {
		const bindings: readonly KeyBinding<{ readonly ok: boolean }>[] = []
		let clicks = 0
		await act(async () => {
			setup = await testRender(
				<Footer
					bindings={bindings}
					ctx={{ ok: true }}
					width={VIEWPORT.width}
					onValidationTrigger={() => clicks++}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("!")

		await act(async () => {
			await setup!.mockMouse.pressDown(2, 0)
			await setup!.mockMouse.release(2, 0)
		})
		await stepFrame(setup!.renderOnce)
		expect(clicks).toBe(1)

		await act(async () => {
			await setup!.mockMouse.pressDown(2, 0)
			await setup!.mockMouse.release(2, 0)
		})
		await stepFrame(setup!.renderOnce)
		expect(clicks).toBe(2)
	})
})
