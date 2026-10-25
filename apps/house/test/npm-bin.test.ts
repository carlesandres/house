import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import pkg from "../package.json" with { type: "json" }
import {
	binaryPackageNameFor,
	hasAccessibleCwd,
	resolveBinaryPath,
	shouldCaptureOutput,
} from "../src/cli/npm-bin.js"

const node = Bun.which("node")

describe("npm bin shim", () => {
	test("published manifest pins platform packages to the main package version", async () => {
		const { createPublicPackageManifest } = await import("../dev/public-package-manifest.ts")
		const publicPkg = createPublicPackageManifest(pkg)
		const platformVersions = Object.entries(publicPkg.optionalDependencies ?? {})
			.filter(([name]) => name.startsWith(`${pkg.name}-`))
			.map(([, version]) => version)

		expect(platformVersions).not.toHaveLength(0)
		expect(platformVersions.every((version) => version === pkg.version)).toBe(true)
	})

	test("maps supported platforms to package names", () => {
		expect(binaryPackageNameFor("darwin", "arm64")).toBe("@carlesandres/house-darwin-arm64")
		expect(binaryPackageNameFor("darwin", "x64")).toBe("@carlesandres/house-darwin-x64")
		expect(binaryPackageNameFor("linux", "arm64", "glibc")).toBe("@carlesandres/house-linux-arm64")
		expect(binaryPackageNameFor("linux", "x64", "glibc")).toBe("@carlesandres/house-linux-x64")
	})

	test("rejects unsupported targets", () => {
		expect(binaryPackageNameFor("linux", "x64", "musl")).toBeUndefined()
		expect(binaryPackageNameFor("win32", "x64")).toBeUndefined()
	})

	test("resolves the binary entry point from a package name", () => {
		expect(resolveBinaryPath("@carlesandres/house-darwin-x64", (path: string) => path)).toBe(
			"@carlesandres/house-darwin-x64/bin/house",
		)
	})

	test("captures fast-exit output so command substitution sees it", () => {
		expect(shouldCaptureOutput(["--version"])).toBe(true)
		expect(shouldCaptureOutput(["--help"])).toBe(true)
		expect(shouldCaptureOutput(["README.md"])).toBe(false)
	})

	test("detects a working directory that can no longer be resolved", () => {
		expect(hasAccessibleCwd(() => "/tmp")).toBe(true)
		expect(
			hasAccessibleCwd(() => {
				throw Object.assign(new Error("uv_cwd"), { code: "ENOENT" })
			}),
		).toBe(false)
	})

	test.skipIf(node === null)("explains a deleted working directory instead of launching", async () => {
		const { code, stdout, stderr } = await runShimInDeletedCwd("--config-path")
		expect(code).toBe(1)
		expect(stdout).toBe("")
		expect(stderr).toContain(
			"house: the current directory no longer exists or is not accessible; cd to another directory and retry",
		)
	})

	test.skipIf(node === null)("answers --version from a deleted working directory", async () => {
		const { code, stdout } = await runShimInDeletedCwd("--version")
		expect(code).toBe(0)
		expect(stdout.trim()).toBe(pkg.version)
	})
})

const runShimInDeletedCwd = async (...args: string[]) => {
	const dir = await mkdtemp(join(tmpdir(), "house-gone-"))
	const shim = fileURLToPath(new URL("../src/cli/npm-bin.js", import.meta.url))
	try {
		const child = Bun.spawn(
			["sh", "-c", 'dir="$1"; shift; cd "$dir" && rmdir "$dir" && exec "$@"', "sh", dir, node!, shim, ...args],
			{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		)
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		])
		return { code, stdout, stderr }
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}
