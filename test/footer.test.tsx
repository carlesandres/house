import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { testRender } from "@opentui/react/test-utils"
import { Footer } from "../src/Footer.tsx"

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

// Filter rendering lives in the sidebar (Browser.tsx) — see the
// `Browser — filter modal` and `Browser — sidebar filter row` describes
// in browser.test.tsx.
