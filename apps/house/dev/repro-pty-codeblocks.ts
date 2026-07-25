#!/usr/bin/env bun

import { $ } from "bun"

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const args = new Map(
	Bun.argv.slice(2).map((arg) => {
		const [key, value = ""] = arg.split("=", 2)
		return [key, value] as const
	}),
)

const iterations = Number.parseInt(args.get("--iterations") ?? "30", 10)
const delay = Number.parseInt(args.get("--delay") ?? "180", 10)
const cols = Number.parseInt(args.get("--cols") ?? "180", 10)
const rows = Number.parseInt(args.get("--rows") ?? "45", 10)
const target = args.get("--target") || "."
const session = `house-pty-${process.pid}`

const capture = async (): Promise<string> =>
	await $`tmux capture-pane -p -t ${session} -S -`.quiet().text()

const waitFor = async (needle: string, timeout = 3000): Promise<string> => {
	const started = Date.now()
	let frame = ""
	while (Date.now() - started < timeout) {
		frame = await capture()
		if (frame.includes(needle)) return frame
		await sleep(50)
	}
	return frame
}

const fail = async (reason: string, frame: string): Promise<never> => {
	const path = `/tmp/${session}-failure.txt`
	await Bun.write(path, frame)
	throw new Error(`${reason}. Captured pane written to ${path}`)
}

try {
	await $`tmux new-session -d -s ${session} -c ${process.cwd()} -x ${cols} -y ${rows} bun src/index.tsx ${target}`.quiet()
	await waitFor("files")

	// Select README deterministically without depending on sidebar ordering.
	await $`tmux send-keys -t ${session} -l /readme`.quiet()
	await $`tmux send-keys -t ${session} Enter`.quiet()
	let frame = await waitFor("README.md")
	frame = await waitFor("npm install -g @carlesandres/house")
	if (!frame.includes("bun add -g @carlesandres/house")) {
		await fail("README code block was not visible after initial selection", frame)
	}

	for (let i = 0; i < iterations; i++) {
		await $`tmux send-keys -t ${session} ]`.quiet()
		await sleep(delay)
		await $`tmux send-keys -t ${session} [`.quiet()
		await sleep(delay)

		frame = await capture()
		const hasInstall = frame.includes("npm install -g @carlesandres/house")
		const hasBunAdd = frame.includes("bun add -g @carlesandres/house")
		if (!hasInstall || !hasBunAdd) {
			await fail(`README code block disappeared on iteration ${i + 1}`, frame)
		}
	}

	console.log(`PTY repro passed ${iterations} README navigation cycles`)
} finally {
	await $`tmux kill-session -t ${session}`.quiet().nothrow()
}
