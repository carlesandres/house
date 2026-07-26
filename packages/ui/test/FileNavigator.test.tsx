import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import type { CapturedFrame } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { act, useState } from "react"
import { FileNavigator, useFileNavigator } from "../src/index.ts"
import type {
	FileNavigatorController,
	FileNavigatorEmptyState,
	FileNavigatorTheme,
	FileNavigatorVariant,
	FileRowRenderContext,
} from "../src/index.ts"
import { formatFileRow } from "../src/file-navigator/row.tsx"

interface FileItem {
	readonly id: string
	readonly path: string
}

const file = (path: string): FileItem => ({ id: path, path })
const files = (count: number): readonly FileItem[] =>
	Array.from({ length: count }, (_, index) => file(`f${index}.md`))
const theme: FileNavigatorTheme = {
	background: "#102030",
	backgroundPanel: "#203040",
	backgroundElement: "#304050",
	text: "#405060",
	textMuted: "#506070",
	border: "#607080",
	selectedListItemText: "#708090",
}
const VIEWPORT = { width: 50, height: 14 }

beforeAll(() => {
	// @ts-expect-error React's act environment flag is intentionally global.
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let setup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
	if (!setup) return
	await act(async () => {
		setup!.renderer.destroy()
		await Promise.resolve()
	})
	setup = null
})

interface ViewState {
	readonly files: readonly FileItem[]
	readonly width: number
	readonly paneHeight: number
	readonly variant: FileNavigatorVariant
	readonly active: boolean
	readonly visible: boolean
	readonly header: React.ReactNode
	readonly emptyState: FileNavigatorEmptyState | undefined
	readonly renderFile: ((context: FileRowRenderContext<FileItem>) => React.ReactNode) | undefined
}

interface Harness {
	readonly controller: () => FileNavigatorController<FileItem, string>
	readonly update: (patch: Partial<ViewState>) => Promise<void>
}

const renderNavigator = async (overrides: Partial<ViewState> = {}): Promise<Harness> => {
	const initial: ViewState = {
		files: [file("docs/intro.md"), file("README.md")],
		width: 28,
		paneHeight: 8,
		variant: "inline",
		active: true,
		visible: true,
		header: null,
		emptyState: undefined,
		renderFile: undefined,
		...overrides,
	}
	let latest: FileNavigatorController<FileItem, string> | null = null
	let updateState: ((patch: Partial<ViewState>) => void) | null = null

	const Harness = () => {
		const [state, setState] = useState(initial)
		updateState = (patch) => setState((current) => ({ ...current, ...patch }))
		latest = useFileNavigator({
			files: state.files,
			query: "",
			getId: (item) => item.id,
			getPath: (item) => item.path,
			filter: (items) => items,
		})
		return (
			<FileNavigator
				controller={latest}
				width={state.width}
				paneHeight={state.paneHeight}
				variant={state.variant}
				active={state.active}
				visible={state.visible}
				theme={theme}
				{...(state.header === undefined ? {} : { header: state.header })}
				{...(state.emptyState === undefined ? {} : { emptyState: state.emptyState })}
				{...(state.renderFile === undefined ? {} : { renderFile: state.renderFile })}
			/>
		)
	}

	await act(async () => {
		setup = await testRender(<Harness />, VIEWPORT)
	})
	return {
		controller: () => latest!,
		update: async (patch) => {
			await act(async () => {
				updateState!(patch)
			})
			await act(async () => {
				await setup!.renderOnce()
			})
		},
	}
}

const hasColor = (frame: CapturedFrame, role: "fg" | "bg", color: string): boolean => {
	const expected = RGBA.fromHex(color)
	return frame.lines.some((line) =>
		line.spans.some((span) => {
			const actual = role === "fg" ? span.fg : span.bg
			return actual !== null && expected.equals(actual)
		}),
	)
}

describe("formatFileRow", () => {
	test("keeps root and fitting nested paths basename-first", () => {
		expect(formatFileRow("README.md", 30)).toEqual({
			basename: "README.md",
			separator: "",
			parent: "",
		})
		expect(formatFileRow("docs/intro.md", 40)).toEqual({
			basename: "intro.md",
			separator: " ",
			parent: "docs",
		})
		expect(formatFileRow("a/b/c/intro.md", 40).parent).toBe("a/b/c")
	})

	test("middle-truncates parent paths and preserves both ends", () => {
		const result = formatFileRow("site-packages/conda-23.7.4.dist-info/licenses/AUTHORS.md", 40)
		expect(result.basename).toBe("AUTHORS.md")
		expect(result.parent).toBe("site-packages/…-info/licenses")
		expect(result.parent.startsWith("site-packages")).toBe(true)
		expect(result.parent.endsWith("/licenses")).toBe(true)
	})

	test("drops undersized parents and tail-truncates an overflowing basename", () => {
		expect(formatFileRow("some/dir/README.md", 12)).toEqual({
			basename: "README.md",
			separator: "",
			parent: "",
		})
		const result = formatFileRow("dir/this-filename-is-way-too-long.md", 12)
		expect(result.parent).toBe("")
		expect(result.basename).toHaveLength(12)
		expect(result.basename.endsWith("…")).toBe(true)
	})
})

describe("FileNavigator", () => {
	test("renders basename-first rows and every semantic theme token", async () => {
		await renderNavigator()
		const chars = setup!.captureCharFrame()
		expect(chars).toContain("intro.md docs")
		expect(chars).toContain("README.md")

		const spans = setup!.captureSpans()
		expect(hasColor(spans, "bg", theme.background)).toBe(true)
		expect(hasColor(spans, "bg", theme.backgroundPanel)).toBe(true)
		expect(hasColor(spans, "bg", theme.backgroundElement)).toBe(true)
		expect(hasColor(spans, "fg", theme.text)).toBe(true)
		expect(hasColor(spans, "fg", theme.textMuted)).toBe(true)
		expect(hasColor(spans, "fg", theme.border)).toBe(true)
		expect(hasColor(spans, "fg", theme.selectedListItemText)).toBe(true)
	})

	test("renders a custom file row inside the pane row", async () => {
		await renderNavigator({
			renderFile: ({ file: item, index, width }) => (
				<text content={`custom:${index}:${item.id}:${width}`} />
			),
		})
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("custom:0:docs/intro.md:26")
		expect(frame).not.toContain("intro.md docs")
	})

	test("renders optional header and configurable empty state with a spacer", async () => {
		await renderNavigator({
			files: [],
			header: <text content="FILTER" />,
			emptyState: { label: "No matches", value: "needle" },
		})
		const lines = setup!.captureCharFrame().split("\n")
		const header = lines.findIndex((line) => line.includes("FILTER"))
		const message = lines.findIndex(
			(line) => line.includes("No matches") && line.includes('"needle"'),
		)
		expect(header).toBeGreaterThanOrEqual(0)
		expect(message).toBe(header + 2)
	})

	test("uses junction borders inline and plain top/bottom borders stacked", async () => {
		const harness = await renderNavigator()
		let frame = setup!.captureCharFrame()
		expect(frame).toContain("┬")
		expect(frame).toContain("┴")
		expect(frame).toContain("│")

		await harness.update({ variant: "stacked" })
		frame = setup!.captureCharFrame()
		expect(frame).not.toContain("┬")
		expect(frame).not.toContain("┴")
		expect(frame).not.toContain("│")
	})

	test("limits visible rows and follows selection in the current render", async () => {
		const harness = await renderNavigator({ files: files(10), paneHeight: 6 })
		let frame = setup!.captureCharFrame()
		expect(frame).toContain("f0.md")
		expect(frame).toContain("f3.md")
		expect(frame).not.toContain("f4.md")

		await act(async () => {
			harness.controller().selectLast()
		})
		await act(async () => {
			await setup!.renderOnce()
		})
		frame = setup!.captureCharFrame()
		expect(frame).toContain("f6.md")
		expect(frame).toContain("f9.md")
		expect(frame).not.toContain("f5.md")
	})

	test("clamps scroll after resize and list shrink", async () => {
		const harness = await renderNavigator({ files: files(10), paneHeight: 6 })
		await act(async () => {
			harness.controller().selectLast()
		})
		await act(async () => {
			await setup!.renderOnce()
		})
		await harness.update({ paneHeight: 10 })
		let frame = setup!.captureCharFrame()
		expect(frame).toContain("f2.md")
		expect(frame).not.toContain("f1.md")

		await harness.update({ files: files(3) })
		frame = setup!.captureCharFrame()
		expect(frame).toContain("f0.md")
		expect(frame).toContain("f2.md")
	})

	test("preserves a retained non-default window while hidden", async () => {
		const harness = await renderNavigator({ files: files(10), paneHeight: 6 })
		await act(async () => {
			harness.controller().selectLast()
		})
		await act(async () => {
			await setup!.renderOnce()
		})
		await act(async () => {
			harness.controller().moveBy(-2)
		})
		await act(async () => {
			await setup!.renderOnce()
		})
		await harness.update({ visible: false })
		expect(setup!.captureCharFrame().trim()).toBe("")
		await harness.update({ visible: true })
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("f6.md")
		expect(frame).toContain("f9.md")
		expect(frame).not.toContain("f4.md")
	})
})
