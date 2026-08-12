import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { testRender } from "@opentui/react/test-utils"
import { act, createRef, startTransition, Suspense, useState } from "react"
import { FileNavigator } from "../src/file-navigator/index.ts"
import type {
	FileNavigatorHandle,
	FileNavigatorSnapshot,
	ParcelEvent,
} from "../src/file-navigator/index.ts"

beforeAll(() => {
	// @ts-expect-error React's act environment flag is intentionally global.
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let setup: Awaited<ReturnType<typeof testRender>> | null = null
let root: string | null = null
const WATCHER_FACTORY_KEY = "__house_file_navigator_watcher_factory__"

class FakeWatcher {
	readonly callbacks = new Set<(error: Error | null, events: readonly ParcelEvent[]) => void>()
	activeSubscriptions = 0
	unsubscribeCalls = 0

	subscribe(
		_directory: string,
		callback: (error: Error | null, events: readonly ParcelEvent[]) => void,
	) {
		this.callbacks.add(callback)
		this.activeSubscriptions++
		return Promise.resolve({
			unsubscribe: async () => {
				if (!this.callbacks.delete(callback)) return
				this.activeSubscriptions--
				this.unsubscribeCalls++
			},
		})
	}

	emit(events: readonly ParcelEvent[]): void {
		for (const callback of this.callbacks) callback(null, events)
	}
}

const installFakeWatcher = (): FakeWatcher => {
	const watcher = new FakeWatcher()
	;(globalThis as Record<string, unknown>)[WATCHER_FACTORY_KEY] = () => watcher
	return watcher
}

afterEach(async () => {
	delete (globalThis as Record<string, unknown>)[WATCHER_FACTORY_KEY]
	if (setup) {
		await act(async () => setup!.renderer.destroy())
		setup = null
	}
	if (root) {
		await rm(root, { recursive: true, force: true })
		root = null
	}
})

const createRoot = async (): Promise<string> => {
	root = await mkdtemp(join(tmpdir(), "house-file-navigator-ui-"))
	await mkdir(join(root, "docs"))
	await writeFile(join(root, "README.md"), "readme")
	await writeFile(join(root, "docs", "guide.md"), "guide")
	return root
}

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
	for (let i = 0; i < 40; i++) {
		if (predicate()) return
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 10))
			await setup?.renderOnce()
		})
	}
	throw new Error(`timed out waiting for ${label}`)
}

describe("public FileNavigator", () => {
	test("composes static discovery into Sidebar and exposes selection actions", async () => {
		const directory = await createRoot()
		const handle = createRef<FileNavigatorHandle>()
		await act(async () => {
			setup = await testRender(
				<FileNavigator
					ref={handle}
					root={directory}
					query=""
					watch={false}
					width={32}
					height={8}
					active
					visible
				/>,
				{ width: 32, height: 8 },
			)
		})
		await act(async () => setup!.renderOnce())
		await act(async () => new Promise((resolve) => setTimeout(resolve, 25)))
		await act(async () => setup!.renderOnce())
		const snapshot = handle.current!.getSnapshot()
		expect(snapshot.files.map((file) => file.relativePath)).toEqual(["README.md", "docs/guide.md"])
		expect(snapshot.selectedFile?.relativePath).toBe("README.md")
		let selected: FileNavigatorSnapshot | null = null
		await act(async () => {
			selected = handle.current!.selectLast()
		})
		expect(selected!.selectedFile?.relativePath).toBe("docs/guide.md")
		expect(setup!.captureCharFrame()).toContain("guide.md")
	})

	test("applies initial and empty queries immediately and flushes a pending query", async () => {
		const directory = await createRoot()
		const handle = createRef<FileNavigatorHandle>()
		let setQuery: ((query: string) => void) | null = null
		const Harness = () => {
			const [query, update] = useState("guide")
			setQuery = update
			return (
				<FileNavigator
					ref={handle}
					root={directory}
					query={query}
					watch={false}
					width={32}
					height={8}
					active
					visible
				/>
			)
		}
		await act(async () => {
			setup = await testRender(<Harness />, { width: 32, height: 8 })
		})
		await act(async () => setup!.renderer.idle())
		expect(handle.current!.getSnapshot().appliedQuery).toBe("guide")
		await act(async () => setQuery!(""))
		expect(handle.current!.getSnapshot().appliedQuery).toBe("")
		await act(async () => setQuery!("guide"))
		let flushed: FileNavigatorSnapshot | null = null
		await act(async () => {
			flushed = handle.current!.flushQuery("README")
		})
		expect(flushed!.appliedQuery).toBe("README")
		expect(flushed!.filteredFiles.map((file) => file.relativePath)).toEqual(["README.md"])
		await act(async () => new Promise((resolve) => setTimeout(resolve, 75)))
		expect(handle.current!.getSnapshot().appliedQuery).toBe("README")
	})

	test("keeps debounce deadlines stable and publishes the latest committed callback", async () => {
		const directory = await createRoot()
		const handle = createRef<FileNavigatorHandle>()
		const callbackRevisions: number[] = []
		let setQuery: ((query: string) => void) | null = null
		let setRevision: ((revision: number) => void) | null = null
		const Harness = () => {
			const [query, updateQuery] = useState("")
			const [revision, updateRevision] = useState(0)
			setQuery = updateQuery
			setRevision = updateRevision
			return (
				<FileNavigator
					ref={handle}
					root={directory}
					query={query}
					watch={false}
					debounceMs={80}
					onSelectionChange={() => callbackRevisions.push(revision)}
					width={32}
					height={8}
					active
					visible
				/>
			)
		}
		await act(async () => {
			setup = await testRender(<Harness />, { width: 32, height: 8 })
		})
		await act(async () => setup!.renderer.idle())
		callbackRevisions.length = 0
		await act(async () => setQuery!("guide"))
		for (let revision = 1; revision <= 3; revision++) {
			await act(async () => {
				await new Promise<void>((resolve) => setTimeout(resolve, 20))
				setRevision!(revision)
			})
		}
		await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 30)))
		expect(handle.current!.getSnapshot().appliedQuery).toBe("guide")
		await waitFor(() => callbackRevisions.at(-1) === 3, "latest committed callback")

		await act(async () => setRevision!(4))
		await act(async () => {
			handle.current!.flushQuery("")
			handle.current!.selectFirst()
		})
		expect(callbackRevisions.at(-1)).toBe(4)
	})

	test("applies synchronous selection actions against the preceding result", async () => {
		const directory = await createRoot()
		const handle = createRef<FileNavigatorHandle>()
		await act(async () => {
			setup = await testRender(
				<FileNavigator
					ref={handle}
					root={directory}
					query=""
					watch={false}
					width={32}
					height={8}
					active
					visible
				/>,
				{ width: 32, height: 8 },
			)
		})
		await waitFor(() => handle.current!.getSnapshot().files.length === 2, "selection action files")

		let selected: FileNavigatorSnapshot[] = []
		await act(async () => {
			selected = [
				handle.current!.selectLast(),
				handle.current!.moveBy(-1),
				handle.current!.selectIndex(99),
				handle.current!.selectFirst(),
			]
		})
		expect(selected.map((snapshot) => snapshot.selectedIndex)).toEqual([1, 0, 1, 0])
	})

	test("keeps the public handle operational after a root change", async () => {
		root = await mkdtemp(join(tmpdir(), "house-file-navigator-ui-roots-"))
		const first = join(root, "first")
		const second = join(root, "second")
		await mkdir(first)
		await mkdir(second)
		await writeFile(join(first, "old.md"), "old")
		await writeFile(join(second, "a.md"), "a")
		await writeFile(join(second, "b.md"), "b")
		const handle = createRef<FileNavigatorHandle>()
		let setRoot: ((root: string) => void) | null = null
		const Harness = () => {
			const [directory, updateRoot] = useState(first)
			setRoot = updateRoot
			return (
				<FileNavigator
					ref={handle}
					root={directory}
					query=""
					watch={false}
					width={32}
					height={8}
					active
					visible
				/>
			)
		}
		await act(async () => {
			setup = await testRender(<Harness />, { width: 32, height: 8 })
		})
		await waitFor(
			() => handle.current!.getSnapshot().files.some((file) => file.relativePath === "old.md"),
			"first root files",
		)
		expect(handle.current!.getSnapshot().files.map((file) => file.relativePath)).toEqual(["old.md"])

		await act(async () => setRoot!(second))
		const pending = handle.current!.getSnapshot()
		expect(pending.root).toBe(second)
		expect(pending.files).toEqual([])
		await waitFor(() => handle.current!.getSnapshot().files.length === 2, "second root files")
		expect(handle.current!.getSnapshot().files.map((file) => file.relativePath)).toEqual([
			"a.md",
			"b.md",
		])
		let selected: FileNavigatorSnapshot | null = null
		await act(async () => {
			selected = handle.current!.selectLast()
		})
		expect(selected!.selectedFile?.relativePath).toBe("b.md")
	})

	test("keeps the committed handle isolated from an abandoned render", async () => {
		root = await mkdtemp(join(tmpdir(), "house-file-navigator-ui-suspend-"))
		const committedRoot = join(root, "committed")
		const candidateRoot = join(root, "candidate")
		await mkdir(committedRoot)
		await mkdir(candidateRoot)
		await writeFile(join(committedRoot, "a.md"), "a")
		await writeFile(join(committedRoot, "b.md"), "b")
		await writeFile(join(candidateRoot, "candidate.md"), "candidate")
		let committedHandle: FileNavigatorHandle | null = null
		let setCandidate: ((candidate: boolean) => void) | null = null
		let candidateAttempts = 0
		let release!: () => void
		const suspended = new Promise<void>((resolve) => {
			release = resolve
		})
		const BlockCandidate = ({ active }: { active: boolean }) => {
			if (active) {
				candidateAttempts++
				throw suspended
			}
			return null
		}
		const Harness = () => {
			const [candidate, updateCandidate] = useState(false)
			setCandidate = updateCandidate
			return (
				<Suspense fallback={<text content="candidate pending" />}>
					<FileNavigator
						ref={(handle) => {
							if (handle) committedHandle = handle
						}}
						root={candidate ? candidateRoot : committedRoot}
						query={candidate ? "candidate" : ""}
						watch={false}
						width={32}
						height={8}
						active
						visible
					/>
					<BlockCandidate active={candidate} />
				</Suspense>
			)
		}
		await act(async () => {
			setup = await testRender(<Harness />, { width: 32, height: 8 })
		})
		await act(async () => setup!.renderer.idle())
		expect(committedHandle!.getSnapshot().root).toBe(committedRoot)

		act(() => startTransition(() => setCandidate!(true)))
		await waitFor(() => candidateAttempts > 0, "suspended candidate render")
		let filtered: FileNavigatorSnapshot | null = null
		let selected: FileNavigatorSnapshot | null = null
		await act(async () => {
			filtered = committedHandle!.flushQuery("b")
			selected = committedHandle!.selectLast()
		})
		expect(filtered!.root).toBe(committedRoot)
		expect(filtered!.filteredFiles.map((file) => file.relativePath)).toEqual(["b.md"])
		expect(selected!.selectedFile?.relativePath).toBe("b.md")

		await act(async () => {
			startTransition(() => setCandidate!(false))
			release()
		})
		await act(async () => setup!.renderer.idle())
		expect(committedHandle!.getSnapshot().root).toBe(committedRoot)
	})

	test("closes replaced watcher generations and ignores their late callbacks", async () => {
		root = await mkdtemp(join(tmpdir(), "house-file-navigator-ui-watch-"))
		const first = join(root, "first")
		const second = join(root, "second")
		await mkdir(first)
		await mkdir(second)
		await writeFile(join(first, "a.md"), "a")
		await writeFile(join(second, "b.md"), "b")
		const watcher = installFakeWatcher()
		const invalidations: string[] = []
		let setRoot: ((root: string) => void) | null = null
		let setWatch: ((watch: boolean) => void) | null = null
		const Harness = () => {
			const [directory, updateRoot] = useState(first)
			const [watch, updateWatch] = useState(true)
			setRoot = updateRoot
			setWatch = updateWatch
			return (
				<FileNavigator
					root={directory}
					query=""
					watch={watch}
					onSelectedFileInvalidated={(file) => invalidations.push(file.relativePath)}
					width={32}
					height={8}
					active
					visible
				/>
			)
		}
		await act(async () => {
			setup = await testRender(<Harness />, { width: 32, height: 8 })
		})
		await waitFor(() => watcher.activeSubscriptions === 1, "initial watcher subscription")
		const staleCallback = [...watcher.callbacks][0]!

		await act(async () => setWatch!(false))
		await waitFor(() => watcher.activeSubscriptions === 0, "watcher unsubscribe")
		expect(watcher.unsubscribeCalls).toBe(1)
		staleCallback(null, [{ type: "update", path: join(first, "a.md") }])
		await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 30)))
		expect(invalidations).toEqual([])

		await act(async () => {
			setRoot!(second)
			setWatch!(true)
		})
		await waitFor(() => watcher.activeSubscriptions === 1, "replacement watcher subscription")
		expect(watcher.unsubscribeCalls).toBe(1)

		await act(async () => setup!.renderer.destroy())
		setup = null
		expect(watcher.activeSubscriptions).toBe(0)
		expect(watcher.unsubscribeCalls).toBe(2)
	})

	test("reports selected invalidation without reporting a selection change", async () => {
		const directory = await createRoot()
		const watcher = installFakeWatcher()
		const selections: Array<string | null> = []
		const invalidations: string[] = []
		await act(async () => {
			setup = await testRender(
				<FileNavigator
					root={directory}
					query=""
					watch
					onSelectionChange={(file) => selections.push(file?.relativePath ?? null)}
					onSelectedFileInvalidated={(file) => invalidations.push(file.relativePath)}
					width={32}
					height={8}
					active
					visible
				/>,
				{ width: 32, height: 8 },
			)
		})
		await waitFor(
			() => watcher.activeSubscriptions === 1 && selections.length > 0,
			"initial selection",
		)
		selections.length = 0
		const selectedPath = join(directory, "README.md")
		await writeFile(selectedPath, "updated")
		watcher.emit([{ type: "update", path: selectedPath }])
		await waitFor(() => invalidations.length === 1, "selected invalidation")
		expect(invalidations).toEqual(["README.md"])
		expect(selections).toEqual([])
	})

	test("forwards header, appearance, and custom row context", async () => {
		const directory = await createRoot()
		const rows: Array<{ path: string; selected: boolean; width: number }> = []
		await act(async () => {
			setup = await testRender(
				<FileNavigator
					root={directory}
					query=""
					watch={false}
					header={<text content="CUSTOM HEADER" />}
					appearance={{ selectedColor: "#123456", selectedTextColor: "#ffffff" }}
					renderFile={({ file, selected, width, appearance }) => {
						rows.push({ path: file.relativePath, selected, width })
						return (
							<text
								content={`custom:${file.relativePath}:${selected ? "selected" : "idle"}:${appearance.selectedColor}`}
							/>
						)
					}}
					width={40}
					height={8}
					active
					visible
				/>,
				{ width: 40, height: 8 },
			)
		})
		await waitFor(() => rows.some((row) => row.path === "README.md"), "custom file rows")
		await act(async () => setup!.renderOnce())
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("CUSTOM HEADER")
		expect(frame).toContain("custom:README.md:selected:#123456")
		expect(rows.some((row) => row.path === "README.md" && row.selected && row.width > 0)).toBe(true)
	})

	test("keeps the basename visible when the default row truncates parent context", async () => {
		root = await mkdtemp(join(tmpdir(), "house-file-navigator-ui-row-"))
		const parent = join(root, "very-long-parent-directory")
		await mkdir(parent)
		await writeFile(join(parent, "readme.md"), "readme")
		await act(async () => {
			setup = await testRender(
				<FileNavigator root={root!} query="" watch={false} width={18} height={6} active visible />,
				{ width: 18, height: 6 },
			)
		})
		await waitFor(() => setup!.captureCharFrame().includes("readme.md"), "default file row")
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("readme.md")
		expect(frame).not.toContain("very-long-parent-directory")
	})

	test("reports scanning and no-files empty reasons", async () => {
		root = await mkdtemp(join(tmpdir(), "house-file-navigator-ui-empty-"))
		const reasons: string[] = []
		await act(async () => {
			setup = await testRender(
				<FileNavigator
					root={root!}
					query=""
					watch={false}
					renderEmpty={({ reason }) => {
						reasons.push(reason)
						return <text content={`empty:${reason}`} />
					}}
					width={32}
					height={8}
					active
					visible
				/>,
				{ width: 32, height: 8 },
			)
		})
		await act(async () => setup!.renderer.idle())
		expect(reasons).toContain("scanning")
		expect(reasons.at(-1)).toBe("no-files")
		expect(setup!.captureCharFrame()).toContain("empty:no-files")
	})

	test("reports no-results empty context with the applied query", async () => {
		const directory = await createRoot()
		const contexts: Array<{ reason: string; query: string }> = []
		await act(async () => {
			setup = await testRender(
				<FileNavigator
					root={directory}
					query="missing"
					watch={false}
					renderEmpty={({ reason, query }) => {
						contexts.push({ reason, query })
						return <text content={`empty:${reason}:${query}`} />
					}}
					width={32}
					height={8}
					active
					visible
				/>,
				{ width: 32, height: 8 },
			)
		})
		await act(async () => setup!.renderer.idle())
		expect(contexts.at(-1)).toEqual({ reason: "no-results", query: "missing" })
		expect(setup!.captureCharFrame()).toContain("empty:no-results:missing")
	})

	test("reports an error empty context for a missing root", async () => {
		root = await mkdtemp(join(tmpdir(), "house-file-navigator-ui-error-"))
		const missing = join(root, "missing")
		const contexts: Array<{ reason: string; error: Error | null }> = []
		await act(async () => {
			setup = await testRender(
				<FileNavigator
					root={missing}
					query=""
					watch={false}
					renderEmpty={({ reason, error }) => {
						contexts.push({ reason, error })
						return <text content={`empty:${reason}`} />
					}}
					width={32}
					height={8}
					active
					visible
				/>,
				{ width: 32, height: 8 },
			)
		})
		await waitFor(() => contexts.at(-1)?.reason === "error", "error empty state")
		await act(async () => setup!.renderOnce())
		expect(contexts.at(-1)?.error).toBeInstanceOf(Error)
		expect(setup!.captureCharFrame()).toContain("empty:error")
	})

	test("restores absolute selection before notifying and redraws after refresh", async () => {
		const directory = await createRoot()
		const selected: Array<string | null> = []
		const handle = createRef<FileNavigatorHandle>()
		await act(async () => {
			setup = await testRender(
				<FileNavigator
					ref={handle}
					root={directory}
					query=""
					watch={false}
					initialSelectedPath={join(directory, "docs", "guide.md")}
					onSelectionChange={(file) => selected.push(file?.absolutePath ?? null)}
					width={32}
					height={8}
					active
					visible
				/>,
				{ width: 32, height: 8 },
			)
		})
		await act(async () => setup!.renderer.idle())
		expect(selected).toEqual([join(directory, "docs", "guide.md")])
		expect(handle.current!.getSnapshot().selectedFile?.absolutePath).toBe(
			join(directory, "docs", "guide.md"),
		)

		await writeFile(join(directory, "new.md"), "new")
		await act(async () => {
			const refresh = handle.current!.refresh()
			expect(handle.current!.getSnapshot().scanning).toBe(true)
			await refresh
		})
		expect(handle.current!.getSnapshot().files.map((file) => file.relativePath)).toContain("new.md")
		let selectedNew: FileNavigatorSnapshot | null = null
		await act(async () => {
			selectedNew = handle.current!.selectPath(join(directory, "new.md"))
		})
		expect(selectedNew!.selectedFile?.absolutePath).toBe(join(directory, "new.md"))
	})
})
