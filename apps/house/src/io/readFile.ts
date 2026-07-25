import { readFile } from "node:fs/promises"
import { Data, Effect } from "effect"

export class FileReadError extends Data.TaggedError("FileReadError")<{
	readonly path: string
	readonly cause: unknown
}> {}

/** Read a UTF-8 text file. Errors as `FileReadError`. */
export const readFileText = (path: string): Effect.Effect<string, FileReadError> =>
	Effect.tryPromise({
		try: () => readFile(path, "utf8"),
		catch: (cause) => new FileReadError({ path, cause }),
	})
