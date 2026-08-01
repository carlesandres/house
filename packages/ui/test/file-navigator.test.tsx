import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { testRender } from "@opentui/react/test-utils"
import { act, createRef, useState } from "react"
import { FileNavigator } from "../src/file-navigator/index.ts"
import type { FileNavigatorHandle } from "../src/file-navigator/index.ts"

beforeAll(() => {
	// @ts-expect-error React's act environment flag is intentionally global.
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let setup: Awaited<ReturnType<typeof testRender>> | null = null
let root: string | null = null

afterEach(async () => {
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
		const selected = handle.current!.selectLast()
		expect(selected.selectedFile?.relativePath).toBe("docs/guide.md")
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
		await act(async () => setQuery!("README"))
		const flushed = handle.current!.flushQuery("README")
		expect(flushed.appliedQuery).toBe("README")
		expect(flushed.filteredFiles.map((file) => file.relativePath)).toEqual(["README.md"])
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
		const refresh = handle.current!.refresh()
		expect(handle.current!.getSnapshot().scanning).toBe(true)
		await act(async () => refresh)
		expect(handle.current!.getSnapshot().files.map((file) => file.relativePath)).toContain("new.md")
		expect(handle.current!.selectPath(join(directory, "new.md")).selectedFile?.absolutePath).toBe(
			join(directory, "new.md"),
		)
	})
})
