#!/usr/bin/env bun
/** Lightweight CLI entry point for fast exits and compiled binary builds. */

import { parseAndHandleFastExit } from "./cli/fast-exit.ts"

const argv = Bun.argv.slice(2)

parseAndHandleFastExit(argv)

if (process.env.HOUSE_INTERNAL_FILE_NAVIGATOR_SMOKE === "1") {
	const { runFileNavigatorSmoke } = await import("./file-navigator-smoke.tsx")
	await runFileNavigatorSmoke()
	process.exit(0)
}

const { main } = await import("./index.tsx")
await main(argv)
