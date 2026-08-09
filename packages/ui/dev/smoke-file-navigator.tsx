import { mkdir, mkdtemp, rename, rm, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { testRender } from "@opentui/react/test-utils"
import { act, createRef } from "react"
import { FileNavigator } from "@house/ui/file-navigator"
import type {
	Diagnostic,
	FileNavigatorHandle,
	FileNavigatorSnapshot,
} from "@house/ui/file-navigator"

const timeoutMs = 10_000

const names = (snapshot: FileNavigatorSnapshot): readonly string[] =>
	snapshot.files.map((file) => file.relativePath)

const waitFor = async (
	setup: Awaited<ReturnType<typeof testRender>>,
	handle: FileNavigatorHandle,
	predicate: (snapshot: FileNavigatorSnapshot) => boolean,
	description: string,
): Promise<FileNavigatorSnapshot> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await act(async () => {
			await setup.renderer.idle()
			await new Promise<void>((resolve) => setImmediate(resolve))
		})
		const snapshot = handle.getSnapshot()
		if (predicate(snapshot)) return snapshot
	}
	throw new Error(
		`timed out waiting for ${description}; files=${JSON.stringify(names(handle.getSnapshot()))}`,
	)
}

const expectFiles = (snapshot: FileNavigatorSnapshot, expected: readonly string[]): void => {
	if (JSON.stringify(names(snapshot)) !== JSON.stringify(expected)) {
		throw new Error(`unexpected files: ${JSON.stringify(names(snapshot))}`)
	}
}

export const runFileNavigatorSmoke = async (): Promise<void> => {
	;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
	const root = await mkdtemp(join(tmpdir(), "house-file-navigator-smoke-"))
	let setup: Awaited<ReturnType<typeof testRender>> | null = null
	const handle = createRef<FileNavigatorHandle>()
	const diagnostics: Diagnostic[] = []
	let snapshotCount = 0
	try {
		await mkdir(join(root, "nested"))
		await writeFile(join(root, "initial.md"), "initial")
		await writeFile(join(root, "nested", "deep.md"), "deep")
		await writeFile(join(root, ".gitignore"), "ignored.md\n")

		await act(async () => {
			setup = await testRender(
				<FileNavigator
					ref={handle}
					root={root}
					query=""
					watch
					policy={{ revision: 1, ignoreFiles: [".gitignore"] }}
					consistencyIntervalMs={25}
					width={40}
					height={10}
					active
					visible
					onSnapshot={() => snapshotCount++}
					onDiagnostic={(diagnostic) => diagnostics.push(diagnostic)}
				/>,
				{ width: 40, height: 10 },
			)
		})
		const navigator = handle.current
		if (!navigator || !setup) throw new Error("FileNavigator did not expose its public handle")
		await waitFor(
			setup,
			navigator,
			(snapshot) => !snapshot.scanning && names(snapshot).join("|") === "initial.md|nested/deep.md",
			"initial scan",
		)

		await writeFile(join(root, "created.md"), "created")
		await waitFor(
			setup,
			navigator,
			(snapshot) => names(snapshot).includes("created.md"),
			"created file",
		)

		await writeFile(join(root, "created.md"), "changed content")
		const changed = await waitFor(
			setup,
			navigator,
			(snapshot) => snapshot.files.find((file) => file.relativePath === "created.md")?.size === 15,
			"changed file",
		)
		if (changed.files.find((file) => file.relativePath === "created.md")?.size !== 15)
			throw new Error("changed file metadata was not published")

		await writeFile(join(root, "equal.md"), "123456")
		await waitFor(
			setup,
			navigator,
			(snapshot) => names(snapshot).includes("equal.md"),
			"equal-size file",
		)
		const equalBefore = navigator
			.getSnapshot()
			.files.find((file) => file.relativePath === "equal.md")
		await writeFile(join(root, "equal.md"), "abcdef")
		await utimes(join(root, "equal.md"), new Date(Date.now() + 2_000), new Date(Date.now() + 2_000))
		const equalAfter = await waitFor(
			setup,
			navigator,
			(snapshot) =>
				snapshot.files.find((file) => file.relativePath === "equal.md")?.mtimeMs !==
				equalBefore?.mtimeMs,
			"equal-size rewrite",
		)
		if (equalAfter.files.find((file) => file.relativePath === "equal.md")?.size !== 6)
			throw new Error("equal-size rewrite was not published")

		await writeFile(join(root, "atomic.md"), "old atomic")
		await waitFor(
			setup,
			navigator,
			(snapshot) => names(snapshot).includes("atomic.md"),
			"atomic file",
		)
		const atomicBefore = navigator
			.getSnapshot()
			.files.find((file) => file.relativePath === "atomic.md")
		await writeFile(join(root, "atomic.tmp"), "new atomic")
		await utimes(
			join(root, "atomic.tmp"),
			new Date(Date.now() + 4_000),
			new Date(Date.now() + 4_000),
		)
		await rename(join(root, "atomic.tmp"), join(root, "atomic.md"))
		await waitFor(
			setup,
			navigator,
			(snapshot) =>
				snapshot.files.find((file) => file.relativePath === "atomic.md")?.mtimeMs !==
				atomicBefore?.mtimeMs,
			"atomic replacement",
		)

		await mkdir(join(root, "new-directory"))
		await writeFile(join(root, "new-directory", "child.md"), "child")
		await waitFor(
			setup,
			navigator,
			(snapshot) => names(snapshot).includes("new-directory/child.md"),
			"immediate child",
		)
		const snapshotsBeforeIgnore = snapshotCount
		await writeFile(join(root, "ignored.md"), "ignored")
		await waitFor(
			setup,
			navigator,
			(snapshot) =>
				snapshotCount > snapshotsBeforeIgnore &&
				!names(snapshot).includes("ignored.md") &&
				!snapshot.scanning,
			"ignored file",
		)
		await writeFile(join(root, ".gitignore"), "")
		await waitFor(
			setup,
			navigator,
			(snapshot) => names(snapshot).includes("ignored.md"),
			"ignore removal",
		)
		await writeFile(join(root, ".gitignore"), "ignored.md\n")
		await waitFor(
			setup,
			navigator,
			(snapshot) => !names(snapshot).includes("ignored.md"),
			"ignore restoration",
		)

		await rm(join(root, "created.md"))
		const removed = await waitFor(
			setup,
			navigator,
			(snapshot) => !names(snapshot).includes("created.md"),
			"removed file",
		)
		expectFiles(removed, [
			"atomic.md",
			"equal.md",
			"initial.md",
			"nested/deep.md",
			"new-directory/child.md",
		])
		if (diagnostics.length > 0)
			throw new Error(
				`unexpected diagnostics: ${diagnostics.map((item) => item.error.message).join(", ")}`,
			)
		console.log("file-navigator smoke: mutation coverage passed")
	} finally {
		if (setup) await act(async () => setup!.renderer.destroy())
		await rm(root, { recursive: true, force: true })
	}
}
