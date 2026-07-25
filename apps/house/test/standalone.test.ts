import { describe, expect, test } from "bun:test"
import pkg from "../package.json" with { type: "json" }

const runStandalone = (...args: readonly string[]) => {
	const result = Bun.spawnSync({
		cmd: ["bun", "run", "src/standalone.ts", ...args],
		cwd: new URL("..", import.meta.url).pathname,
		stderr: "pipe",
		stdout: "pipe",
	})
	const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
	return {
		exitCode: result.exitCode,
		stdout: decode(result.stdout),
		stderr: decode(result.stderr),
	}
}

describe("standalone entrypoint", () => {
	test("prints version without launching the TUI", () => {
		const result = runStandalone("--version")

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toBe(`${pkg.version}\n`)
		expect(result.stderr).toBe("")
	})

	test("prints help without launching the TUI", () => {
		const result = runStandalone("--help")

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("usage:\n  house [query] [options]")
		expect(result.stdout).toContain("-v, --version  print version and exit")
		expect(result.stderr).toBe("")
	})

	test("keeps existing fast-exit validation order", () => {
		const result = runStandalone("--version", "--wrap", "--no-wrap")

		expect(result.exitCode).toBe(2)
		expect(result.stdout).toBe("")
		expect(result.stderr).toBe("house: --wrap and --no-wrap cannot be used together\n")
	})
})
