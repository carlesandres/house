import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileNavigatorCore } from "../src/file-navigator/core/engine.ts"
import { scanFiles } from "../src/file-navigator/core/scanner.ts"
import {
	fuzzySearch,
	projectFiles,
	recentlyModifiedOrder,
} from "../src/file-navigator/core/strategies.ts"
import type { DiscoveryPolicy, FileRecord, ParcelEvent } from "../src/file-navigator/core/types.ts"
import {
	createParcelWatcherFromBinding,
	type InternalWatcher,
} from "../src/file-navigator/core/parcel-adapter.ts"

const withRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
	const root = await mkdtemp(join(tmpdir(), "house-file-navigator-core-"))
	try {
		return await run(root)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

const policy = (overrides: Partial<DiscoveryPolicy> = {}): DiscoveryPolicy => ({
	revision: 1,
	...overrides,
})

describe("File Navigator core scanner", () => {
	test("prunes the root, streams files before directories, and cancels", async () => {
		await withRoot(async (root) => {
			await mkdir(join(root, "dir"))
			await writeFile(join(root, "z.txt"), "z")
			await writeFile(join(root, "a.txt"), "a")
			await writeFile(join(root, "dir", "nested.txt"), "n")
			const batches: string[] = []
			await scanFiles(root, policy(), {
				batchSize: 1,
				onBatch: (files) => {
					batches.push(...files.map((file) => file.relativePath))
				},
			})
			expect(batches).toEqual(["a.txt", "z.txt", "dir/nested.txt"])
			expect((await scanFiles(root, policy({ includeDirectory: () => false }))).files).toHaveLength(
				0,
			)
			const controller = new AbortController()
			await expect(
				scanFiles(root, policy(), {
					signal: controller.signal,
					barrier: async (phase, directory) => {
						if (phase === "before-read" && directory === root) controller.abort()
					},
				}),
			).rejects.toMatchObject({ name: "AbortError" })
		})
	})

	test("normalizes identity, preserves case, and exposes frozen metadata", async () => {
		await withRoot(async (root) => {
			await writeFile(join(root, "ReadMe.MD"), "hello")
			const result = await scanFiles(join(root, "."), policy())
			const file = result.files[0]!
			expect(file).toMatchObject({
				absolutePath: join(root, "ReadMe.MD"),
				relativePath: "ReadMe.MD",
				basename: "ReadMe.MD",
				extension: ".md",
				size: 5,
			})
			expect(Object.isFrozen(file)).toBe(true)
			expect(result.root).toBe(root)
		})
	})

	test("prunes directories, limits nonrecursive scans, and snapshots policy callbacks", async () => {
		await withRoot(async (root) => {
			await mkdir(join(root, "keep"))
			await mkdir(join(root, "drop"))
			await writeFile(join(root, "root.txt"), "root")
			await writeFile(join(root, "keep", "nested.txt"), "keep")
			await writeFile(join(root, "drop", "nested.txt"), "drop")
			const seen: string[] = []
			const result = await scanFiles(
				root,
				policy({
					includeDirectory: async (path: string) => {
						seen.push(path)
						return !path.endsWith("drop")
					},
					includeFile: (path: string) => !path.endsWith("root.txt"),
				}),
			)
			expect(result.files.map((file) => file.relativePath)).toEqual(["keep/nested.txt"])
			expect(seen).not.toContain(join(root, "drop", "nested.txt"))
			const shallow = await scanFiles(root, policy({ recursive: false }))
			expect(shallow.files.map((file) => file.relativePath)).toEqual(["root.txt"])
		})
	})

	test("applies nested ignore levels, negation, and mixed-case matching", async () => {
		await withRoot(async (root) => {
			await mkdir(join(root, "Docs"))
			await writeFile(join(root, ".gitignore"), "*.TMP\n")
			await writeFile(join(root, "Docs", ".gitignore"), "!Keep.tmp\n")
			await writeFile(join(root, "Docs", "Keep.tmp"), "keep")
			await writeFile(join(root, "Docs", "Drop.tmp"), "drop")
			const result = await scanFiles(root, policy({ ignoreFiles: [".gitignore"] }))
			expect(result.files.map((file) => file.relativePath)).toEqual(["Docs/Keep.tmp"])
			const pruned = await scanFiles(
				root,
				policy({
					ignoreFiles: [".gitignore"],
					includeDirectory: (path: string) => !path.endsWith("Docs"),
				}),
			)
			expect(pruned.files).toHaveLength(0)
		})
	})

	test("notifies extra watch roots before scanning followed symlink targets", async () => {
		await withRoot(async (container) => {
			const physical = join(container, "physical")
			const external = join(container, "external")
			const lexical = join(container, "chosen")
			await mkdir(physical)
			await mkdir(external)
			await writeFile(join(physical, "root.txt"), "root")
			await writeFile(join(external, "outside.txt"), "outside")
			await symlink(physical, lexical, "dir")
			await symlink(external, join(physical, "link"), "dir")
			const roots: string[] = []
			const batches: string[] = []
			const result = await scanFiles(lexical, policy({ followSymlinks: true }), {
				batchSize: 1,
				onWatchRoot: (path) => {
					roots.push(path)
				},
				onBatch: (files) => {
					batches.push(...files.map((file) => file.relativePath))
				},
			})
			expect(roots).toEqual([await realpath(external)])
			expect(batches.indexOf("root.txt")).toBeGreaterThanOrEqual(0)
			expect(batches.indexOf("link/outside.txt")).toBeGreaterThan(batches.indexOf("root.txt"))
			expect(result.watchRoots).toEqual([await realpath(lexical), await realpath(external)])
		})
	})

	test("follows nested external symlinks without replacing lexical identity or looping", async () => {
		await withRoot(async (container) => {
			const physical = join(container, "physical")
			const external = join(container, "external")
			const lexical = join(container, "chosen")
			await mkdir(physical)
			await mkdir(external)
			await writeFile(join(physical, "root.txt"), "root")
			await writeFile(join(external, "outside.txt"), "outside")
			await symlink(physical, lexical, "dir")
			await symlink(external, join(physical, "link"), "dir")
			await symlink(physical, join(external, "cycle"), "dir")
			const disabled = await scanFiles(lexical, policy({ followSymlinks: false }))
			expect(disabled.files[0]?.absolutePath).toBe(join(lexical, "root.txt"))
			const followed = await scanFiles(lexical, policy({ followSymlinks: true }))
			expect(followed.files.map((file) => file.relativePath)).toContain("link/outside.txt")
			expect(followed.files.some((file) => file.relativePath.includes("cycle/"))).toBe(false)
		})
	})

	test("withdraws streamed batches when a policy callback throws", async () => {
		await withRoot(async (root) => {
			await writeFile(join(root, "a.txt"), "a")
			await writeFile(join(root, "b.txt"), "b")
			const batches: FileRecord[][] = []
			await expect(
				scanFiles(
					root,
					policy({
						includeFile: (path: string) => {
							if (path.endsWith("b.txt")) throw new Error("policy failed")
							return true
						},
					}),
					{
						batchSize: 1,
						onBatch: (files) => {
							batches.push(files as FileRecord[])
						},
					},
				),
			).rejects.toThrow("policy failed")
			expect(batches.length).toBeGreaterThan(0)
		})
	})
})

const record = (relativePath: string, mtimeMs: number): FileRecord =>
	Object.freeze({
		absolutePath: `/root/${relativePath}`,
		relativePath,
		basename: relativePath.split("/").at(-1)!,
		extension: ".md",
		size: 1,
		mtimeMs,
	})

describe("File Navigator projections", () => {
	test("orders structurally and recently modified with deterministic ties", () => {
		const files = [record("z/deep.md", 2), record("root.md", 2), record("a.md", 3)]
		expect(projectFiles(files, "")).toEqual([files[2]!, files[1]!, files[0]!])
		expect(projectFiles(files, "", recentlyModifiedOrder)).toEqual([
			files[2]!,
			files[1]!,
			files[0]!,
		])
	})

	test("searches relative paths, copies input, and preserves atomic projection on failure", () => {
		const files = [record("docs/readme.md", 1), record("README.md", 1)]
		const original = [...files]
		expect(projectFiles(files, "read", "tree", fuzzySearch)[0]?.relativePath).toBe("README.md")
		expect(files).toEqual(original)
		expect(() => projectFiles(files, "x", "tree", { id: "bad", score: () => Number.NaN })).toThrow()
	})
})

class FakeWatcher implements InternalWatcher {
	readonly callbacks: Array<(error: Error | null, events: readonly ParcelEvent[]) => void> = []
	readonly directories: string[] = []
	activeSubscriptions = 0
	subscribe(
		directory: string,
		callback: (error: Error | null, events: readonly ParcelEvent[]) => void,
	) {
		this.directories.push(directory)
		this.callbacks.push(callback)
		this.activeSubscriptions++
		let unsubscribed = false
		return Promise.resolve({
			unsubscribe: async () => {
				if (unsubscribed) return
				unsubscribed = true
				this.activeSubscriptions--
			},
		})
	}
	emit(events: readonly ParcelEvent[]): void {
		for (const callback of this.callbacks) callback(null, events)
	}
}

describe("File Navigator synchronization", () => {
	test("requires an injected watcher before starting watch mode", async () => {
		await withRoot(async (root) => {
			const core = new FileNavigatorCore({ root, policy: policy() })
			await expect(core.start()).rejects.toThrow(
				"FileNavigatorCore requires an InternalWatcher when watch is enabled",
			)
			await core.close()
		})
	})

	test("publishes authoritative mutations, shares refresh, and ignores late generations", async () => {
		await withRoot(async (root) => {
			const selectedInvalidations: string[] = []
			const publications: unknown[] = []
			const watcher = new FakeWatcher()
			await writeFile(join(root, "selected.md"), "same")
			const core = new FileNavigatorCore(
				{
					root,
					policy: policy(),
					consistencyIntervalMs: null,
					metadata: async () => ({ size: 4, mtimeMs: 1 }),
					onPublication: (value) => publications.push(value),
					onSelectedInvalidation: (file) => selectedInvalidations.push(file.relativePath),
				},
				watcher,
			)
			await core.start()
			expect(core.watching).toBe(true)
			const path = join(root, "selected.md")
			watcher.emit([{ type: "update", path }])
			await core.refresh()
			expect(selectedInvalidations).toEqual(["selected.md"])
			await writeFile(join(root, "new.md"), "new")
			const first = core.refresh()
			const second = core.refresh()
			expect(first).toBe(second)
			await first
			expect(core.files.map((file) => file.relativePath)).toContain("new.md")
			expect(publications.length).toBeGreaterThan(0)
			await core.setWatch(false)
			expect(core.watching).toBe(false)
			await core.close()
		})
	})

	test("retains a valid collection on refresh failure and diagnoses in order", async () => {
		await withRoot(async (root) => {
			await writeFile(join(root, "valid.md"), "valid")
			const diagnostics: number[] = []
			const core = new FileNavigatorCore({
				root,
				policy: policy(),
				watch: false,
				onDiagnostic: (entry) => diagnostics.push(entry.sequence),
			})
			await core.start()
			await rm(root, { recursive: true, force: true })
			await expect(core.refresh()).rejects.toThrow()
			expect(core.files.map((file) => file.relativePath)).toEqual(["valid.md"])
			expect(diagnostics).toEqual([1])
			await core.close()
		})
	})

	test("snapshots policy by revision and withdraws failed initial batches", async () => {
		await withRoot(async (root) => {
			await writeFile(join(root, "a.md"), "a")
			let currentPolicy: DiscoveryPolicy = policy({ includeFile: () => true })
			const core = new FileNavigatorCore({ root, policy: currentPolicy, watch: false })
			await core.start()
			await core.updatePolicy(policy({ includeFile: () => false }))
			await core.refresh()
			expect(core.files).toHaveLength(1)
			currentPolicy = policy({ revision: 2, includeFile: () => false })
			await core.updatePolicy(currentPolicy)
			expect(core.files).toHaveLength(0)
			await core.close()

			const withdrawn: boolean[] = []
			const failed = new FileNavigatorCore({
				root,
				watch: false,
				policy: policy({
					includeFile: (path) => {
						if (path.endsWith("a.md")) throw new Error("failed")
						return true
					},
				}),
				onBatch: (_files, _complete, wasWithdrawn) => {
					if (wasWithdrawn) withdrawn.push(true)
				},
			})
			await expect(failed.start()).rejects.toThrow("failed")
			expect(withdrawn).toEqual([true])
			await failed.close()
		})
	})

	test("maps external target events to lexical selected identity", async () => {
		await withRoot(async (container) => {
			const physical = join(container, "physical")
			const external = join(container, "external")
			const lexical = join(container, "root")
			await mkdir(physical)
			await mkdir(external)
			await writeFile(join(external, "outside.md"), "outside")
			await symlink(physical, lexical, "dir")
			await symlink(external, join(physical, "link"), "dir")
			const watcher = new FakeWatcher()
			const invalidations: [string, string | undefined][] = []
			const core = new FileNavigatorCore(
				{
					root: lexical,
					policy: policy({ followSymlinks: true }),
					consistencyIntervalMs: null,
					onSelectedInvalidation: (file, event) =>
						invalidations.push([file.relativePath, event?.path]),
				},
				watcher,
			)
			await core.start()
			core.setQuery("outside")
			expect(core.selected?.relativePath).toBe("link/outside.md")
			const physicalExternal = await realpath(external)
			watcher.emit([{ type: "update", path: join(physicalExternal, "outside.md") }])
			await core.refresh()
			expect(invalidations[0]).toEqual(["link/outside.md", join(physicalExternal, "outside.md")])
			await core.close()
		})
	})

	test("adds subscriptions for new directories and restarts watch transitions", async () => {
		await withRoot(async (root) => {
			const watcher = new FakeWatcher()
			const core = new FileNavigatorCore(
				{ root, policy: policy(), consistencyIntervalMs: null },
				watcher,
			)
			await core.start()
			await mkdir(join(root, "new"))
			await writeFile(join(root, "new", "file.md"), "file")
			watcher.emit([{ type: "create", path: join(root, "new") }])
			await core.refresh()
			expect(core.files.map((file) => file.relativePath)).toContain("new/file.md")
			expect(watcher.directories).toEqual([await realpath(root), await realpath(root)])
			const subscribed = watcher.directories.length
			await core.setWatch(true, 123)
			expect(watcher.directories.length).toBeGreaterThan(subscribed)
			await core.setWatch(false)
			expect(core.watching).toBe(false)
			await core.close()
		})
	})

	test("subscribes to one physical root and one external target root", async () => {
		await withRoot(async (root) => {
			const nested = join(root, "one", "two", "three")
			const external = await mkdtemp(join(tmpdir(), "house-file-navigator-external-"))
			try {
				await mkdir(nested, { recursive: true })
				await writeFile(join(nested, "nested.md"), "nested")
				await writeFile(join(external, "outside.md"), "outside")
				await symlink(external, join(root, "outside"), "dir")
				const watcher = new FakeWatcher()
				const core = new FileNavigatorCore(
					{
						root,
						policy: policy({ followSymlinks: true }),
						consistencyIntervalMs: null,
					},
					watcher,
				)
				await core.start()
				expect(watcher.directories).toEqual([await realpath(root), await realpath(external)])
				const nextExternal = await mkdtemp(join(tmpdir(), "house-file-navigator-external-next-"))
				try {
					await writeFile(join(nextExternal, "next.md"), "next")
					await symlink(nextExternal, join(root, "next-outside"), "dir")
					watcher.emit([{ type: "create", path: join(root, "next-outside") }])
					await core.refresh()
					expect(core.files.map((file) => file.relativePath)).toContain("next-outside/next.md")
					expect(watcher.activeSubscriptions).toBe(3)
				} finally {
					await rm(nextExternal, { recursive: true, force: true })
				}
				await core.close()
			} finally {
				await rm(external, { recursive: true, force: true })
			}
		})
	})

	test("buffers an event delivered during the initial authoritative scan", async () => {
		await withRoot(async (root) => {
			const watcher = new FakeWatcher()
			let emitted = false
			const core = new FileNavigatorCore(
				{
					root,
					policy: policy(),
					consistencyIntervalMs: null,
					barrier: async (phase, directory) => {
						if (!emitted && phase === "after-read" && directory === root) {
							emitted = true
							await writeFile(join(root, "during-scan.md"), "during")
							watcher.emit([{ type: "create", path: join(root, "during-scan.md") }])
						}
					},
				},
				watcher,
			)
			await core.start()
			expect(core.files.map((file) => file.relativePath)).toContain("during-scan.md")
			expect(new Set(core.files.map((file) => file.relativePath)).size).toBe(core.files.length)
			expect(core.watching).toBe(true)
			await core.close()
		})
	})

	test("drops overlapping root and policy candidates before any stale publication", async () => {
		await withRoot(async (root) => {
			const nextRoot = await mkdtemp(join(tmpdir(), "house-file-navigator-next-"))
			await writeFile(join(root, "old.md"), "old")
			await writeFile(join(nextRoot, "stale.md"), "stale")
			const watcher = new FakeWatcher()
			const gates: Array<{ release: () => void }> = []
			let started = false
			const snapshots: string[][] = []
			const publications: unknown[] = []
			const core = new FileNavigatorCore(
				{
					root,
					policy: policy(),
					consistencyIntervalMs: null,
					barrier: async (phase, directory) => {
						if (!started || phase !== "after-read" || directory !== nextRoot) return
						await new Promise<void>((resolve) => gates.push({ release: resolve }))
					},
					onSnapshot: (files) => snapshots.push(files.map((file) => file.relativePath)),
					onPublication: (value) => publications.push(value),
				},
				watcher,
			)
			await core.start()
			snapshots.length = 0
			publications.length = 0
			started = true
			const rootChange = core.updateRoot(nextRoot)
			while (gates.length < 1) await Bun.sleep(0)
			const policyChange = core.updatePolicy(policy({ revision: 2, includeFile: () => false }))
			while (gates.length < 2) await Bun.sleep(0)
			gates[0]!.release()
			await expect(rootChange).rejects.toThrow("stale generation")
			gates[1]!.release()
			await policyChange
			expect(core.files).toHaveLength(0)
			expect(snapshots).not.toContainEqual(["stale.md"])
			expect(publications.every((value: any) => !value.added.includes("stale.md"))).toBe(true)
			await core.close()
			await rm(nextRoot, { recursive: true, force: true })
		})
	})

	test("does not deliver batches from a superseded candidate", async () => {
		await withRoot(async (root) => {
			const nested = join(root, "nested")
			await mkdir(nested)
			await writeFile(join(root, "stale.md"), "stale")
			const watcher = new FakeWatcher()
			const gates: Array<{ release: () => void }> = []
			let blocked = false
			const batches: string[][] = []
			const withdrawals: boolean[] = []
			const core = new FileNavigatorCore(
				{
					root,
					policy: policy(),
					batchSize: 1,
					consistencyIntervalMs: null,
					barrier: async (phase, directory) => {
						if (phase !== "after-read" || directory !== nested) return
						blocked = true
						await new Promise<void>((resolve) => gates.push({ release: resolve }))
					},
					onBatch: (files, _complete, withdrawn) => {
						batches.push(files.map((file) => file.relativePath))
						if (withdrawn) withdrawals.push(true)
					},
				},
				watcher,
			)
			const initial = core.start()
			while (!blocked) await Bun.sleep(0)
			const replacement = core.updatePolicy(policy({ revision: 2, includeFile: () => false }))
			while (gates.length < 2) await Bun.sleep(0)
			gates[0]!.release()
			await expect(initial).rejects.toThrow("stale generation")
			gates[1]!.release()
			await replacement
			expect(batches).toContainEqual(["stale.md"])
			expect(withdrawals).toEqual([true])
			await core.close()
		})
	})

	test("subscribes before the first authoritative scan without a topology-only warmup", async () => {
		await withRoot(async (root) => {
			await mkdir(join(root, "nested"))
			await writeFile(join(root, "nested", "file.md"), "file")
			const watcher = new FakeWatcher()
			const reads: string[] = []
			const core = new FileNavigatorCore(
				{
					root,
					policy: policy(),
					consistencyIntervalMs: null,
					barrier: (phase, directory) => {
						if (phase === "before-read") reads.push(directory)
					},
				},
				watcher,
			)
			await core.start()
			expect(watcher.directories).toEqual([await realpath(root)])
			expect(reads).toEqual([root, join(root, "nested")])
			expect(core.files.map((file) => file.relativePath)).toEqual(["nested/file.md"])
			await core.close()
		})
	})

	test("streams the initial watch batch before readiness", async () => {
		await withRoot(async (root) => {
			await writeFile(join(root, "initial.md"), "initial")
			const watcher = new FakeWatcher()
			const observed: string[][] = []
			let ready = false
			const core = new FileNavigatorCore(
				{
					root,
					policy: policy(),
					batchSize: 1,
					consistencyIntervalMs: null,
					onBatch: (files) => {
						observed.push(files.map((file) => file.relativePath))
					},
					onSnapshot: (files) => {
						if (files.length) expect(ready).toBe(false)
					},
				},
				watcher,
			)
			const started = core.start()
			await started
			ready = true
			expect(observed[0]).toEqual(["initial.md"])
			expect(observed.at(-1)).toEqual([])
			expect(core.watching).toBe(true)
			await core.close()
		})
	})

	test("disabling watch during a blocked candidate prevents activation and closes subscriptions", async () => {
		await withRoot(async (root) => {
			const nextRoot = join(root, "candidate")
			await mkdir(nextRoot)
			await writeFile(join(root, "old.md"), "old")
			const watcher = new FakeWatcher()
			let release!: () => void
			let started = false
			let blocked = false
			const core = new FileNavigatorCore(
				{
					root,
					policy: policy(),
					consistencyIntervalMs: null,
					barrier: async (phase, directory) => {
						if (started && !blocked && phase === "after-read" && directory === nextRoot) {
							blocked = true
							await new Promise<void>((resolve) => (release = resolve))
						}
					},
				},
				watcher,
			)
			await core.start()
			started = true
			const replacement = core.updateRoot(nextRoot)
			while (!blocked) await Bun.sleep(0)
			await core.setWatch(false)
			release()
			await expect(replacement).rejects.toThrow("stale generation")
			expect(core.watching).toBe(false)
			expect(core.files.map((file) => file.relativePath)).toEqual(["old.md"])
			expect(watcher.activeSubscriptions).toBe(0)
			await core.close()
		})
	})
})

describe("Parcel binding adapter", () => {
	test("constructs a watcher through the static binding source factory", async () => {
		const binding = {} as Parameters<typeof createParcelWatcherFromBinding>[0]
		let received: unknown
		const watcher = createParcelWatcherFromBinding(binding, (value) => {
			received = value
			return {
				subscribe: async () => ({ unsubscribe: async () => {} }),
			}
		})
		await watcher.subscribe("relative", () => {})
		expect(received).toBe(binding)
	})
})
