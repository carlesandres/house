#!/usr/bin/env bun
/** Lightweight CLI entry point for fast exits and compiled binary builds. */

import { parseAndHandleFastExit } from "./cli/fast-exit.ts"

const argv = Bun.argv.slice(2)

parseAndHandleFastExit(argv)

const { main } = await import("./index.tsx")
await main(argv)
