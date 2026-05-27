import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Fiber, Result, Stream } from "effect"
import { DiscoveryError, walk, walkToArray } from "../src/discovery/walk.ts"

type FixtureSpec = Record<string, string>

const buildFixture = async (spec: FixtureSpec): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "house-discovery-"))
	for (const [relPath, content] of Object.entries(spec)) {
		const abs = join(root, relPath)
		await mkdir(dirname(abs), { recursive: true })
		await writeFile(abs, content, "utf8")
	}
	return root
}

let toCleanup: string[] = []
const fixture = async (spec: FixtureSpec) => {
	const dir = await buildFixture(spec)
	toCleanup.push(dir)
	return dir
}
afterEach(async () => {
	await Promise.all(toCleanup.map((d) => rm(d, { recursive: true, force: true })))
	toCleanup = []
})

const names = (entries: readonly { relativePath: string }[]): string[] =>
	entries.map((e) => e.relativePath)

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

describe("walk — extensions", () => {
	test("includes .md, .markdown, .mdx", async () => {
		const root = await fixture({
			"a.md": "x",
			"b.markdown": "x",
			"c.mdx": "x",
			"d.txt": "x",
			"e.MD": "x", // case-insensitive extension match
		})
		const result = await run(walkToArray(root))
		expect(names(result).sort()).toEqual(["a.md", "b.markdown", "c.mdx", "e.MD"])
	})

	test("excludes non-markdown files", async () => {
		const root = await fixture({ "README.md": "x", "code.ts": "x", "image.png": "x" })
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["README.md"])
	})

	test("mdx: false excludes .mdx but keeps .md and .markdown", async () => {
		const root = await fixture({
			"a.md": "x",
			"b.markdown": "x",
			"c.mdx": "x",
		})
		const result = await run(walkToArray(root, { mdx: false }))
		expect(names(result).sort()).toEqual(["a.md", "b.markdown"])
	})
})

describe("walk — hard-skip directories", () => {
	test("skips node_modules even if it contains markdown", async () => {
		const root = await fixture({
			"top.md": "x",
			"node_modules/pkg/README.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["top.md"])
	})

	test("skips .git", async () => {
		const root = await fixture({
			"top.md": "x",
			".git/HEAD.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["top.md"])
	})

	test("skips .venv", async () => {
		const root = await fixture({
			"top.md": "x",
			".venv/lib/notes.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["top.md"])
	})

	test("hard-skips apply even with show=[hidden,gitignored]", async () => {
		const root = await fixture({
			"top.md": "x",
			"node_modules/x.md": "x",
			".git/y.md": "x",
		})
		const result = await run(walkToArray(root, { show: ["hidden", "gitignored"] }))
		expect(names(result)).toEqual(["top.md"])
	})
})

describe("walk — hidden files", () => {
	test("skips hidden files by default", async () => {
		const root = await fixture({ "visible.md": "x", ".hidden.md": "x" })
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["visible.md"])
	})

	test("skips hidden directories by default", async () => {
		const root = await fixture({ "visible.md": "x", ".secret/inside.md": "x" })
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["visible.md"])
	})

	test("includes hidden files with show=[hidden]", async () => {
		const root = await fixture({ "visible.md": "x", ".hidden.md": "x" })
		const result = await run(walkToArray(root, { show: ["hidden"] }))
		expect(names(result).sort()).toEqual([".hidden.md", "visible.md"])
	})

	test("reveals contents of hidden directories with show=[hidden]", async () => {
		const root = await fixture({ "visible.md": "x", ".secret/inside.md": "x" })
		const result = await run(walkToArray(root, { show: ["hidden"] }))
		expect(names(result).sort()).toEqual([".secret/inside.md", "visible.md"])
	})

	test("show=[hidden] alone does NOT bypass .gitignore", async () => {
		// Independence of the two axes — pre-#145 `all` collapsed both; the
		// split keeps gitignore filtering active when only hidden is on.
		const root = await fixture({
			".gitignore": "ignored.md\n",
			".hidden.md": "x",
			"ignored.md": "x",
			"visible.md": "x",
		})
		const result = await run(walkToArray(root, { show: ["hidden"] }))
		expect(names(result).sort()).toEqual([".hidden.md", "visible.md"])
	})
})

describe("walk — gitignore", () => {
	test("honors root .gitignore", async () => {
		const root = await fixture({
			".gitignore": "ignored.md\n",
			"visible.md": "x",
			"ignored.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["visible.md"])
	})

	test("honors nested .gitignore (scoped to subdirectory)", async () => {
		const root = await fixture({
			"top.md": "x",
			"sub/.gitignore": "secret.md\n",
			"sub/public.md": "x",
			"sub/secret.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result).sort()).toEqual(["sub/public.md", "top.md"])
	})

	test("nested .gitignore does not affect siblings", async () => {
		const root = await fixture({
			"sub/.gitignore": "secret.md\n",
			"sub/secret.md": "x",
			"other/secret.md": "x", // siblings unaffected
		})
		const result = await run(walkToArray(root))
		expect(names(result).sort()).toEqual(["other/secret.md"])
	})

	test("show=[gitignored] ignores .gitignore rules", async () => {
		const root = await fixture({
			".gitignore": "ignored.md\n",
			"visible.md": "x",
			"ignored.md": "x",
		})
		const result = await run(walkToArray(root, { show: ["gitignored"] }))
		expect(names(result).sort()).toEqual(["ignored.md", "visible.md"])
	})

	test("show=[gitignored] alone does NOT reveal hidden files", async () => {
		const root = await fixture({
			".gitignore": "ignored.md\n",
			".hidden.md": "x",
			"ignored.md": "x",
			"visible.md": "x",
		})
		const result = await run(walkToArray(root, { show: ["gitignored"] }))
		expect(names(result).sort()).toEqual(["ignored.md", "visible.md"])
	})

	test("gitignore can ignore an entire directory", async () => {
		const root = await fixture({
			".gitignore": "build/\n",
			"src/main.md": "x",
			"build/dist.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result).sort()).toEqual(["src/main.md"])
	})

	test("honors negation patterns (!keep.md)", async () => {
		const root = await fixture({
			".gitignore": "*.md\n!keep.md\n",
			"ignored.md": "x",
			"keep.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["keep.md"])
	})

	test("honors glob patterns", async () => {
		const root = await fixture({
			".gitignore": "*.tmp.md\n",
			"real.md": "x",
			"scratch.tmp.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["real.md"])
	})

	// Currently diverges from `git`: walk evaluates each level's ignore
	// independently and short-circuits on the first match, so a child
	// !keep.md cannot un-ignore a file matched by a parent's *.md. Tracked
	// separately; un-skip when the precedence is fixed.
	test.todo("child .gitignore can re-include a file ignored by a parent .gitignore", async () => {
		const root = await fixture({
			".gitignore": "*.md\n",
			"top.md": "x",
			"sub/.gitignore": "!keep.md\n",
			"sub/keep.md": "x",
			"sub/drop.md": "x",
		})
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["sub/keep.md"])
	})
})

describe("walk — symlinks", () => {
	test("does not follow symlinked directories", async () => {
		const root = await fixture({
			"top.md": "x",
			"real/inside.md": "x",
		})
		await symlink(join(root, "real"), join(root, "linked"))
		toCleanup.push(join(root, "linked")) // best-effort cleanup
		const result = await run(walkToArray(root))
		// "real" is walked normally; "linked" is a symlink and is skipped.
		expect(names(result).sort()).toEqual(["real/inside.md", "top.md"])
	})

	test("does not follow symlinked files", async () => {
		const root = await fixture({ "real.md": "x" })
		await symlink(join(root, "real.md"), join(root, "linked.md"))
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["real.md"])
	})

	test("broken symlinks are skipped without erroring", async () => {
		const root = await fixture({ "top.md": "x" })
		await symlink(join(root, "does-not-exist.md"), join(root, "broken.md"))
		const result = await run(walkToArray(root))
		expect(names(result)).toEqual(["top.md"])
	})
})

describe("walk — sort order", () => {
	test("directories before files, alphabetical within each group (default)", async () => {
		const root = await fixture({
			"zeta.md": "x",
			"alpha.md": "x",
			"docs/api.md": "x",
			"adocs/intro.md": "x", // dir starting with 'a' but lexicographically before 'docs'
		})
		const result = await run(walkToArray(root))
		// adocs/intro.md comes before docs/api.md because adocs sorts first;
		// then alpha.md, zeta.md — files after dirs at each level.
		expect(names(result)).toEqual(["adocs/intro.md", "docs/api.md", "alpha.md", "zeta.md"])
	})

	test("files before directories with sort: 'files-first'", async () => {
		const root = await fixture({
			"zeta.md": "x",
			"alpha.md": "x",
			"docs/api.md": "x",
			"adocs/intro.md": "x",
		})
		const result = await run(walkToArray(root, { sort: "files-first" }))
		// Top-level files first (alphabetical), then nested dir contents.
		expect(names(result)).toEqual(["alpha.md", "zeta.md", "adocs/intro.md", "docs/api.md"])
	})
})

describe("walk — errors", () => {
	test("skips unreadable subdirectories instead of aborting the whole walk", async () => {
		const root = await fixture({
			"readable.md": "x",
			"locked/secret.md": "x",
			"nested/visible.md": "x",
		})
		const locked = join(root, "locked")
		await chmod(locked, 0o000)
		try {
			const result = await run(walkToArray(root))
			expect(names(result).sort()).toEqual(["nested/visible.md", "readable.md"])
		} finally {
			await chmod(locked, 0o755)
		}
	})

	test("returns DiscoveryError when root does not exist", async () => {
		const result = await run(Effect.result(walkToArray("/no/such/path/__missing__")))
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(DiscoveryError)
		}
	})

	test("returns DiscoveryError when root is a file, not a directory", async () => {
		const root = await fixture({ "file.md": "x" })
		const result = await run(Effect.result(walkToArray(join(root, "file.md"))))
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(DiscoveryError)
		}
	})
})

describe("walk — empty", () => {
	test("returns empty array for empty directory", async () => {
		const root = await fixture({})
		const result = await run(walkToArray(root))
		expect(result).toEqual([])
	})
})

describe("walk — streaming", () => {
	test("emits entries incrementally", async () => {
		const root = await fixture({
			"a.md": "x",
			"b.md": "x",
			"c.md": "x",
		})
		const seen: string[] = []
		await run(
			walk(root).pipe(Stream.runForEach((entry) => Effect.sync(() => seen.push(entry.name)))),
		)
		expect(seen.sort()).toEqual(["a.md", "b.md", "c.md"])
	})

	test("take(1) stops after the first entry without consuming the rest", async () => {
		// Spread files across many subdirs so consuming "the rest" requires
		// new readdir calls — that's what the abort path actually short-
		// circuits. A flat dir would be served by a single readdir.
		const spec: Record<string, string> = {}
		for (let i = 0; i < 50; i++) spec[`sub${i}/file.md`] = "x"
		const root = await fixture(spec)
		const first = await run(
			walk(root).pipe(
				Stream.take(1),
				Stream.runCollect,
				Effect.map((c) => Array.from(c)),
			),
		)
		expect(first).toHaveLength(1)
	})

	test("downstream teardown stops the walk early", async () => {
		// 50 subdirs ⇒ ≥50 readdir calls if the walk runs to completion.
		// Take only the first 5 entries; the generator's return() must fire,
		// trip the AbortController, and prevent the rest from streaming.
		const spec: Record<string, string> = {}
		for (let i = 0; i < 50; i++) spec[`sub${String(i).padStart(2, "0")}/file.md`] = "x"
		const root = await fixture(spec)

		const seen: string[] = []
		await run(
			walk(root).pipe(
				Stream.take(5),
				Stream.runForEach((e) => Effect.sync(() => seen.push(e.name))),
			),
		)
		// Sanity: we got the cap, not the full set.
		expect(seen).toHaveLength(5)
	})

	test("fiber interrupt aborts an in-flight walk before completion", async () => {
		// Many subdirs so the walk has work pending after the first few
		// entries. We interrupt as soon as 5 entries land, then assert
		// the fiber stopped well short of completion.
		const total = 500
		const spec: Record<string, string> = {}
		for (let i = 0; i < total; i++) spec[`sub${i}/file.md`] = "x"
		const root = await fixture(spec)

		const seen: string[] = []
		let resolveBarrier: (() => void) | null = null
		const barrier = new Promise<void>((r) => {
			resolveBarrier = r
		})
		const fiber = Effect.runFork(
			walk(root).pipe(
				Stream.runForEach((e) =>
					Effect.sync(() => {
						seen.push(e.name)
						if (seen.length === 5 && resolveBarrier) resolveBarrier()
					}),
				),
			),
		)
		await barrier
		await Effect.runPromise(Fiber.interrupt(fiber))

		expect(seen.length).toBeGreaterThanOrEqual(5)
		expect(seen.length).toBeLessThan(total)
	})
})
