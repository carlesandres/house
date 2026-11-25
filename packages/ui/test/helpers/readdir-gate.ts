/**
 * Preloaded by `bunfig.toml` so it runs before any test imports the scanner. It wraps `readdir`
 * from `node:fs/promises` so a test can hold a scan open for as long as it needs.
 *
 * With no gate installed, `readdir` behaves exactly as usual.
 */
import { mock } from "bun:test"
import * as actual from "node:fs/promises"

const GATE_KEY = "__house_ui_test_readdir_gate__"

type Gate = (path: string) => Promise<void> | undefined

const realReaddir = actual.readdir as (...args: unknown[]) => Promise<unknown>

const readdir = async (...args: unknown[]): Promise<unknown> => {
	const gate = (globalThis as Record<string, unknown>)[GATE_KEY] as Gate | undefined
	await gate?.(String(args[0]))
	return realReaddir(...args)
}

const patched = { ...actual, readdir }
void mock.module("node:fs/promises", () => ({ ...patched, default: patched }))

/**
 * Holds every `readdir` under `directory` until `release` is called. `entered` resolves once the
 * first such call is waiting, which proves the scan has started and has not finished.
 */
export const holdReaddir = (directory: string): { entered: Promise<void>; release: () => void } => {
	let markEntered!: () => void
	let open!: () => void
	const entered = new Promise<void>((resolve) => (markEntered = resolve))
	const opened = new Promise<void>((resolve) => (open = resolve))
	;(globalThis as Record<string, unknown>)[GATE_KEY] = ((path) => {
		if (!path.startsWith(directory)) return undefined
		markEntered()
		return opened
	}) satisfies Gate
	return {
		entered,
		release: () => {
			delete (globalThis as Record<string, unknown>)[GATE_KEY]
			open()
		},
	}
}
