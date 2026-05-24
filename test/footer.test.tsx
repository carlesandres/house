import { afterEach, beforeAll } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
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

// Filter rendering lives in the sidebar (Browser.tsx) — see the
// `Browser — filter modal` and `Browser — sidebar filter row` describes
// in browser.test.tsx.
