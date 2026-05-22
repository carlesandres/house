/**
 * App rendering tests — establishes and exercises the headless TUI test pattern.
 *
 * Pattern (mirrors ghui/test/scrolling.test.tsx, simplified):
 *   1. Boot the App with @opentui/react's testRender at a fixed viewport.
 *   2. await renderOnce() to flush a frame.
 *   3. Assert on captureCharFrame() (the rendered output as plain text).
 *   4. Drive interaction with mockInput; assert behavioral outcomes.
 */

import { readFileSync } from "node:fs"
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../src/index.tsx"

beforeAll(() => {
	// @ts-expect-error — globalThis.IS_REACT_ACT_ENVIRONMENT is a React internal
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let setup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(() => {
	if (setup) {
		act(() => {
			setup!.renderer.destroy()
		})
		setup = null
	}
})

const VIEWPORT = { width: 100, height: 30 }
const FIXTURE = readFileSync("test/fixtures/sample.md", "utf8")

describe("App", () => {
	test("renders content from the fixture", async () => {
		await act(async () => {
			setup = await testRender(
				<App content={FIXTURE} title="sample.md" onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await setup!.renderOnce()

		const frame = setup!.captureCharFrame()

		// Frame border title (drawn by our outer <box>) — the file path we passed.
		expect(frame).toContain("sample.md")
		// Table content from the fixture.
		expect(frame).toContain("Col A")
		expect(frame).toContain("Col B")
		// FIXME(spike): captureCharFrame() after a single renderOnce() shows the
		// lower portion of the document, not the very top — likely a scrollbox
		// initial-position interaction with <markdown>'s reflow on first layout.
		// Investigate when wiring two-pane + sidebar; for now, assert on what
		// we know is visible (the trailing table).
	})

	test("pressing q invokes onQuit", async () => {
		let quitCalls = 0
		await act(async () => {
			setup = await testRender(
				<App
					content={FIXTURE}
					onQuit={() => {
						quitCalls++
					}}
				/>,
				VIEWPORT,
			)
		})
		await setup!.renderOnce()

		await act(async () => {
			setup!.mockInput.pressKey("q")
		})

		expect(quitCalls).toBe(1)
	})

	test("pressing ctrl+c invokes onQuit", async () => {
		let quitCalls = 0
		await act(async () => {
			setup = await testRender(
				<App
					content={FIXTURE}
					onQuit={() => {
						quitCalls++
					}}
				/>,
				VIEWPORT,
			)
		})
		await setup!.renderOnce()

		await act(async () => {
			setup!.mockInput.pressCtrlC()
		})

		expect(quitCalls).toBe(1)
	})
})
