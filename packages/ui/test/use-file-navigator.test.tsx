import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { act, Suspense, useLayoutEffect, useState } from "react"
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

	test("keeps the debounce deadline while committed callbacks and files change", async () => {
		type Invocation =
			| {
					readonly sequence: number
					readonly kind: "filter"
					readonly revision: number
					readonly query: string
					readonly fileKeys: readonly string[]
			  }
			| {
					readonly sequence: number
					readonly kind: "getId" | "getPath"
					readonly revision: number
					readonly fileKey: string
			  }
		interface ChurnState {
			readonly files: readonly FileItem[]
			readonly query: string
			readonly revision: number
		}

		const initialFiles = [file("old-a.md"), file("old-b.md")]
		const latestFiles = [file("latest-a.md"), file("latest-b.md")]
		const invocations: Invocation[] = []
		let sequence = 0
		let latest: FileNavigatorController<FileItem, string> | null = null
		let setHarnessState: ((update: (current: ChurnState) => ChurnState) => void) | null = null

		const ChurnHarness = () => {
			const [state, setState] = useState<ChurnState>({
				files: initialFiles,
				query: "",
				revision: 0,
			})
			setHarnessState = setState
			const revision = state.revision
			const controller = useFileNavigator({
				files: state.files,
				query: state.query,
				debounceMs: 200,
				getId: (item): string => {
					invocations.push({
						sequence: sequence++,
						kind: "getId",
						revision,
						fileKey: item.id,
					})
					return `r${revision}:${item.id}`
				},
				getPath: (item) => {
					invocations.push({
						sequence: sequence++,
						kind: "getPath",
						revision,
						fileKey: item.id,
					})
					return item.path
				},
				filter: (items, nextQuery) => {
					invocations.push({
						sequence: sequence++,
						kind: "filter",
						revision,
						query: nextQuery,
						fileKeys: items.map((item) => item.id),
					})
					return items.filter((item) => item.path.includes(nextQuery))
				},
			})
			useLayoutEffect(() => {
				latest = controller
			}, [controller])
			return <box />
		}

		await act(async () => {
			setup = await testRender(<ChurnHarness />, VIEWPORT)
		})
		const commitAfter = async (
			delayMs: number,
			update: (current: ChurnState) => ChurnState,
		): Promise<void> => {
			await act(async () => {
				await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
				setHarnessState!(update)
				await setup!.renderOnce()
			})
		}

		await commitAfter(0, (current) => ({ ...current, query: "b" }))
		for (let revision = 1; revision <= 5; revision++) {
			await commitAfter(30, (current) => ({
				...current,
				files: revision === 2 ? latestFiles : current.files,
				revision,
			}))
		}
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 75))
		})
		await commitAfter(20, (current) => ({ ...current, revision: 6 }))
		await commitAfter(20, (current) => ({ ...current, revision: 7 }))

		expect(latest!.appliedQuery).toBe("b")
		expect(latest!.filteredFiles).toEqual([latestFiles[1]!])
		expect(latest!.filteredFiles[0]).toBe(latestFiles[1]!)
		expect(latest!.selectedFile).toBe(latestFiles[1]!)
		expect(latest!.selectedIndex).toBe(0)

		const timerFilterIndex = invocations.findIndex(
			(event) => event.kind === "filter" && event.query === "b",
		)
		const timerFilter = invocations[timerFilterIndex]
		expect(timerFilter).toMatchObject({
			kind: "filter",
			revision: 5,
			fileKeys: ["latest-a.md", "latest-b.md"],
		})
		const reconciliationIds = invocations
			.slice(timerFilterIndex + 1)
			.filter((event) => event.kind === "getId")
			.slice(0, 2)
		expect(reconciliationIds).toHaveLength(2)
		expect(reconciliationIds.every((event) => event.revision === 5)).toBe(true)
		expect(
			reconciliationIds.every((event) => event.kind === "getId" && event.fileKey === "latest-b.md"),
		).toBe(true)

		await act(async () => {
			latest!.selectId("r7:latest-b.md")
		})
		expect(latest!.selectedFile).toBe(latestFiles[1]!)
	})

	test("does not expose an abandoned suspended render through the committed controller", async () => {
		const committedFiles = [
			{ id: "a.md", path: "old-needle-a.md" },
			{ id: "b.md", path: "old-needle-b.md" },
		]
		const candidateFiles = [
			{ id: "x.md", path: "candidate-x.md" },
			{ id: "y.md", path: "candidate-y.md" },
		]
		const committedGetId = (item: FileItem): string => `old:${item.id}`
		const candidateGetId = (item: FileItem): string => `new:${item.id}`
		const committedFilter = (items: readonly FileItem[]): readonly FileItem[] => items
		const candidateFilter = (items: readonly FileItem[], query: string): readonly FileItem[] =>
			query.length === 0 ? items : items.slice(0, 1)
		let resolveCandidate!: () => void
		const candidateThenable = new Promise<void>((resolve) => {
			resolveCandidate = resolve
		})
		let attempted = false
		let committedController: FileNavigatorController<FileItem, string> | null = null
		const committedModes: string[] = []
		let setMode: ((mode: "committed" | "candidate" | "restored") => void) | null = null

		const SuspendedHarness = () => {
			const [mode, setCurrentMode] = useState<"committed" | "candidate" | "restored">("committed")
			setMode = setCurrentMode
			const isCandidate = mode === "candidate"
			const controller = useFileNavigator({
				files: isCandidate ? candidateFiles : committedFiles,
				query: "",
				getId: isCandidate ? candidateGetId : committedGetId,
				getPath,
				filter: isCandidate ? candidateFilter : committedFilter,
			})
			useLayoutEffect(() => {
				committedController = controller
				committedModes.push(mode)
			}, [controller, mode])
			if (isCandidate) {
				attempted = true
				throw candidateThenable
			}
			return <box />
		}

		await act(async () => {
			setup = await testRender(
				<Suspense fallback={<box />}>
					<SuspendedHarness />
				</Suspense>,
				VIEWPORT,
			)
		})
		const oldController = committedController!
		await act(async () => {
			setMode!("candidate")
			await setup!.renderOnce()
		})

		const before = oldController.getSnapshot()
		let flushed = oldController.getSnapshot()
		let selected = oldController.getSnapshot()
		await act(async () => {
			flushed = oldController.flushSearch("needle")
			selected = oldController.selectLast()
			await Promise.resolve()
		})

		await act(async () => {
			setMode!("restored")
			await setup!.renderOnce()
			resolveCandidate()
			await Promise.resolve()
		})

		expect({
			attempted,
			committedModes,
			beforeFiles: before.filteredFiles.map((item) => item.id),
			beforeSelected: before.selectedFile?.id,
			flushedFiles: flushed.filteredFiles.map((item) => item.id),
			flushedSelected: flushed.selectedFile?.id,
			selectedFile: selected.selectedFile?.id,
		}).toEqual({
			attempted: true,
			committedModes: ["committed", "restored"],
			beforeFiles: ["a.md", "b.md"],
			beforeSelected: "a.md",
			flushedFiles: ["a.md", "b.md"],
			flushedSelected: "a.md",
			selectedFile: "b.md",
		})
	})

	test("does not let commit publication roll back a descendant layout action", async () => {
		type InterleavingEvent =
			| { readonly kind: "action"; readonly generation: number; readonly selectedId: string }
			| { readonly kind: "publication"; readonly generation: number; readonly selectedId: string }
		interface InterleavingState {
			readonly files: readonly FileItem[]
			readonly generation: number
		}

		const events: InterleavingEvent[] = []
		const actedGenerations = new Set<number>()
		let committedController: FileNavigatorController<FileItem, string> | null = null
		let setHarnessState: ((state: InterleavingState) => void) | null = null

		const LayoutAction = ({
			controller,
			generation,
		}: {
			readonly controller: FileNavigatorController<FileItem, string>
			readonly generation: number
		}) => {
			useLayoutEffect(() => {
				if (actedGenerations.has(generation)) return
				actedGenerations.add(generation)
				const result = controller.selectLast()
				events.push({
					kind: "action",
					generation,
					selectedId: result.selectedFile!.id,
				})
			}, [controller, generation])
			return null
		}
		const InterleavingHarness = () => {
			const [state, setState] = useState<InterleavingState>({
				files: [file("a.md"), file("b.md")],
				generation: 0,
			})
			setHarnessState = setState
			const previousController = committedController
			const controller = useFileNavigator({
				files: state.files,
				query: "",
				getId,
				getPath,
				filter,
			})
			useLayoutEffect(() => {
				committedController = controller
				if (state.generation === 0) return
				events.push({
					kind: "publication",
					generation: state.generation,
					selectedId: controller.getSnapshot().selectedFile!.id,
				})
			}, [controller, state.generation])
			return previousController === null || state.generation === 0 ? null : (
				<LayoutAction controller={previousController} generation={state.generation} />
			)
		}

		await act(async () => {
			setup = await testRender(<InterleavingHarness />, VIEWPORT)
		})
		await act(async () => {
			setHarnessState!({
				files: [file("a.md"), file("b.md"), file("c.md")],
				generation: 1,
			})
			await setup!.renderOnce()
		})

		expect(events[0]).toMatchObject({ kind: "action", generation: 1 })
		expect(events[1]).toEqual({
			kind: "publication",
			generation: 1,
			selectedId: events[0]!.selectedId,
		})
		expect(committedController!.getSnapshot().selectedFile!.id).toBe(events[0]!.selectedId)
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
