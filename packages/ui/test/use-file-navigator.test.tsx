import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { act, useState } from "react"
import { testRender } from "@opentui/react/test-utils"
import { useFileNavigator } from "../src/index.ts"
import type { FileNavigatorController, UseFileNavigatorOptions } from "../src/index.ts"

interface FileItem {
	readonly id: string
	readonly path: string
}

const file = (id: string): FileItem => ({ id, path: id })
const filter = (files: readonly FileItem[], query: string): readonly FileItem[] =>
	files.filter((item) => item.path.includes(query))
const getId = (item: FileItem): string => item.id
const getPath = (item: FileItem): string => item.path
const VIEWPORT = { width: 40, height: 10 }

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

interface Harness {
	readonly controller: () => FileNavigatorController<FileItem, string>
	readonly update: (patch: Partial<UseFileNavigatorOptions<FileItem, string>>) => Promise<void>
}

const renderNavigator = async (
	overrides: Partial<UseFileNavigatorOptions<FileItem, string>> = {},
): Promise<Harness> => {
	const initial: UseFileNavigatorOptions<FileItem, string> = {
		files: [file("a.md"), file("b.md"), file("c.md")],
		query: "",
		getId,
		getPath,
		filter,
		debounceMs: 20,
		...overrides,
	}
	let latest: FileNavigatorController<FileItem, string> | null = null
	let setOptions: ((patch: Partial<UseFileNavigatorOptions<FileItem, string>>) => void) | null =
		null

	const HookHarness = () => {
		const [options, setCurrent] = useState(initial)
		setOptions = (patch) => setCurrent((current) => ({ ...current, ...patch }))
		latest = useFileNavigator(options)
		return <box />
	}

	await act(async () => {
		setup = await testRender(<HookHarness />, VIEWPORT)
	})
	return {
		controller: () => latest!,
		update: async (patch) => {
			await act(async () => {
				setOptions!(patch)
				await setup!.renderOnce()
			})
		},
	}
}

describe("useFileNavigator", () => {
	test("applies the initial query synchronously and gives it selection precedence", async () => {
		const harness = await renderNavigator({
			query: "b",
			initialSelectedId: "c.md",
		})
		expect(harness.controller().appliedQuery).toBe("b")
		expect(harness.controller().filteredFiles.map(getId)).toEqual(["b.md"])
		expect(harness.controller().selectedFile?.id).toBe("b.md")
		expect(harness.controller().selectedIndex).toBe(0)
	})

	test("honors a present initial ID for an empty query and otherwise selects first", async () => {
		let harness = await renderNavigator({ initialSelectedId: "c.md" })
		expect(harness.controller().selectedFile?.id).toBe("c.md")
		await act(async () => setup!.renderer.destroy())
		setup = null

		harness = await renderNavigator({ initialSelectedId: "missing.md" })
		expect(harness.controller().selectedFile?.id).toBe("a.md")
	})

	test("debounces ordinary controlled query changes", async () => {
		const harness = await renderNavigator({ debounceMs: 30 })
		await harness.update({ query: "b" })
		expect(harness.controller().appliedQuery).toBe("")
		expect(harness.controller().filteredFiles).toHaveLength(3)

		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 40))
		})
		expect(harness.controller().appliedQuery).toBe("b")
		expect(harness.controller().selectedFile?.id).toBe("b.md")
	})

	test("flushes synchronously, returns the new snapshot, and cancels the timer", async () => {
		const harness = await renderNavigator({ debounceMs: 30 })
		await harness.update({ query: "b" })
		let flushed = harness.controller().getSnapshot()
		await act(async () => {
			flushed = harness.controller().flushSearch("c")
		})
		expect(flushed.appliedQuery).toBe("c")
		expect(flushed.filteredFiles.map(getId)).toEqual(["c.md"])
		expect(flushed.selectedFile?.id).toBe("c.md")

		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 40))
		})
		expect(harness.controller().appliedQuery).toBe("c")
	})

	test("selects the first result once for a newly applied query", async () => {
		const harness = await renderNavigator()
		await act(async () => {
			harness.controller().selectLast()
			harness.controller().flushSearch(".md")
		})
		expect(harness.controller().selectedFile?.id).toBe("a.md")

		await harness.update({ files: [file("0.md"), file("a.md"), file("b.md"), file("c.md")] })
		expect(harness.controller().selectedFile?.id).toBe("a.md")
		expect(harness.controller().selectedIndex).toBe(1)
	})

	test("preserves selected ID when a higher-ranked streamed result is inserted", async () => {
		const harness = await renderNavigator({ files: [file("docs/readme.md")] })
		expect(harness.controller().selectedFile?.id).toBe("docs/readme.md")

		await harness.update({ files: [file("readme.md"), file("docs/readme.md")] })
		expect(harness.controller().selectedFile?.id).toBe("docs/readme.md")
		expect(harness.controller().selectedIndex).toBe(1)
	})

	test("clamps from the prior index when the selected ID disappears", async () => {
		const harness = await renderNavigator()
		await act(async () => {
			harness.controller().selectLast()
		})
		await harness.update({ files: [file("a.md"), file("b.md")] })
		expect(harness.controller().selectedFile?.id).toBe("b.md")
		expect(harness.controller().selectedIndex).toBe(1)
	})

	test("uses null selection for empty results and selects first when results return", async () => {
		const harness = await renderNavigator()
		await act(async () => {
			harness.controller().selectIndex(1)
		})
		await harness.update({ files: [] })
		expect(harness.controller().selectedFile).toBeNull()
		expect(harness.controller().selectedIndex).toBeNull()

		await harness.update({ files: [file("x.md"), file("y.md")] })
		expect(harness.controller().selectedFile?.id).toBe("x.md")
		expect(harness.controller().selectedIndex).toBe(0)
	})

	test("moves synchronously, clamps, selects endpoints, and ignores absent IDs", async () => {
		const harness = await renderNavigator()
		await act(async () => {
			harness.controller().moveBy(1)
			harness.controller().moveBy(1)
			harness.controller().moveBy(1)
		})
		expect(harness.controller().selectedFile?.id).toBe("c.md")

		await act(async () => {
			harness.controller().selectFirst()
		})
		expect(harness.controller().selectedFile?.id).toBe("a.md")
		await act(async () => {
			harness.controller().selectId("b.md")
			harness.controller().selectId("missing.md")
		})
		expect(harness.controller().selectedFile?.id).toBe("b.md")
		await act(async () => {
			harness.controller().selectLast()
		})
		expect(harness.controller().selectedFile?.id).toBe("c.md")
	})

	test("cancelAutoSelect preserves explicit selection until the query changes", async () => {
		const harness = await renderNavigator()
		await act(async () => {
			harness.controller().selectId("b.md")
			harness.controller().cancelAutoSelect()
		})
		await harness.update({ files: [file("0.md"), file("a.md"), file("b.md"), file("c.md")] })
		expect(harness.controller().selectedFile?.id).toBe("b.md")

		await harness.update({ query: ".md" })
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 30))
		})
		expect(harness.controller().selectedFile?.id).toBe("0.md")
	})

	test("throws descriptively for duplicate IDs", async () => {
		const DuplicateHarness = () => {
			useFileNavigator({
				files: [file("same.md"), { id: "same.md", path: "other.md" }],
				query: "",
				getId,
				getPath,
				filter,
			})
			return <box />
		}

		await act(async () => {
			setup = await testRender(<DuplicateHarness />, VIEWPORT)
		})
		const normalizedFrame = setup!.captureCharFrame().replace(/\s+/g, " ")
		expect(normalizedFrame).toContain('useFileNavigator: duplicate file ID "same.md"')
	})
})
