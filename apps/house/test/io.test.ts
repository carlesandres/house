import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { FileReadError, readFileText } from "../src/io/readFile.ts"

describe("readFileText", () => {
	test("reads an existing utf-8 file", async () => {
		const content = await Effect.runPromise(
			readFileText(new URL("./fixtures/sample.md", import.meta.url).pathname),
		)
		expect(content).toContain("# Sample")
		expect(content).toContain("FIXTURE_MARKER_OK")
	})

	test("fails with FileReadError for a missing file", async () => {
		const result = await Effect.runPromise(
			Effect.result(readFileText("test/fixtures/__definitely_missing__.md")),
		)
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(FileReadError)
			expect(result.failure.path).toBe("test/fixtures/__definitely_missing__.md")
		}
	})
})
