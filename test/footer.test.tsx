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
	test("renders no warning trigger without a partial discovery warning", async () => {
		const bindings: readonly KeyBinding<{ readonly ok: boolean }>[] = []
		let clicks = 0
		await act(async () => {
			setup = await testRender(
				<Footer
					bindings={bindings}
					ctx={{ ok: true }}
					width={VIEWPORT.width}
					onDiscoveryWarningToggle={() => clicks++}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("!")

		await act(async () => {
			await setup!.mockMouse.click(1, 0)
		})
		await stepFrame(setup!.renderOnce)
		expect(clicks).toBe(0)
	})

	test("keeps non-warning discovery statuses textual", async () => {
		const bindings: readonly KeyBinding<{ readonly ok: boolean }>[] = []
		await act(async () => {
			setup = await testRender(
				<Footer
					bindings={bindings}
					ctx={{ ok: true }}
					width={VIEWPORT.width}
					discoveryStatus="indexing… 1"
					discoverySpinnerInitialFrameIndex={0}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("⠋ indexing… 1")
		expect(frame).not.toContain("!")
	})

	test("shows and toggles the partial discovery warning trigger", async () => {
		const bindings: readonly KeyBinding<{ readonly ok: boolean }>[] = []
		let clicks = 0
		const warning = "scan incomplete: skipped 1 directory: locked"
		await act(async () => {
			setup = await testRender(
				<Footer
					bindings={bindings}
					ctx={{ ok: true }}
					width={VIEWPORT.width}
					discoveryStatus={warning}
					onDiscoveryWarningToggle={() => clicks++}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("!")
		expect(frame).not.toContain(warning)

		await act(async () => {
			await setup!.mockMouse.click(1, 0)
		})
		await stepFrame(setup!.renderOnce)
		expect(clicks).toBe(1)

		await act(async () => {
			await setup!.mockMouse.click(1, 0)
		})
		await stepFrame(setup!.renderOnce)
		expect(clicks).toBe(2)
	})

	test("does not spend unbudgeted spacer cells between indicators and hints", async () => {
		const bindings: readonly KeyBinding<{ readonly ok: boolean }>[] = [
			{ id: "quit", group: "Global", description: "Quit", hint: "quit", keys: ["q"], run: () => {} },
			{
				id: "wrap",
				group: "Global",
				description: "Toggle wrap",
				hint: "wrap",
				keys: ["w"],
				run: () => {},
			},
		]
		await act(async () => {
			setup = await testRender(
				<Footer
					bindings={bindings}
					ctx={{ ok: true }}
					width={19}
					indicators={[{ id: "wrap", icon: "W", active: false }]}
				/>,
				{ width: 19, height: 1 },
			)
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		expect(frame).toContain("q quit")
		// With 17 usable cells, the 3-cell indicator plus 14 cells of hints fits
		// exactly. This guards against rendering an extra spacer that the footer
		// width math did not reserve.
		expect(frame).toContain("w wrap")
		expect(frame).not.toContain("W  q")
	})

	test("budgets the non-warning status spinner and spacer before fitting hints", async () => {
		const bindings: readonly KeyBinding<{ readonly ok: boolean }>[] = [
			{
				id: "long",
				group: "Global",
				description: "Long hint",
				hint: "abcdefgh",
				keys: ["x"],
				run: () => {},
			},
		]
		await act(async () => {
			setup = await testRender(
				<Footer
					bindings={bindings}
					ctx={{ ok: true }}
					width={29}
					discoveryStatus="indexing… 1"
					discoverySpinnerInitialFrameIndex={0}
					indicators={[{ id: "wrap", icon: "W", active: false }]}
				/>,
				{ width: 29, height: 1 },
			)
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		expect(frame).toContain(" W ⠋ indexing… 1")
		// The status row reserves the spinner + spacer before fitting hints. Without
		// that reservation this full hint starts rendering and consumes cells the
		// width math promised to the status area.
		expect(frame).not.toContain("x abc")
	})
})
