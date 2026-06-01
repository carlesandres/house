import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { act, useState } from "react"
import { testRender } from "@opentui/react/test-utils"
import { StatusPopover, StatusPopoverPanel } from "../src/StatusPopover.tsx"
import { destroyTestRenderer } from "./helpers/opentui-test-cleanup.ts"

beforeAll(() => {
	// @ts-expect-error — globalThis.IS_REACT_ACT_ENVIRONMENT is a React internal
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let setup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
	await destroyTestRenderer(setup)
	setup = null
})

const VIEWPORT = { width: 60, height: 20 }

const stepFrame = async (renderOnce: () => Promise<void>) => {
	await act(async () => {
		await renderOnce()
		await new Promise<void>((resolve) => setTimeout(resolve, 1))
	})
}

describe("StatusPopover", () => {
	test("toggles open on trigger click and renders multiline content", async () => {
		await act(async () => {
			setup = await testRender(
				<StatusPopover icon="!" content={"first line\nsecond line"} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("!")
		expect(setup!.captureCharFrame()).not.toContain("first line")

		await act(async () => {
			await setup!.mockMouse.pressDown(0, 0)
			await setup!.mockMouse.release(0, 0)
		})
		await stepFrame(setup!.renderOnce)
		const openFrame = setup!.captureCharFrame()
		expect(openFrame).toContain("first line")
		expect(openFrame).toContain("second line")

		await act(async () => {
			await setup!.mockMouse.pressDown(0, 0)
			await setup!.mockMouse.release(0, 0)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("first line")
	})

	test("supports controlled open state", async () => {
		const Harness = () => {
			const [open, setOpen] = useState(false)
			return (
				<StatusPopover
					open={open}
					icon="i"
					content="controlled toggle"
					onOpenChange={(next) => setOpen(next)}
				/>
			)
		}

		await act(async () => {
			setup = await testRender(<Harness />, VIEWPORT)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("controlled toggle")
		await act(async () => {
			await setup!.mockMouse.pressDown(0, 0)
			await setup!.mockMouse.release(0, 0)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("controlled toggle")
		await act(async () => {
			await setup!.mockMouse.pressDown(0, 0)
			await setup!.mockMouse.release(0, 0)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("controlled toggle")
	})

	test("can delegate panel rendering to a parent overlay", async () => {
		const changes: boolean[] = []
		await act(async () => {
			setup = await testRender(
				<StatusPopover
					icon="!"
					content="parent-owned panel"
					showPanel={false}
					onOpenChange={(next) => changes.push(next)}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			await setup!.mockMouse.pressDown(0, 0)
			await setup!.mockMouse.release(0, 0)
		})
		await stepFrame(setup!.renderOnce)

		expect(setup!.captureCharFrame()).toContain("!")
		expect(setup!.captureCharFrame()).not.toContain("parent-owned panel")
		expect(changes).toEqual([true])
	})

	test("wraps long lines and clips rendered content height", async () => {
		await act(async () => {
			setup = await testRender(
				<StatusPopover
					icon="!"
					content={"abcdefghijklmnop\nthird-line"}
					defaultOpen={true}
					minWidth={4}
					maxWidth={8}
					maxHeight={2}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()

		expect(frame).toContain("abcdefgh")
		expect(frame).toContain("ijklmnop")
		expect(frame).not.toContain("third-line")
	})

	test("panel clips content to small viewports", async () => {
		await act(async () => {
			setup = await testRender(
				<StatusPopoverPanel
					content={"line-one\nline-two\nline-three"}
					minWidth={4}
					maxWidth={20}
					maxHeight={10}
				/>,
				{ width: 12, height: 5 },
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()

		expect(frame).toContain("line-one")
		expect(frame).not.toContain("line-two")
		expect(frame).not.toContain("line-three")
	})
})
