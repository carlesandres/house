/**
 * Fenced code-block rendering — deterministic regression coverage.
 *
 * Mirrors the technique used by opentui's own
 * `Markdown.code-colors.test.ts`: drive a `MockTreeSitterClient` so the
 * highlight pipeline is fully under our control, wait for `renderer.idle()`,
 * and assert on `captureSpans()` (which gives us text *and* fg/bg, so we
 * can tell "rendered with bg == fg" from "rendered with zero height").
 *
 * The tests simulate the cases that matter for house's v1 promise: fenced
 * code blocks remain visible even when syntax highlighting is unavailable or
 * still pending.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { SyntaxStyle } from "@opentui/core"
import { MockTreeSitterClient } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import type { CapturedFrame, CapturedSpan, RGBA } from "@opentui/core"
import { destroyTestRenderer } from "./helpers/opentui-test-cleanup.ts"

beforeAll(() => {
	// @ts-expect-error — globalThis.IS_REACT_ACT_ENVIRONMENT is a React internal
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

const FG = "#e6e6e6"
const BG = "#101010"

const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: FG } })

const PAYLOAD = "FENCE_PAYLOAD_MARKER"

const findSpan = (frame: CapturedFrame, needle: string): CapturedSpan | undefined => {
	for (const line of frame.lines) {
		const hit = line.spans.find((s) => s.text.includes(needle))
		if (hit) return hit
	}
	return undefined
}

const sameColor = (a: RGBA, b: RGBA): boolean =>
	a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a

let setup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(() => {
	destroyTestRenderer(setup)
	setup = null
})

const mountWithFence = async (lang: string, mock: MockTreeSitterClient) => {
	await act(async () => {
		setup = await testRender(
			<markdown
				content={"```" + lang + "\n" + PAYLOAD + "\n```"}
				syntaxStyle={syntaxStyle}
				fg={FG}
				bg={BG}
				treeSitterClient={mock}
				style={{ width: "100%" }}
			/>,
			{ width: 60, height: 10 },
		)
	})
	await setup!.renderer.idle()
}

const mountAppLayoutWithContent = async (content: string, mock: MockTreeSitterClient) => {
	await act(async () => {
		setup = await testRender(
			<box style={{ width: "100%", height: "100%", backgroundColor: BG }}>
				<scrollbox
					style={{ scrollY: true, scrollX: false, flexGrow: 1, backgroundColor: BG }}
					focused
				>
					<markdown
						content={content}
						syntaxStyle={syntaxStyle}
						fg={FG}
						bg={BG}
						conceal
						style={{ width: "100%" }}
						treeSitterClient={mock}
					/>
				</scrollbox>
			</box>,
			{ width: 60, height: 10 },
		)
	})
	await setup!.renderer.idle()
}

const mountAppLayoutWithFence = async (lang: string, mock: MockTreeSitterClient) => {
	await mountAppLayoutWithContent("```" + lang + "\n" + PAYLOAD + "\n```", mock)
}

describe("fenced code block — rendering pipeline", () => {
	test("unsupported language: payload still visible with inherited fg/bg", async () => {
		const mock = new MockTreeSitterClient()
		mock.setMockResult({ highlights: [], warning: "No parser available for filetype bash" })

		await mountWithFence("bash", mock)
		mock.resolveAllHighlightOnce()
		await setup!.renderer.idle()

		const span = findSpan(setup!.captureSpans(), PAYLOAD)
		expect(span).toBeDefined()
		// Same-color fg/bg would render visibly-blank — this is the bug shape
		// we care about. If this fails, the code block is invisible.
		expect(sameColor(span!.fg, span!.bg)).toBe(false)
	})

	test("no fence language: payload visible (no-filetype fast path)", async () => {
		const mock = new MockTreeSitterClient()
		await mountWithFence("", mock)
		// No highlight call expected on the no-filetype path, but idle() is
		// still the right barrier.

		const span = findSpan(setup!.captureSpans(), PAYLOAD)
		expect(span).toBeDefined()
		expect(sameColor(span!.fg, span!.bg)).toBe(false)
	})

	test("pending highlight (unresolved): unstyled fallback still drawn", async () => {
		// Note: do NOT call resolveAllHighlightOnce — the highlight stays in
		// flight. ensureVisibleTextBeforeHighlight should still have written
		// plain text into the textBuffer for fenced code (drawUnstyledText
		// defaults to true unless streaming + concealCode are both on).
		const mock = new MockTreeSitterClient()
		await mountWithFence("bash", mock)
		expect(mock.isHighlighting()).toBe(true)

		const span = findSpan(setup!.captureSpans(), PAYLOAD)
		expect(span).toBeDefined()
		expect(sameColor(span!.fg, span!.bg)).toBe(false)
	})

	test("inside app scrollbox: unsupported language payload stays visible", async () => {
		const mock = new MockTreeSitterClient()
		mock.setMockResult({ highlights: [], warning: "No parser available for filetype bash" })

		await mountAppLayoutWithFence("bash", mock)
		mock.resolveAllHighlightOnce()
		await setup!.renderer.idle()

		const span = findSpan(setup!.captureSpans(), PAYLOAD)
		expect(span).toBeDefined()
		expect(sameColor(span!.fg, span!.bg)).toBe(false)
	})

	test("inside app scrollbox: tagged fence renders before highlighting resolves", async () => {
		const mock = new MockTreeSitterClient()

		await mountAppLayoutWithFence("bash", mock)

		expect(mock.isHighlighting()).toBe(true)
		expect(setup!.captureCharFrame()).toContain(PAYLOAD)
	})
})
