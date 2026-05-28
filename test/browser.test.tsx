import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { act } from "react"
import React from "react"
import { testRender } from "@opentui/react/test-utils"
import { RegistryProvider } from "@effect/atom-react"
import { RGBA } from "@opentui/core"
import type { CapturedFrame } from "@opentui/core"
import {
	Browser,
	resetReaderEmptyStateTipRotationForTests,
	setReaderEmptyStateTipRotationForTests,
} from "../src/Browser.tsx"
import type { FileEntry } from "../src/discovery/walk.ts"
import { colors, setActiveTheme } from "../src/theme/colors.ts"
import { themeAtom } from "../src/theme/atom.ts"
import { themeDefinitions } from "../src/theme/registry.ts"
import { resolveTheme } from "../src/theme/resolve.ts"
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

const VIEWPORT = { width: 120, height: 30 }
const README = readFileSync("README.md", "utf8")

const makeFiles = (relativePaths: readonly string[]): FileEntry[] =>
	relativePaths.map((rel) => ({
		path: `/virtual/${rel}`,
		relativePath: rel,
		name: rel.split("/").pop() ?? rel,
	}))

const makeReader =
	(contents: Record<string, string>) =>
	(path: string): Promise<string> => {
		const rel = path.replace("/virtual/", "")
		const content = contents[rel]
		return content !== undefined
			? Promise.resolve(content)
			: Promise.reject(new Error(`no fixture for ${rel}`))
	}

/** Re-render and tick the event loop, in act(). */
const stepFrame = async (renderOnce: () => Promise<void>) => {
	await act(async () => {
		await renderOnce()
		await new Promise<void>((resolve) => setTimeout(resolve, 1))
	})
}

/** Wrap a <Browser> element in RegistryProvider so atom hooks resolve.
 *  Pass initialValues to seed atom state (e.g. active theme). */
const renderBrowser = (
	element: React.ReactNode,
	viewport: { width: number; height: number },
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	initialValues?: Iterable<readonly [any, any]>,
) => {
	const normalizedElement = React.isValidElement<React.ComponentProps<typeof Browser>>(element)
		? React.cloneElement(element, {
				filterDebounceMs: 0,
				renderedPathDebounceMs: 0,
			})
		: element
	const wrapped = React.createElement(
		RegistryProvider,
		{ initialValues } as Parameters<typeof RegistryProvider>[0],
		normalizedElement,
	)
	return testRender(wrapped, viewport)
}

const renderBrowserFast = (element: React.ReactNode) => {
	if (!React.isValidElement<React.ComponentProps<typeof Browser>>(element)) {
		throw new Error("renderBrowserFast expects a <Browser /> element")
	}

	return renderBrowser(
		React.cloneElement(element, {
			disableFooterNoticeAutoClear: true,
			disableReaderEmptyStateRotation: true,
		}),
		VIEWPORT,
	)
}

describe("Browser — sidebar", () => {
	test("renders all file relative paths", async () => {
		const files = makeFiles(["README.md", "docs/intro.md", "docs/api.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={files} readFile={makeReader({})} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Sidebar rows render basename-first with the parent path as a dim suffix
		// (e.g. "intro.md  ·  docs"). Match the full shape so a regression that
		// drops the parent suffix — or renders it without the separator — fails
		// here instead of silently passing on a basename-only frame.
		expect(frame).toContain("README.md")
		expect(frame).toMatch(/intro\.md\s+·\s+docs/)
		expect(frame).toMatch(/api\.md\s+·\s+docs/)
	})

	test("shows '(no markdown files)' when files is empty", async () => {
		resetReaderEmptyStateTipRotationForTests()
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={[]} readFile={makeReader({})} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("no markdown files")
		expect(frame).toContain("Press / to start filtering files by path.")
		expect(frame).not.toContain(
			"Press Enter in the filter to open the selected match in the reader.",
		)
		expect(frame).not.toContain("Press tab to switch between the sidebar and reader.")
	})

	test("rotates empty-state tips each time the reader empty state appears", async () => {
		resetReaderEmptyStateTipRotationForTests()
		const files = makeFiles(["README.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "# Read me" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("z")
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("No files match: z")
		expect(setup!.captureCharFrame()).toContain(
			"Press / to reopen the current filter and keep refining it.",
		)

		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("Read me")

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("z")
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("No files match: z")
		expect(setup!.captureCharFrame()).toContain(
			"Press ctrl+\\ to clear the current filter and start over.",
		)

		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("Read me")

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("z")
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("No files match: z")
		expect(setup!.captureCharFrame()).toContain(
			"Use [ and ] to move through files while the current filter stays applied.",
		)
	})
})

// "Which file is the reader showing?" — assert on the Header chrome row
// (first line) rather than the markdown body. The body goes through
// opentui's <markdown> + <scrollbox> stack, which doesn't render reliably
// on the first frame in the headless renderer (matches the spike's
// FIXME). The Header is plain <text>, rendered immediately.
//
// Header format: "⌂ house · <currentFile>           vX.Y.Z". The middle
// dot before the filename is the unique anchor — sidebar list rows render
// the path without that prefix.
const readerTitleContains = (frame: string, name: string): boolean => {
	const first = frame.split("\n")[0] ?? ""
	return first.includes(`· ${name}`)
}

/** Bg color at (row, col) in a captured frame. Used for focus assertions:
 *  the sidebar tints to colors.background when focused, colors.backgroundPanel
 *  otherwise. */
const bgAt = (frame: CapturedFrame, row: number, col: number): RGBA | null => {
	const line = frame.lines[row]
	if (!line) return null
	let c = 0
	for (const span of line.spans) {
		if (col < c + span.width) return span.bg
		c += span.width
	}
	return null
}

/** True when the sidebar pane is rendered AND focused. Active panes
 *  stay on colors.background; inactive ones dim to colors.backgroundPanel. We
 *  sample 3 rows from the bottom (past footer + bottom rule, into the
 *  pane area) at col 0 — that cell sits in the sidebar's paddingLeft
 *  and is reliably empty, so its bg reflects the pane bg rather than a
 *  selected-file or filter-row override. When the sidebar is hidden
 *  entirely, that cell belongs to the reader, so we gate on
 *  `sidebarIsVisible` first. */
const sidebarIsFocused = (frame: CapturedFrame, charFrame: string): boolean => {
	if (!sidebarIsVisible(charFrame)) return false
	const bg = bgAt(frame, frame.rows - 3, 0)
	if (!bg) return false
	return RGBA.fromHex(colors.background).equals(bg)
}

/** True when the sidebar pane is rendered. Two shapes:
 *   - Wide (inline two-pane): the right-edge divider rune `│` marks the
 *     sidebar's right edge.
 *   - Narrow (single-pane stack): no divider; the sidebar fills the area.
 *     Detected by counting how many entries from `files` appear in the
 *     frame — the Header surfaces the *one* selected file even in
 *     reader-only mode, but only the sidebar list shows multiple files.
 *
 *  Callers in narrow scenarios should pass `files`. Tests that open the
 *  help overlay or command palette — both of which also render `│` —
 *  should not use this helper while a modal is up. */
const sidebarIsVisible = (frame: string, files?: readonly string[]): boolean => {
	if (frame.includes("│")) return true
	if (!files || files.length < 2) return false
	let hits = 0
	for (const f of files) if (frame.includes(f)) hits++
	return hits >= 2
}

const settleBrowser = async () => {
	await act(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 120))
		await setup!.renderer.idle()
	})
	await stepFrame(setup!.renderOnce)
}

const waitForFrameContaining = async (text: string): Promise<string> => {
	for (let i = 0; i < 10; i++) {
		await settleBrowser()
		const frame = setup!.captureCharFrame()
		if (frame.includes(text)) return frame
	}
	return setup!.captureCharFrame()
}

describe("Browser — selection", () => {
	test("opens the initially selected file in the reader pane", async () => {
		const files = makeFiles(["a.md", "b.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)
	})

	test("j moves selection down — reader title updates to next file", async () => {
		const files = makeFiles(["a.md", "b.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("j")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "b.md")).toBe(true)
	})

	test("k moves selection up", async () => {
		const files = makeFiles(["a.md", "b.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					initialIndex={1}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "b.md")).toBe(true)

		await act(async () => {
			setup!.mockInput.pressKey("k")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)
	})

	test("j clamps at the last file", async () => {
		const files = makeFiles(["a.md", "b.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					initialIndex={1}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("j")
			setup!.mockInput.pressKey("j")
			setup!.mockInput.pressKey("j")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "b.md")).toBe(true)
	})

	test("g jumps to top, shift+g jumps to bottom", async () => {
		const files = makeFiles(["a.md", "b.md", "c.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "a.md": "x", "b.md": "y", "c.md": "z" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("g", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "c.md")).toBe(true)

		await act(async () => {
			setup!.mockInput.pressKey("g")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)
	})

	test("README fenced code blocks remain visible after navigating away and back", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": README,
						"notes.md": "# Notes\n\nNo code here.\n",
					})}
					onQuit={() => {}}
				/>,
				{ width: 160, height: 40 },
			)
		})
		await settleBrowser()
		expect(setup!.captureCharFrame()).toContain("npm install -g @carlesandres/house")

		await act(async () => {
			setup!.mockInput.pressKey("j")
		})
		await settleBrowser()
		expect(readerTitleContains(setup!.captureCharFrame(), "notes.md")).toBe(true)

		await act(async () => {
			setup!.mockInput.pressKey("k")
		})
		await settleBrowser()

		const frame = setup!.captureCharFrame()
		expect(readerTitleContains(frame, "README.md")).toBe(true)
		expect(frame).toContain("npm install -g @carlesandres/house")
		expect(frame).toContain("bun add -g @carlesandres/house")
	})
})

describe("Browser — focus", () => {
	test("starts with the sidebar focused", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
	})

	test("tab toggles focus between sidebar and reader", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(false)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)

		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
	})

	test("return / l / right focus the reader; escape / h / left focus the sidebar", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// return → reader
		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(false)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)

		// escape → sidebar (escape needs extra time: \x1b is the lead of
		// escape sequences, so the parser waits to disambiguate before emitting).
		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)

		// l → reader
		await act(async () => {
			setup!.mockInput.pressKey("l")
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(false)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)

		// h → sidebar
		await act(async () => {
			setup!.mockInput.pressKey("h")
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)

		// right → reader
		await act(async () => {
			setup!.mockInput.pressArrow("right")
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(false)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)

		// left → sidebar
		await act(async () => {
			setup!.mockInput.pressArrow("left")
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
	})

	test("j/k do not move sidebar selection while reader is focused", async () => {
		const files = makeFiles(["a.md", "b.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Switch to reader, then press j a couple times. Selection must stay on a.md.
		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("j")
			setup!.mockInput.pressKey("j")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)
	})
})

describe("Browser — sidebar toggle", () => {
	test("s hides the sidebar and shifts focus to the reader", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(true)

		await act(async () => {
			setup!.mockInput.pressKey("s")
		})
		await stepFrame(setup!.renderOnce)

		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)
		// Reader becomes the active pane.
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(false)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)
	})

	test("pressing s again restores the sidebar and focuses it", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("s")
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("s")
		})
		await stepFrame(setup!.renderOnce)

		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
	})
})

describe("Browser — #22 layout v2", () => {
	test("--sidebar=on shows the sidebar even on a tight viewport", async () => {
		// 70 cols can't fit SIDEBAR_MIN+DIVIDER+READER_MIN=69+ inline given
		// 28-col sidebar+1-col divider+40-col reader. Border math means the
		// drawer takes over — but the sidebar still appears, since shown=true.
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
					sidebarMode="on"
				/>,
				{ width: 60, height: 20 },
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(sidebarIsVisible(setup!.captureCharFrame(), ["a.md", "b.md"])).toBe(true)
		expect(frame).toContain("a.md")
	})

	test("--sidebar=off hides the sidebar at launch", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
					sidebarMode="off"
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)
		// Reader is the focused pane.
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(false)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)
	})

	test("startupFocus=filter opens the sidebar filter at launch", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
					startupFocus="filter"
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("> ▏")
		expect(sidebarIsFocused(setup!.captureSpans(), frame)).toBe(true)
	})

	test("tab from the startup filter returns to the filter on the next tab", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
					startupFocus="filter"
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		expect(frame).not.toContain("> ▏")
		expect(sidebarIsFocused(setup!.captureSpans(), frame)).toBe(false)
		expect(readerTitleContains(frame, "a.md")).toBe(true)

		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)

		const returnedFrame = setup!.captureCharFrame()
		expect(returnedFrame).toContain("> ▏")
		expect(sidebarIsFocused(setup!.captureSpans(), returnedFrame)).toBe(true)
	})

	test("startupFocus=reader keeps sidebar hidden with --sidebar=off", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
					sidebarMode="off"
					startupFocus="reader"
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(false)
	})

	test("startupFocus=sidebar focuses sidebar without opening filter", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
					startupFocus="sidebar"
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(sidebarIsFocused(setup!.captureSpans(), frame)).toBe(true)
		expect(frame).not.toContain("> ▏")
	})

	test("--sidebar=auto consults the viewport bucket once", async () => {
		// 60 cols < 80 → starts hidden.
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
					sidebarMode="auto"
				/>,
				{ width: 60, height: 20 },
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)
	})

	test("focusing a hidden sidebar opens it as a drawer; defocusing dismisses it", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
					sidebarMode="off"
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)
		// Tab focuses the sidebar → drawer appears.
		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
		// Tab again moves focus to the reader → drawer dismisses.
		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)
	})

	test("footer keeps key hints when a filter is applied and the input is closed", async () => {
		await act(async () => {
			setup = await renderBrowserFast(
				<Browser
					files={makeFiles(["alpha.md", "beta.md"])}
					readFile={makeReader({ "alpha.md": "a", "beta.md": "b" })}
					onQuit={() => {}}
				/>,
			)
		})
		await stepFrame(setup!.renderOnce)
		// Commit an applied filter.
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("a")
			setup!.mockInput.pressKey("l")
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("q quit")
	})

	test("shows a spinner next to indexing status while discovery is active", async () => {
		let tick: (() => void) | null = null
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["alpha.md"])}
					readFile={makeReader({ "alpha.md": "a" })}
					discoveryStatus="indexing… 1"
					discoverySpinnerIntervalMs={5}
					discoverySpinnerRegisterTick={(next) => (tick = next)}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("⠋ indexing… 1")
		expect(typeof tick).toBe("function")
	})

	test("normalizes multi-line discovery status into a single footer line", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["alpha.md"])}
					readFile={makeReader({ "alpha.md": "a" })}
					discoveryStatus={"scan failed: boom\nsecond line\n  third line"}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("scan failed: boom second line third line")
	})

	test("renders leading YAML frontmatter as metadata instead of raw markdown", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["alpha.md"])}
					readFile={makeReader({
						"alpha.md": [
							"---",
							'title: "Frontmatter title"',
							"published: 2026-02-17",
							"---",
							"# Hello",
						].join("\n"),
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		const frame = await waitForFrameContaining("published: 2026-02-17")
		expect(frame).toContain("title: Frontmatter title")
		expect(frame).toContain("published: 2026-02-17")
		expect(frame).not.toContain('title: "Frontmatter title"')
		expect(frame).not.toContain("tags: [")
	})

	test("falls back to raw markdown when frontmatter is malformed", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["alpha.md"])}
					readFile={makeReader({
						"alpha.md": ["---", "not valid", "---", "Body"].join("\n"),
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		const frame = await waitForFrameContaining("────────────────")
		expect(frame).toContain("────────────────")
	})

	test("footer does not show persistent filter state while the filter input is open", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["alpha.md"])}
					readFile={makeReader({ "alpha.md": "a" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("a")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("[filter:")
	})

	test("long applied filters do not consume footer hint space", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["alpha.md", "beta.md"])}
					readFile={makeReader({ "alpha.md": "a", "beta.md": "b" })}
					onQuit={() => {}}
				/>,
				{ width: 70, height: 30 },
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("/")
			for (const ch of "integration-test-helper") setup!.mockInput.pressKey(ch)
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("q quit")
		expect(frame).not.toContain("[filter:")
	})
})

describe("Browser — jump and page keys", () => {
	const tenFiles = makeFiles(Array.from({ length: 10 }, (_, i) => `f${i}.md`))
	const reader = makeReader(
		Object.fromEntries(tenFiles.map((f) => [f.relativePath, f.relativePath])),
	)

	test("shift+j jumps 8 lines down", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={tenFiles} readFile={reader} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("j", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "f8.md")).toBe(true)
	})

	test("shift+k jumps 8 lines up", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={tenFiles} initialIndex={9} readFile={reader} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("k", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "f1.md")).toBe(true)
	})

	test("space pages selection down by 8", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={tenFiles} readFile={reader} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			// pressKey expects a single-char string for space — not the literal "space".
			setup!.mockInput.pressKey(" ")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "f8.md")).toBe(true)
	})

	test("b pages selection up by 8", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={tenFiles} initialIndex={9} readFile={reader} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("b")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "f1.md")).toBe(true)
	})
})

describe("Browser — reader [ / ] navigates files", () => {
	test("] selects next file while reader is focused", async () => {
		const files = makeFiles(["a.md", "b.md", "c.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "a.md": "x", "b.md": "y", "c.md": "z" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		// Switch to reader focus.
		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("]")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "b.md")).toBe(true)
	})

	test("[ selects previous file while reader is focused", async () => {
		const files = makeFiles(["a.md", "b.md", "c.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					initialIndex={2}
					readFile={makeReader({ "a.md": "x", "b.md": "y", "c.md": "z" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("[")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "b.md")).toBe(true)
	})
})

describe("Browser — help overlay", () => {
	// The overlay lists all bindings across 3 groups; needs enough height to show all.
	const TALL_VIEWPORT = { width: 120, height: 50 }

	test("? opens the help overlay; section headers and bindings appear", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				TALL_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await settleBrowser()

		const frame = setup!.captureCharFrame()
		expect(frame).toContain("Help")
		// Section headers from the binding groups
		expect(frame).toContain("Global")
		expect(frame).toContain("Sidebar")
		expect(frame).toContain("Reader")
		// At least one binding's keys + description visible
		expect(frame).toContain("Quit")
		expect(frame).toContain("Toggle sidebar visibility")
	})

	test("? again closes the help overlay", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				TALL_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("Help")

		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("Help")
	})

	test("escape closes the help overlay", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				TALL_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("Help")
	})

	test("while help is open, q does not trigger quit", async () => {
		let quitCount = 0
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {
						quitCount += 1
					}}
				/>,
				TALL_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("q")
		})
		await stepFrame(setup!.renderOnce)

		expect(quitCount).toBe(0)
		// Overlay should still be open.
		expect(setup!.captureCharFrame()).toContain("Help")
	})

	test("while help is open, j does not move sidebar selection", async () => {
		const files = makeFiles(["a.md", "b.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
				/>,
				TALL_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Open help.
		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)

		// j should be swallowed.
		await act(async () => {
			setup!.mockInput.pressKey("j")
		})
		await stepFrame(setup!.renderOnce)

		// Close help, then check sidebar is still on a.md.
		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "a.md")).toBe(true)
	})
})

describe("Browser — quit", () => {
	test("q invokes onQuit", async () => {
		let calls = 0
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {
						calls++
					}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("q")
		})
		expect(calls).toBe(1)
	})

	test("ctrl+c invokes onQuit", async () => {
		let calls = 0
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {
						calls++
					}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressCtrlC()
		})
		expect(calls).toBe(1)
	})
})

describe("Browser — footer", () => {
	test("keeps the typed query live while applying the filter after debounce", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["alpha.md", "beta.md"])}
					readFile={makeReader({ "alpha.md": "a", "beta.md": "b" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("z")
		})
		await stepFrame(setup!.renderOnce)
		const immediate = setup!.captureCharFrame()
		expect(immediate).toContain("z▏")
		expect(immediate).not.toContain("No files match: z")

		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("No files match: z")
	})

	test("ctrl+\\ clears the applied filter immediately", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["alpha.md", "beta.md"])}
					readFile={makeReader({ "alpha.md": "a", "beta.md": "b" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("z")
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("No files match: z")

		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const cleared = setup!.captureCharFrame()
		expect(cleared).not.toContain("No files match: z")
		expect(cleared).toContain("▏")
		expect(cleared).not.toContain("z▏")
	})

	test("renders global + sidebar hints when sidebar is focused", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		expect(frame).toContain("q quit")
		expect(frame).toContain("? help")
		expect(frame).toContain("s sidebar")
		// sidebar.open hint surfaces because focus starts on sidebar.
		expect(frame).toContain("↵ open")
		// reader-only hints are absent.
		expect(frame).not.toContain("[ prev")
		expect(frame).not.toContain("] next")
	})

	test("switches to reader-specific hints when focus moves to the reader", async () => {
		// Needs ≥2 files for the `[`/`]` prev/next hints to appear — they're
		// gated on `inReaderWithSibling` (#115) so a single-file vault hides
		// them as there's nowhere to step to.
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		// Reader-only hints are active here; on this viewport the longer
		// shift+o / shift+e labels can push `esc back` off the clipped row.
		expect(frame).toContain("[ prev")
		expect(frame).toContain("] next")
		expect(frame).not.toContain("↵ open")
	})

	test("hides `[`/`]` hints in the reader when only one file is displayed", async () => {
		// #115: File-group siblings need an actual sibling. Single-file
		// vaults should not surface dead hints.
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		expect(frame).toContain("esc back")
		expect(frame).not.toContain("[ prev")
		expect(frame).not.toContain("] next")
	})

	test("notice replaces hints after a theme cycle", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("q quit")

		await act(async () => {
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		expect(frame).toContain("theme:")
		// hint row is replaced while the notice is live.
		expect(frame).not.toContain("q quit")
	})

	test("falls back to the first key when no full hint fits", async () => {
		// Ultra-narrow viewport: nothing like `q:quit` (6 chars) fits within
		// the usable width (terminal width minus 2 for padding).
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				{ width: 6, height: 12 },
			)
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		expect(frame).not.toContain("q quit")
		// At minimum the bare key for the first hint (`q`) should appear so
		// the row is not silently blank.
		expect(frame).toContain("q")
	})

	test("narrows the hint row to help-allowed bindings while help is open", async () => {
		const TALL_VIEWPORT = { width: 120, height: 50 }
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				TALL_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		// help-allowed hints survive; `?` is relabeled "close" since pressing
		// it now closes the overlay.
		expect(frame).toContain("? close")
		expect(frame).not.toContain("? help")
		expect(frame).toContain("t theme")
		// suppressed bindings disappear from the row.
		expect(frame).not.toContain("q quit")
		expect(frame).not.toContain("s sidebar")
	})
})

describe("Browser — theme cycling", () => {
	// t / T cycle through themeDefinitions; shift+L toggles tone.
	// We assert on colors.background and colors.border because they are
	// reliably distinct across most themes. We pick adjacent theme pairs
	// that are known to differ in at least one of those tokens.

	// Find two adjacent themes where resolved dark backgrounds differ so tests are stable.
	const startIdx = (() => {
		for (let i = 0; i < themeDefinitions.length; i++) {
			const a = themeDefinitions[i]
			const b = themeDefinitions[(i + 1) % themeDefinitions.length]
			if (a && b) {
				const bgA = resolveTheme(a.source, "dark").background
				const bgB = resolveTheme(b.source, "dark").background
				if (bgA !== bgB) return i
			}
		}
		return 0
	})()
	const startTheme = themeDefinitions[startIdx]!

	// Seed helper: initialise colors singleton AND atom state to a known theme.
	const seedTheme = (id: string, tone: "dark" | "light" = "dark") => {
		const def = themeDefinitions.find((d) => d.id === id)!
		setActiveTheme(def, tone)
		return [[themeAtom, { id, tone }]] as Iterable<readonly [any, any]>
	}

	test("t advances to the next theme (colors.background changes)", async () => {
		const iv = seedTheme(startTheme.id)
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
				iv,
			)
		})
		await stepFrame(setup!.renderOnce)

		const before = colors.background
		await act(async () => {
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)

		expect(colors.background).not.toBe(before)
	})

	test("T steps backward (t then T returns to original)", async () => {
		const iv = seedTheme(startTheme.id)
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
				iv,
			)
		})
		await stepFrame(setup!.renderOnce)

		const start = colors.background

		// advance one step
		await act(async () => {
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)
		expect(colors.background).not.toBe(start)

		// step back — should return to start
		await act(async () => {
			setup!.mockInput.pressKey("t", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(colors.background).toBe(start)
	})

	test("t wraps around — pressing t themeDefinitions.length times returns to start", async () => {
		const iv = seedTheme(startTheme.id)
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
				iv,
			)
		})
		await stepFrame(setup!.renderOnce)

		const start = colors.background

		for (let i = 0; i < themeDefinitions.length; i++) {
			await act(async () => {
				setup!.mockInput.pressKey("t")
			})
			await stepFrame(setup!.renderOnce)
		}

		expect(colors.background).toBe(start)
	})

	test("shift+L toggles tone (colors.background changes)", async () => {
		// Use the first theme that has a distinct light background to avoid false negatives.
		const toneTheme = themeDefinitions.find((d) => {
			const dark = resolveTheme(d.source, "dark")
			const light = resolveTheme(d.source, "light")
			return dark.background !== light.background
		})!
		const iv = seedTheme(toneTheme.id, "dark")
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
				iv,
			)
		})
		await stepFrame(setup!.renderOnce)

		const darkBg = colors.background
		await act(async () => {
			setup!.mockInput.pressKey("l", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		const lightBg = colors.background
		expect(lightBg).not.toBe(darkBg)

		// toggle back — should return to original dark background
		await act(async () => {
			setup!.mockInput.pressKey("l", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(colors.background).toBe(darkBg)
	})

	test("theme keys still cycle while the help overlay is open", async () => {
		const iv = seedTheme(startTheme.id)
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
				iv,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Open help.
		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)

		const start = colors.background

		// t advances while help is open.
		await act(async () => {
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)
		expect(colors.background).not.toBe(start)

		// T steps back to the original.
		await act(async () => {
			setup!.mockInput.pressKey("t", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(colors.background).toBe(start)
	})
})

// These tests pin down the current behaviour of the sidebar's virtualization
// math (scroll-clamp, visible window, selection-follows-scroll). They exist as
// a safety net for upcoming changes that perturb sidebarBodyHeight — most
// notably moving the filter input into the sidebar, which reserves one row
// above the file list and shrinks the body by one cell.
describe("Browser — sidebar virtualization", () => {
	// Viewport chosen to force a visible window strictly smaller than the
	// file list: height 11 → sidebarBodyHeight = 11 - 1 (footer) - 1 (header)
	// - 2 (pane borders) - 1 (filter row) = 6 rows. With 20 files, scrolling
	// is mandatory to see the tail.
	//
	// Width is wide enough (≥ SIDEBAR_MIN + DIVIDER + READER_MIN = 69) that
	// the inline two-pane layout is used; the drawer fallback at narrower
	// widths is exercised elsewhere.
	const TIGHT_VIEWPORT = { width: 90, height: 11 }
	// Filter-clamp test needs the Header to verify which file the reader
	// loaded after Esc. Body = 20 - 1 - 1 - 2 - 1 = 15 rows, still smaller
	// than 20 files so scrolling stays relevant.
	const TALL_VIEWPORT = { width: 90, height: 20 }
	const TWENTY_FILES = makeFiles(
		Array.from({ length: 20 }, (_, i) => `f${String(i).padStart(2, "0")}.md`),
	)
	const TWENTY_READER = makeReader(
		Object.fromEntries(TWENTY_FILES.map((f) => [f.relativePath, f.relativePath])),
	)

	test("initial frame shows only the first window of files", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={TWENTY_FILES}
					readFile={TWENTY_READER}
					onQuit={() => {}}
					sidebarMode="on"
				/>,
				TIGHT_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("f00.md")
		expect(frame).toContain("f05.md")
		// Beyond the 6-row body, files are scrolled out.
		expect(frame).not.toContain("f06.md")
		expect(frame).not.toContain("f19.md")
	})

	test("shift+G scrolls to the bottom; last file visible, first not", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={TWENTY_FILES}
					readFile={TWENTY_READER}
					onQuit={() => {}}
					sidebarMode="on"
				/>,
				TIGHT_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("g", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("f19.md")
		expect(frame).toContain("f14.md")
		// First files have scrolled off.
		expect(frame).not.toContain("f00.md")
		expect(frame).not.toContain("f13.md")
	})

	test("shift+G then g returns to the top window", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={TWENTY_FILES}
					readFile={TWENTY_READER}
					onQuit={() => {}}
					sidebarMode="on"
				/>,
				TIGHT_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("g", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("g")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("f00.md")
		expect(frame).toContain("f05.md")
		expect(frame).not.toContain("f06.md")
		expect(frame).not.toContain("f19.md")
	})

	test("j past the bottom of the visible window scrolls one row at a time", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={TWENTY_FILES}
					readFile={TWENTY_READER}
					onQuit={() => {}}
					sidebarMode="on"
				/>,
				TIGHT_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		// Press j 6 times: selectedIndex goes 0→6. Window was [0..5]; now must
		// shift down to keep index 6 in view → window becomes [1..6].
		await act(async () => {
			for (let i = 0; i < 6; i++) setup!.mockInput.pressKey("j")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("f06.md")
		expect(frame).toContain("f01.md")
		// The original top row has scrolled off.
		expect(frame).not.toContain("f00.md")
	})

	test("filter that shrinks the list past selectedIndex clamps without crashing", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={TWENTY_FILES}
					readFile={TWENTY_READER}
					onQuit={() => {}}
					sidebarMode="on"
				/>,
				TALL_VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		// Scroll to the bottom so selectedIndex is far past the post-filter length.
		await act(async () => {
			setup!.mockInput.pressKey("g", { shift: true })
		})
		await stepFrame(setup!.renderOnce)

		// Open filter and type a query that matches a single file early in the
		// list. selectedIndex was 19; displayedFiles.length collapses to 1.
		// The clamp effect must keep selection valid.
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("f")
			setup!.mockInput.pressKey("0")
			setup!.mockInput.pressKey("3")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Filtered list shows only f03.md.
		expect(frame).toContain("f03.md")
		expect(frame).not.toContain("f19.md")
		// On Esc the cursor should return to f03 (the highlighted match), not
		// f19, because closeFilter translates by path, not by numeric index.
		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "f03.md")).toBe(true)
	})

	test("user-driven selection is preserved when the filtered list expands", async () => {
		const reader = makeReader({ "readme-1.md": "1", "readme-2.md": "2", "readme-extra.md": "3" })
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["readme-1.md", "readme-2.md", "readme-extra.md"])}
					readFile={reader}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("r")
			setup!.mockInput.pressKey("e")
			setup!.mockInput.pressKey("a")
			setup!.mockInput.pressKey("d")
			setup!.mockInput.pressKey("m")
			setup!.mockInput.pressKey("e")
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("readme-1.md")
		expect(setup!.captureCharFrame()).toContain("readme-extra.md")

		await act(async () => {
			setup!.mockInput.pressArrow("down")
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "readme-2.md")).toBe(true)
	})
})

describe("Browser — sidebar filter row", () => {
	test("idle state shows '/ filter…' placeholder when no query is set", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md", "b.md"])}
					readFile={makeReader({ "a.md": "x", "b.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Placeholder visible, modal is not open (no cursor).
		expect(frame).toContain("> / to filter…")
		expect(frame).not.toContain("> ▏")
	})

	test("filter row is suppressed on an empty vault (no '/ filter…')", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={[]} readFile={makeReader({})} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("no markdown files")
		expect(frame).not.toContain("> / to filter…")
	})

	test("editing state shows the live query with a cursor", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["README.md", "notes.md"])}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("r")
			setup!.mockInput.pressKey("e")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("> re▏")
		// Placeholder gone while editing.
		expect(frame).not.toContain("> / to filter…")
	})

	test("applied state persists query after Return; no cursor visible", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["README.md", "docs/intro.md", "notes.md"])}
					readFile={makeReader({
						"README.md": "x",
						"docs/intro.md": "y",
						"notes.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Applied: prefix + query, no cursor.
		expect(frame).toContain("> int")
		expect(frame).not.toContain("> int▏")
		// Filtered list stays narrowed — non-matching files remain hidden.
		expect(frame).not.toContain("README.md")
		expect(frame).not.toContain("notes.md")
		// Reader has focus on the picked file.
		expect(readerTitleContains(frame, "docs/intro.md")).toBe(true)
	})

	test("re-opening / from applied state re-enters editing with the prior query intact", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["README.md", "docs/intro.md", "notes.md"])}
					readFile={makeReader({
						"README.md": "x",
						"docs/intro.md": "y",
						"notes.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		// Re-open from applied. Focus is on the reader after commit; `/`
		// auto-opens the filter regardless.
		await act(async () => {
			setup!.mockInput.pressKey("/")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Query carried into editing state with cursor.
		expect(frame).toContain("> int▏")
	})

	test("initialQuery seeds the applied filter on launch", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["README.md", "docs/intro.md", "notes.md"])}
					initialQuery="intro"
					readFile={makeReader({
						"README.md": "x",
						"docs/intro.md": "y",
						"notes.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("> intro")
		expect(frame).not.toContain("README.md")
		expect(frame).not.toContain("notes.md")
		expect(readerTitleContains(frame, "docs/intro.md")).toBe(true)
	})

	test("Esc keeps the typed query applied (close-without-revert)", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["README.md", "docs/intro.md", "notes.md"])}
					readFile={makeReader({
						"README.md": "x",
						"docs/intro.md": "y",
						"notes.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		// Commit "int" so we have an applied filter.
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		// Re-open, type more, then Esc.
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("r")
			setup!.mockInput.pressKey("o")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("> intro▏")

		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Typed query is preserved as the applied filter (no revert). Match
		// with trailing space to avoid colliding with the "docs/intro.md" file
		// row underneath.
		expect(frame).toContain("> intro ")
		expect(frame).not.toContain("> ▏")
		// Filtered list still narrowed.
		expect(frame).not.toContain("README.md")
		expect(frame).not.toContain("notes.md")
	})
})

describe("Browser — filter modal", () => {
	test("/ opens the filter; typed chars narrow the visible list", async () => {
		const files = makeFiles(["README.md", "docs/intro.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": "x",
						"docs/intro.md": "y",
						"notes.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
		})
		await stepFrame(setup!.renderOnce)
		// Filter input row visible.
		expect(setup!.captureCharFrame()).toContain("> ▏")

		await act(async () => {
			setup!.mockInput.pressKey("r")
			setup!.mockInput.pressKey("e")
			setup!.mockInput.pressKey("a")
		})
		await stepFrame(setup!.renderOnce)
		let frame = setup!.captureCharFrame()
		expect(frame).toContain("> rea")
		expect(frame).toContain("README.md")
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		frame = await waitForFrameContaining("README.md")
		// Non-matching paths are filtered out.
		expect(frame).not.toContain("notes.md")
		expect(frame).not.toContain("docs/intro.md")
	})

	test("escape closes the filter but keeps the query applied (no-revert)", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("r")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("> r▏")

		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Editing cursor gone; query "r" still applied — list stays narrowed.
		expect(frame).not.toContain("> r▏")
		expect(frame).toContain("> r ")
		expect(frame).toContain("README.md")
		expect(frame).not.toContain("notes.md")
	})

	test("enter closes the filter and focuses the reader on the match", async () => {
		const files = makeFiles(["README.md", "docs/intro.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": "x",
						"docs/intro.md": "y",
						"notes.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)
		// Typed input is live immediately; applied filter catches up after debounce.
		expect(setup!.captureCharFrame()).toContain("> int▏")
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		const narrowed = await waitForFrameContaining("intro.md  ·  docs")
		// Filter narrowed to the intro match; unrelated rows are gone once applied.
		expect(narrowed).not.toContain("notes.md")

		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Reader is now focused on docs/intro.md; filter is closed.
		expect(readerTitleContains(frame, "docs/intro.md")).toBe(true)
		expect(frame).not.toContain("> int▏")
	})

	test("backspace removes a query character and re-broadens the list", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("r")
			setup!.mockInput.pressKey("e")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("> re▏")
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("README.md")
		expect(setup!.captureCharFrame()).not.toContain("notes.md")

		await act(async () => {
			setup!.mockInput.pressBackspace()
			setup!.mockInput.pressBackspace()
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		const frame = await waitForFrameContaining("notes.md")
		// Query is empty; both files visible again.
		expect(frame).toContain("README.md")
		expect(frame).toContain("notes.md")
	})

	test("return translates the highlighted match back to its full-list index", async () => {
		// One match for "readme" — docs/readme.md, at full-list index 3.
		// The user does NOT arrow down, so the filtered cursor is at index 0.
		// Without translation, closing the filter would land selectedIndex=0
		// on alpha.md (the file at full-list index 0). With translation, the
		// reader opens docs/readme.md.
		const files = makeFiles(["alpha.md", "beta.md", "gamma.md", "docs/readme.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"alpha.md": "a",
						"beta.md": "b",
						"gamma.md": "g",
						"docs/readme.md": "d",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("r")
			setup!.mockInput.pressKey("e")
			setup!.mockInput.pressKey("a")
			setup!.mockInput.pressKey("d")
			setup!.mockInput.pressKey("m")
			setup!.mockInput.pressKey("e")
		})
		await stepFrame(setup!.renderOnce)
		// Typed query is live immediately; applied narrowing happens after debounce.
		expect(setup!.captureCharFrame()).toContain("> readme▏")
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		const narrowed = await waitForFrameContaining("readme.md  ·  docs")
		// Sanity: filter narrowed to the docs/readme match.
		expect(narrowed).not.toContain("alpha.md")
		expect(narrowed).not.toContain("beta.md")
		expect(narrowed).not.toContain("gamma.md")

		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(readerTitleContains(frame, "docs/readme.md")).toBe(true)
		// Specifically not alpha.md (full-list[0]) — the bug case.
		expect(readerTitleContains(frame, "alpha.md")).toBe(false)
	})

	test("escape keeps the cursor on the highlighted match", async () => {
		// With no-revert Esc, the filtered list shape doesn't change on
		// close — selectedIndex stays valid and the cursor stays on the
		// match it was on. Regression guard against any future logic that
		// might mutate selection on close.
		const files = makeFiles(["alpha.md", "beta.md", "gamma.md", "docs/readme.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"alpha.md": "a",
						"beta.md": "b",
						"gamma.md": "g",
						"docs/readme.md": "d",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("r")
			setup!.mockInput.pressKey("e")
			setup!.mockInput.pressKey("a")
			setup!.mockInput.pressKey("d")
			setup!.mockInput.pressKey("m")
			setup!.mockInput.pressKey("e")
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Filter closed (no editing cursor); query "readme" still applied so
		// only the match is visible in the sidebar.
		expect(frame).not.toContain("> readme▏")
		expect(frame).toContain("> readme ")
		expect(frame).not.toContain("alpha.md")
		expect(frame).not.toContain("beta.md")
		expect(frame).not.toContain("gamma.md")
		expect(frame).toContain("docs/readme.md")
		// Reader title reflects docs/readme.md — the file under the cursor
		// when Esc fired.
		expect(readerTitleContains(frame, "docs/readme.md")).toBe(true)
		// Cancel keeps focus in the sidebar when the layout is inline so
		// j/k keeps walking the restored list. Drawer dismissal only
		// applies when the sidebar was up purely because of focus. See
		// DESIGN.md §7.1.
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
	})

	test("up/down arrows navigate the filtered list", async () => {
		// 3 matches for "doc": docs/a.md, docs/b.md, docs/c.md. Down-arrow
		// twice → cursor on filtered[2]; Return opens that file.
		const files = makeFiles(["docs/a.md", "docs/b.md", "docs/c.md", "unrelated.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"docs/a.md": "1",
						"docs/b.md": "2",
						"docs/c.md": "3",
						"unrelated.md": "4",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("d")
			setup!.mockInput.pressKey("o")
			setup!.mockInput.pressKey("c")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("> doc▏")
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("a.md  ·  docs")
		expect(setup!.captureCharFrame()).not.toContain("unrelated.md")

		await act(async () => {
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		// docs/c.md was filtered[2]; Return must open it, not docs/a.md.
		expect(readerTitleContains(setup!.captureCharFrame(), "docs/c.md")).toBe(true)
	})

	test("up clamps at the top; down clamps at the bottom of the filtered list", async () => {
		const files = makeFiles(["docs/a.md", "docs/b.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "docs/a.md": "1", "docs/b.md": "2" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Filter is wide-open (empty query) — exercise plain arrow clamping.
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressArrow("up")
			setup!.mockInput.pressArrow("up")
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		// Still on docs/a.md (clamped at top).
		expect(readerTitleContains(setup!.captureCharFrame(), "docs/a.md")).toBe(true)
	})

	test("/ from reader focus auto-opens the filter and moves focus to the sidebar", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressTab()
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("/")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Filter input is up.
		expect(frame).toContain("> ▏")
		// Sidebar is focused (the modal needs a home).
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
	})

	test("/ from hidden sidebar auto-opens the sidebar and focuses the filter", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Hide sidebar.
		await act(async () => {
			setup!.mockInput.pressKey("s")
		})
		await stepFrame(setup!.renderOnce)
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)

		// `/` should bring the sidebar back with the filter open.
		await act(async () => {
			setup!.mockInput.pressKey("/")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("> ▏")
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
	})

	test("Esc with no typing restores prior sidebar visibility", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Hide → open filter (auto-reveals) → Esc with no input → sidebar hidden again.
		await act(async () => {
			setup!.mockInput.pressKey("s")
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("/")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("> ▏")

		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).not.toContain("> ▏")
		// Restored to hidden.
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)
	})

	test("Esc after typing keeps the query applied and dismisses the drawer", async () => {
		// Under DESIGN.md §7.1, Esc always returns focus to the reader,
		// which dismisses any drawer-by-focus. The pre-#22 behavior of
		// "leave the sidebar open if the user typed" is gone — the
		// userTyped distinction does not exist anymore. Note: with the
		// no-revert Esc semantics, the typed query stays applied even
		// though the drawer goes away — the next `/` will resume editing
		// it.
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Hide sidebar (shown=false, focus=reader).
		await act(async () => {
			setup!.mockInput.pressKey("s")
		})
		await stepFrame(setup!.renderOnce)
		// `/` opens the filter as a drawer; type "r".
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("r")
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Filter input gone (no editing cursor); drawer dismissed (shown=false,
		// focus=reader). Query "r" is kept as the applied filter; reopening
		// with `/` would resume editing it.
		expect(frame).not.toContain("> r▏")
		expect(sidebarIsVisible(setup!.captureCharFrame())).toBe(false)
	})

	test("/ does nothing while the help overlay is open", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				{ width: 120, height: 50 },
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)
		// Help overlay open
		expect(setup!.captureCharFrame()).toContain("Help")

		await act(async () => {
			setup!.mockInput.pressKey("/")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Help is still open; no filter input.
		expect(frame).toContain("Help")
		expect(frame).not.toContain("> ▏")
	})

	test("backspace at empty query closes the modal (removes the slash)", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
		})
		await stepFrame(setup!.renderOnce)
		// Sanity: modal is up.
		expect(setup!.captureCharFrame()).toContain("> ▏")

		await act(async () => {
			setup!.mockInput.pressBackspace()
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Editing cursor gone; idle placeholder back.
		expect(frame).not.toContain("> ▏")
		expect(frame).toContain("> / to filter…")
		// Both files still visible (no committed filter).
		expect(frame).toContain("README.md")
		expect(frame).toContain("notes.md")
	})

	test("backspace past empty from applied state closes with the (now empty) query", async () => {
		const files = makeFiles(["README.md", "docs/intro.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": "x",
						"docs/intro.md": "y",
						"notes.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		// Commit an applied filter "> int".
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)

		// Re-open and delete all three chars; the fourth backspace closes the
		// modal. With no-revert semantics, the applied query is now empty —
		// the full list comes back.
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressBackspace()
			setup!.mockInput.pressBackspace()
			setup!.mockInput.pressBackspace()
			setup!.mockInput.pressBackspace()
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Editing cursor gone; idle placeholder back.
		expect(frame).not.toContain("> ▏")
		expect(frame).toContain("> / to filter…")
		// Filter cleared — full list visible.
		expect(frame).toContain("README.md")
		expect(frame).toContain("notes.md")
	})

	test("return with zero matches closes the filter and keeps focus in the inline sidebar", async () => {
		// On a zero-match list there's nothing to commit, so Return is treated
		// as Esc: closes the modal with the typed query still applied. With
		// the sidebar inline (shown && fits) focus stays in the sidebar so
		// j/k continues to walk the list. The "stranded with no visible
		// files" trade-off is tracked in the linked issue — recovery is
		// Ctrl+U (inside filter) or `/` then backspace.
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("z")
			setup!.mockInput.pressKey("z")
			setup!.mockInput.pressKey("z")
		})
		await stepFrame(setup!.renderOnce)
		// Typed input is live immediately; zero-match state appears after debounce.
		expect(setup!.captureCharFrame()).toContain("> zzz▏")
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await waitForFrameContaining("No files match: zzz")

		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Filter closed (no editing cursor); zero-match query "zzz" stays
		// applied, so the list remains empty. Sidebar still focused.
		expect(frame).not.toContain("> zzz▏")
		expect(frame).toContain("> zzz ")
		expect(frame).not.toContain("README.md")
		expect(frame).not.toContain("notes.md")
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(true)
	})

	test("zero-match empty state explains how to recover from an applied filter", async () => {
		setReaderEmptyStateTipRotationForTests(0)
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
					sidebarMode="off"
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("z")
			setup!.mockInput.pressKey("z")
			setup!.mockInput.pressKey("z")
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})

		const frame = await waitForFrameContaining("No files match: zzz")

		expect(frame).toContain("No files match: zzz")
		expect(frame).toContain("Press / to reopen the current filter and keep refining it.")
		expect(frame).not.toContain("Press ctrl+\\ to clear the current filter and start over.")
		expect(frame).not.toContain(
			"Use [ and ] to move through files while the current filter stays applied.",
		)
	})

	test("ctrl+\\ inside the filter modal clears the input but stays in filter mode", async () => {
		const files = makeFiles(["README.md", "notes.md", "docs/intro.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": "x",
						"notes.md": "y",
						"docs/intro.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Type "int" → list narrows to docs/intro.md.
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("> int▏")

		// Ctrl+\ clears the input but does NOT close filter mode.
		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Editing cursor still present on an empty query.
		expect(frame).toContain("> ▏")
		// Full list back.
		expect(frame).toContain("README.md")
		expect(frame).toContain("notes.md")
	})

	test("ctrl+u inside the filter modal does NOT clear (reserved for sidebar/reader page-up)", async () => {
		const files = makeFiles(["README.md", "notes.md", "docs/intro.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": "x",
						"notes.md": "y",
						"docs/intro.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("> int▏")

		await act(async () => {
			setup!.mockInput.pressKey("u", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Query unchanged; modal still open. Ctrl+U is swallowed inside the
		// filter input — its sidebar page-up binding doesn't fire either,
		// since the keymap doesn't see keys while filter is open.
		expect(frame).toContain("> int▏")
	})

	test("ctrl+\\ from sidebar with an applied filter clears it and reopens the modal", async () => {
		const files = makeFiles(["README.md", "notes.md", "docs/intro.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": "x",
						"notes.md": "y",
						"docs/intro.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		// Commit "int" then close filter mode by hitting Esc (no-revert: query
		// stays applied, sidebar narrowed to docs/intro.md).
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		// Sanity: filter is closed and "> int " is applied.
		expect(setup!.captureCharFrame()).toContain("> int ")

		// Ctrl+\ from the sidebar: clear + reopen.
		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Editing cursor present on an empty query; full list back.
		expect(frame).toContain("> ▏")
		expect(frame).toContain("README.md")
		expect(frame).toContain("notes.md")
		expect(frame).toContain("intro.md")
	})

	test("ctrl+\\ from the reader with an applied filter clears, opens, and focuses the sidebar", async () => {
		const files = makeFiles(["README.md", "notes.md", "docs/intro.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": "x",
						"notes.md": "y",
						"docs/intro.md": "z",
					})}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		// Apply a filter and commit on the match (focus → reader).
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
			setup!.mockInput.pressEnter()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)

		// Ctrl+\ from the reader: should move focus to sidebar, clear, open.
		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("> ▏")
		expect(frame).toContain("README.md")
		expect(frame).toContain("notes.md")
	})

	test("ctrl+\\ from idle (no filter applied) opens the filter fresh", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		// No filter applied (idle).
		expect(setup!.captureCharFrame()).toContain("> / to filter…")

		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Editing cursor on empty query — equivalent to pressing `/`.
		expect(frame).toContain("> ▏")
	})

	test("ctrl+\\ with the command palette open is swallowed (palette stays, no filter open)", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Open palette.
		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("Commands")

		// Ctrl+\ while palette open: should be swallowed by the palette
		// modal (matches its general ctrl-modified-key swallow rule), not
		// tear it down to open the filter.
		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Palette still up.
		expect(frame).toContain("Commands")
		// Filter modal is NOT open — sidebar row shows the idle placeholder,
		// not the editing chevron. (Both palette and filter inputs use "> ▏",
		// so check the sidebar row text specifically.)
		expect(frame).toContain("> / to filter…")
	})

	test("ctrl+\\ with the help overlay open is swallowed (help stays, no filter open)", async () => {
		const files = makeFiles(["README.md", "notes.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "notes.md": "y" })}
					onQuit={() => {}}
				/>,
				{ width: 120, height: 50 },
			)
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("Help")

		await act(async () => {
			setup!.mockInput.pressKey("\\", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Help still up; no filter editing cursor.
		expect(frame).toContain("Help")
		expect(frame).not.toContain("> ▏")
	})

	test("footer shows `ctrl+\\ clear` only when a filter is applied and no modal is open", async () => {
		const files = makeFiles(["README.md", "notes.md", "docs/intro.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({
						"README.md": "x",
						"notes.md": "y",
						"docs/intro.md": "z",
					})}
					onQuit={() => {}}
				/>,
				{ width: 160, height: 40 },
			)
		})
		await stepFrame(setup!.renderOnce)
		// Idle (no filter): hint absent.
		expect(setup!.captureCharFrame()).not.toContain("ctrl+\\ clear")

		// Apply a filter and close the modal (no-revert Esc keeps it applied).
		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("n")
			setup!.mockInput.pressKey("t")
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		// Hint now visible.
		expect(setup!.captureCharFrame()).toContain("ctrl+\\ clear")

		// Open the palette: hint should disappear (palette ctx hides it).
		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("ctrl+\\ clear")

		// Close palette, open help: hint should also be hidden under help.
		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain("ctrl+\\ clear")
	})

	test("printable characters do not fire their normal bindings while filter is open", async () => {
		// `s` would normally toggle the sidebar. While filter is open it must
		// be treated as input.
		const files = makeFiles(["README.md", "scripts/build.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x", "scripts/build.md": "y" })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("/")
			setup!.mockInput.pressKey("s")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Sidebar still visible; `s` went into the query.
		expect(frame).toContain("> s▏")
		expect(frame).toContain("build.md  ·  scripts")
		// The filter hasn't applied yet; this test only asserts that `s` was
		// captured as input and did not toggle the sidebar binding.
	})
})

describe("Browser — command palette", () => {
	test("ctrl+p opens the palette and shows the Commands title", async () => {
		const files = makeFiles(["README.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={files} readFile={makeReader({ "README.md": "x" })} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("Commands")
		// Default-visible command titles from the annotation map are shown.
		expect(frame).toContain("Toggle sidebar")
		expect(frame).toContain("Quit")
	})

	test("Esc closes the palette", async () => {
		const files = makeFiles(["README.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={files} readFile={makeReader({ "README.md": "x" })} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("Commands")

		await act(async () => {
			setup!.mockInput.pressEscape()
			// Escape is `\x1b`, the lead of escape sequences. The parser waits
			// before emitting — see the existing filter tests.
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain(" Commands ")
	})

	test("typing narrows the palette list by fuzzy match", async () => {
		const files = makeFiles(["README.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={files} readFile={makeReader({ "README.md": "x" })} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
			setup!.mockInput.pressKey("t")
			setup!.mockInput.pressKey("h")
			setup!.mockInput.pressKey("e")
			setup!.mockInput.pressKey("m")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("Next theme")
		expect(frame).toContain("Previous theme")
		// Non-matching commands drop out.
		expect(frame).not.toContain("Quit")
		expect(frame).not.toContain("Toggle sidebar")
	})

	test("Return runs the selected command (quit fires onQuit)", async () => {
		let quitCalls = 0
		const files = makeFiles(["README.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x" })}
					onQuit={() => {
						quitCalls++
					}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// Filter to a single "Quit" match, then Return.
		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
			setup!.mockInput.pressKey("q")
			setup!.mockInput.pressKey("u")
			setup!.mockInput.pressKey("i")
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)
		expect(quitCalls).toBe(1)
	})

	test("rapid Down then Return runs the highlighted command, not the previous command", async () => {
		let quitCalls = 0
		const files = makeFiles(["README.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "README.md": "x" })}
					onQuit={() => {
						quitCalls++
					}}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		// These keys can arrive in one React batch in a real terminal. Palette
		// navigation must update the command index synchronously before Return
		// reads it, otherwise Return runs the previous row (`Quit`).
		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressEnter()
		})
		await stepFrame(setup!.renderOnce)

		expect(quitCalls).toBe(0)
		expect(sidebarIsFocused(setup!.captureSpans(), setup!.captureCharFrame())).toBe(false)
		expect(readerTitleContains(setup!.captureCharFrame(), "README.md")).toBe(true)
	})

	test("ctrl+p a second time closes the palette (toggle)", async () => {
		const files = makeFiles(["README.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser files={files} readFile={makeReader({ "README.md": "x" })} onQuit={() => {}} />,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)

		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain(" Commands ")

		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain(" Commands ")
	})

	test("regression: arrow keys in the palette do NOT scroll the reader", async () => {
		// Bug: opentui's <scrollbox focused> consumes arrow keys *before* React's
		// useKeyboard fires, so palette navigation also scrolled the reader.
		// Fix: the scrollbox unfocuses while the palette (or help) is open.
		// This test would fail with `focused={readerActive}` and passes with
		// `focused={readerActive && !paletteOpen && !helpVisible}`.
		// Avoid `_` in the marker — markdown italicizes underscore-delimited
		// runs and our scrubber drops them from the rendered cells.
		const longContent = Array.from(
			{ length: 80 },
			(_, i) => `MARKER${String(i).padStart(2, "0")}`,
		).join("\n")
		const files = makeFiles(["doc.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "doc.md": longContent })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await waitForFrameContaining("MARKER00")

		// Move focus to the reader so the scrollbox is "focused" (the
		// preconditioned state that exhibits the bug). Right-arrow from the
		// sidebar moves focus to the reader.
		await act(async () => {
			setup!.mockInput.pressArrow("right")
		})
		await stepFrame(setup!.renderOnce)
		const beforeFrame = setup!.captureCharFrame()
		expect(beforeFrame).toContain("MARKER00")

		// Open the palette and arrow down a bunch.
		await act(async () => {
			setup!.mockInput.pressKey("p", { ctrl: true })
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
		})
		await stepFrame(setup!.renderOnce)
		const duringFrame = setup!.captureCharFrame()
		// Palette is up.
		expect(duringFrame).toContain(" Commands ")
		// Reader has NOT scrolled — the top line is still on screen behind
		// the palette overlay. With the old `focused={readerActive}` code,
		// MARKER00 would have scrolled out of the visible viewport.
		expect(duringFrame).toContain("MARKER00")
	})

	test("regression: arrow keys with help open do NOT scroll the reader", async () => {
		// Same root cause as the palette regression: the scrollbox stole
		// arrow keys when the reader was focused, even with the help overlay
		// up. Help itself doesn't react to arrows, so the user could observe
		// silent scrolling while reading the help text.
		const longContent = Array.from(
			{ length: 80 },
			(_, i) => `MARKER${String(i).padStart(2, "0")}`,
		).join("\n")
		const files = makeFiles(["doc.md"])
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={files}
					readFile={makeReader({ "doc.md": longContent })}
					onQuit={() => {}}
				/>,
				VIEWPORT,
			)
		})
		await settleBrowser()

		await act(async () => {
			setup!.mockInput.pressArrow("right")
		})
		await stepFrame(setup!.renderOnce)
		expect(await waitForFrameContaining("MARKER00")).toContain("MARKER00")

		await act(async () => {
			setup!.mockInput.pressKey("?")
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain("Help")
		await act(async () => {
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
			setup!.mockInput.pressArrow("down")
		})
		await stepFrame(setup!.renderOnce)

		// Close help — the overlay covers MARKER00 visually even when the
		// reader hasn't scrolled, so we have to dismiss it before asserting.
		await act(async () => {
			setup!.mockInput.pressEscape()
			await new Promise<void>((resolve) => setTimeout(resolve, 60))
		})
		await stepFrame(setup!.renderOnce)
		const frame = await waitForFrameContaining("MARKER00")
		expect(frame).not.toContain(" Help ")
		// Reader did not scroll — first line is still at the top.
		expect(frame).toContain("MARKER00")
	})
})

describe("Browser — updateNotice", () => {
	const TEXT = "update available: 0.5.0 (current 0.4.0)"

	test("renders the update notice in the footer when the prop is set", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
					updateNotice={TEXT}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain(TEXT)
	})

	test("a transient toast (theme cycle) preempts an active update notice", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
					updateNotice={TEXT}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain(TEXT)

		await act(async () => {
			setup!.mockInput.pressKey("t")
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("theme:")
		// The longer update text is gone; the slot now carries the theme toast.
		expect(frame).not.toContain(TEXT)
	})

	test("after the update notice TTL expires the hint row returns", async () => {
		// Use a tiny TTL via the prop so this test runs in ~50ms instead of
		// sleeping the production 10s window.
		const ttlMs = 30
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
					updateNotice={TEXT}
					updateNoticeTtlMs={ttlMs}
				/>,
				VIEWPORT,
			)
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).toContain(TEXT)

		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, ttlMs + 20))
			await setup!.renderOnce()
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).not.toContain(TEXT)
		expect(frame).toContain("q quit")
	})
})

describe("Browser — discovery toggle (#145)", () => {
	// A small stateful wrapper that mirrors DiscoverShell's role: it owns the
	// `all` flag and switches between two file sets when Browser asks for a
	// toggle. We don't run the real walker here — the unit under test is the
	// Browser's selection-preservation behaviour, not the file stream.
	const VISIBLE = ["readme.md", "docs/intro.md"]
	const WITH_HIDDEN = [".hidden.md", "readme.md", "docs/intro.md"]

	const Wrapper = ({ initialAll = false }: { readonly initialAll?: boolean }) => {
		// Mirrors DiscoverShell's shift+a sugar: the toggle round-trips
		// between "no categories" and "every category". Everywhere else in
		// the system the categories are independent — this collapse only
		// exists because the UI keybind is the one place we treat them
		// as a single thing.
		const [showAll, setShowAll] = React.useState(initialAll)
		const files = makeFiles(showAll ? WITH_HIDDEN : VISIBLE)
		return (
			<Browser
				files={files}
				readFile={makeReader(
					Object.fromEntries([...VISIBLE, ...WITH_HIDDEN].map((f) => [f, `# ${f}`])),
				)}
				onQuit={() => {}}
				onToggleAll={() => setShowAll((v) => !v)}
				initialIndex={initialAll ? WITH_HIDDEN.indexOf(".hidden.md") : 0}
			/>
		)
	}

	test("toggle on: a non-hidden selection survives the re-walk", async () => {
		await act(async () => {
			setup = await renderBrowser(<Wrapper />, VIEWPORT)
		})
		await stepFrame(setup!.renderOnce)

		// Start on readme.md (index 0). Move to docs/intro.md so we have a
		// non-trivial selection to preserve.
		await act(async () => {
			setup!.mockInput.pressKey("j")
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), "docs/intro.md")).toBe(true)

		await act(async () => {
			setup!.mockInput.pressKey("a", { shift: true })
		})
		await stepFrame(setup!.renderOnce)

		const frame = setup!.captureCharFrame()
		// Hidden file is now in the sidebar.
		expect(frame).toContain(".hidden.md")
		// Selection sticks on docs/intro.md even though a new entry showed up first.
		expect(readerTitleContains(frame, "docs/intro.md")).toBe(true)
	})

	test("toggle off: selection on a hidden file restores when toggled back on", async () => {
		await act(async () => {
			setup = await renderBrowser(<Wrapper initialAll={true} />, VIEWPORT)
		})
		await stepFrame(setup!.renderOnce)
		// .hidden.md is selected initially.
		expect(readerTitleContains(setup!.captureCharFrame(), ".hidden.md")).toBe(true)

		// Toggle off: the hidden file disappears from the list. Pending ref
		// stays armed; visible selection falls to the first remaining entry.
		await act(async () => {
			setup!.mockInput.pressKey("a", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		expect(setup!.captureCharFrame()).not.toContain(".hidden.md")

		// Toggle back on: hidden file returns, pending restores selection.
		await act(async () => {
			setup!.mockInput.pressKey("a", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain(".hidden.md")
		expect(readerTitleContains(frame, ".hidden.md")).toBe(true)
	})

	test("pressing j after a toggle-off clears pending: original selection is not restored", async () => {
		await act(async () => {
			setup = await renderBrowser(<Wrapper initialAll={true} />, VIEWPORT)
		})
		await stepFrame(setup!.renderOnce)
		expect(readerTitleContains(setup!.captureCharFrame(), ".hidden.md")).toBe(true)

		// Toggle off (pending = .hidden.md), then user-driven j clears pending.
		await act(async () => {
			setup!.mockInput.pressKey("a", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		await act(async () => {
			setup!.mockInput.pressKey("j")
		})
		await stepFrame(setup!.renderOnce)

		// Toggle back on: hidden file is in the list again, but selection
		// should NOT snap back to it — pending was cleared by `j`.
		await act(async () => {
			setup!.mockInput.pressKey("a", { shift: true })
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain(".hidden.md")
		expect(readerTitleContains(frame, ".hidden.md")).toBe(false)
	})
})

describe("Browser — header", () => {
	test("renders brand mark and version on a tall viewport", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				{ width: 120, height: 30 },
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		// Brand: ⌂ + " " + "house". Version: "v" + something with digits.
		expect(frame).toContain("⌂ house")
		expect(frame).toMatch(/v\d+\.\d+\.\d+/)
	})

	test("renders the header even on short viewports", async () => {
		await act(async () => {
			setup = await renderBrowser(
				<Browser
					files={makeFiles(["a.md"])}
					readFile={makeReader({ "a.md": "x" })}
					onQuit={() => {}}
				/>,
				{ width: 120, height: 8 },
			)
		})
		await stepFrame(setup!.renderOnce)
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("⌂ house")
	})
})
