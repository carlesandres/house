import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { testRender } from "@opentui/react/test-utils"
import { act, useState } from "react"
import { Sidebar } from "../src/sidebar/index.ts"
import type { SidebarAppearance } from "../src/sidebar/index.ts"

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

const appearance: SidebarAppearance = {
	border: ["top", "right", "bottom", "left"],
	borderColor: "#123456",
	backgroundColor: "#234567",
	panelColor: "#345678",
	selectedColor: "#456789",
	inactiveOpacity: 0.5,
	horizontalPadding: 1,
}

describe("Sidebar", () => {
	test("renders generic items and follows the selected identity", async () => {
		let select: ((id: string) => void) | null = null
		const Harness = () => {
			const [selectedId, setSelectedId] = useState<string | null>("a")
			select = setSelectedId
			return (
				<Sidebar
					items={[
						{ id: "a", label: "Alpha" },
						{ id: "b", label: "Beta" },
						{ id: "c", label: "Gamma" },
					]}
					selectedId={selectedId}
					getId={(item) => item.id}
					width={24}
					height={5}
					active
					visible
					renderItem={({ item, index, selected, width }) => (
						<text content={`${index}:${item.label}:${selected}:${width}`} />
					)}
				/>
			)
		}
		await act(async () => {
			setup = await testRender(<Harness />, { width: 24, height: 5 })
		})
		expect(setup!.captureCharFrame()).toContain("0:Alpha:true")
		await act(async () => {
			select!("c")
		})
		await act(async () => setup!.renderOnce())
		expect(setup!.captureCharFrame()).toContain("2:Gamma:true")
	})

	test("renders header, custom empty content, and the default fallback", async () => {
		const render = async (emptyState?: React.ReactNode) => {
			await act(async () => {
				setup = await testRender(
					<Sidebar
						items={[]}
						selectedId={null}
						getId={(item: string) => item}
						renderItem={() => <text content="unused" />}
						width={24}
						height={6}
						active
						visible
						header={<text content="HEADER" />}
						{...(emptyState === undefined ? {} : { emptyState })}
					/>,
					{ width: 24, height: 6 },
				)
			})
		}
		await render()
		expect(setup!.captureCharFrame()).toContain("No results found.")
		await act(async () => {
			setup!.renderer.destroy()
			setup = null
		})
		await render(<text content="CUSTOM EMPTY" />)
		expect(setup!.captureCharFrame()).toContain("CUSTOM EMPTY")
	})

	test("supports configured appearance and hidden reveal", async () => {
		const Harness = ({ visible }: { readonly visible: boolean }) => (
			<Sidebar
				items={["one"]}
				selectedId="one"
				getId={(item) => item}
				renderItem={({ item }) => <text content={item} />}
				width={20}
				height={4}
				active={false}
				visible={visible}
				appearance={appearance}
			/>
		)
		await act(async () => {
			setup = await testRender(<Harness visible />, { width: 20, height: 4 })
		})
		const frame = setup!.captureCharFrame()
		expect(frame).toContain("one")
		expect(frame).toContain("┌")
		expect(
			setup!.captureSpans().lines.some((line) => line.spans.some((span) => span.bg !== null)),
		).toBe(true)
	})
})

describe("sidebar isolation", () => {
	test("imports in a fresh process without filesystem edges", async () => {
		const child = Bun.spawn(["bun", "-e", 'import "@house/ui/sidebar"; console.log("success")'], {
			cwd: resolve(import.meta.dir, ".."),
			stdout: "pipe",
			stderr: "pipe",
		})
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		])
		expect(code).toBe(0)
		expect(stdout.trim()).toBe("success")
		expect(stderr).not.toMatch(/node:fs|node:fs\/promises|parcel|watcher|file-navigator/i)
	})

	test("builds a clean Sidebar-only module graph", async () => {
		const root = await mkdtemp(join(tmpdir(), "house-ui-sidebar-test-"))
		try {
			const entry = join(root, "entry.ts")
			await writeFile(
				entry,
				`import { Sidebar } from ${JSON.stringify(resolve(import.meta.dir, "../src/sidebar/index.ts"))}; console.log(Sidebar.name)`,
			)
			const result = await Bun.build({
				entrypoints: [entry],
				outdir: join(root, "out"),
				metafile: true,
			})
			expect(result.success).toBe(true)
			const graph = JSON.stringify(result.metafile?.inputs ?? {})
			expect(graph).not.toMatch(/node:fs|node:fs\/promises|parcel|watcher|file-navigator/i)
			await readFile(entry)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
