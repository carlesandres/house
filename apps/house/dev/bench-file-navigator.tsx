#!/usr/bin/env bun

import { mkdir, mkdtemp, readdir, rename, rm, utimes, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { act, createRef, Profiler, useEffect, useState } from "react"
import type { ProfilerOnRenderCallback } from "react"
import { testRender } from "@opentui/react/test-utils"
import { FileNavigator } from "@house/ui/file-navigator"
import type { FileNavigatorHandle } from "@house/ui/file-navigator"
import pkg from "../package.json" with { type: "json" }

const baselineCommit = "429aa7aa8b26aedb82ef5e2e1f5b8ca24919678e"
const fixtureCounts = [1_000, 5_000, 10_000] as const
const runs = 3
const mutationCount = 20
const outputPath = join(import.meta.dir, "../recordings/file-navigator-production-benchmark.json")

interface TrialMetrics {
	readonly firstVisibleBatchMs: number
	readonly completionMs: number
	readonly scanTransactions: number
	readonly reactSnapshots: number
	readonly reactCommits: number
	readonly eventBatches: number | null
	readonly readerReads: number
	readonly cpuUserMs: number
	readonly cpuSystemMs: number
	readonly peakRssDeltaBytes: number
	readonly snapshotPublications: number | null
	readonly mutationLatencyMs: readonly number[] | null
	readonly atomicSaveLatencyMs: readonly number[] | null
}

const elapsed = (started: number): number => performance.now() - started

const waitFor = async (predicate: () => boolean, description: string): Promise<void> => {
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		if (predicate()) return
		await Bun.sleep(5)
	}
	throw new Error(`timed out waiting for ${description}`)
}

const createFixture = async (count: number): Promise<{ root: string; manifestHash: string }> => {
	const root = await mkdtemp(join(tmpdir(), `house-production-bench-${count}-`))
	const directoryCount = Math.max(120, Math.floor(count / 10))
	for (let index = 0; index < directoryCount; index++) {
		await mkdir(join(root, `dir-${index.toString().padStart(4, "0")}`))
	}
	const manifest: string[] = []
	for (let index = 0; index < count; index++) {
		const directory = `dir-${(index % directoryCount).toString().padStart(4, "0")}`
		const path = `${directory}/file-${index.toString().padStart(6, "0")}.md`
		manifest.push(path)
		await writeFile(join(root, path), `fixture ${index}\n`)
	}
	return {
		root,
		manifestHash: createHash("sha256").update(manifest.join("\n")).digest("hex"),
	}
}

async function* oldWalk(directory: string, root: string): AsyncGenerator<string> {
	const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => {
		if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? 1 : -1
		return left.name.localeCompare(right.name)
	})
	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith(".md")) yield relative(root, join(directory, entry.name))
	}
	for (const entry of entries) {
		if (entry.isDirectory()) yield* oldWalk(join(directory, entry.name), root)
	}
}

const percentile = (values: readonly number[], fraction: number): number | null => {
	if (values.length === 0) return null
	const sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!
}

const summarize = (values: readonly number[]) => ({
	p50: percentile(values, 0.5),
	p95: percentile(values, 0.95),
	max: values.length === 0 ? null : Math.max(...values),
})

const runOldTrial = async (root: string): Promise<TrialMetrics> => {
	let firstVisibleBatchMs = 0
	let completionMs = 0
	let scanTransactions = 0
	let reactSnapshots = 0
	let reactCommits = 0
	let readerReads = 0
	const baselineRssBytes = process.memoryUsage.rss()
	let peakRssBytes = baselineRssBytes
	const cpu = process.cpuUsage()
	const started = performance.now()
	const onRender: ProfilerOnRenderCallback = () => reactCommits++
	const OldProduction = () => {
		const [files, setFiles] = useState<readonly string[]>([])
		const [scanning, setScanning] = useState(true)
		useEffect(() => {
			let cancelled = false
			void (async () => {
				let batch: string[] = []
				for await (const path of oldWalk(root, root)) {
					if (cancelled) return
					batch.push(path)
					if (batch.length < 64) continue
					scanTransactions++
					reactSnapshots++
					setFiles((previous) => [...previous, ...batch])
					batch = []
					await new Promise<void>((resolve) => setImmediate(resolve))
				}
				if (batch.length > 0) {
					scanTransactions++
					reactSnapshots++
					setFiles((previous) => [...previous, ...batch])
				}
				if (!cancelled) setScanning(false)
			})()
			return () => {
				cancelled = true
			}
		}, [])
		useEffect(() => {
			if (files.length > 0 && firstVisibleBatchMs === 0) {
				firstVisibleBatchMs = elapsed(started)
				readerReads++
			}
			if (!scanning) completionMs = elapsed(started)
		}, [files, scanning])
		return <text>{files.length === 0 ? "Scanning" : files.at(-1)}</text>
	}
	let setup: Awaited<ReturnType<typeof testRender>> | null = null
	try {
		await act(async () => {
			setup = await testRender(
				<Profiler id="old-production" onRender={onRender}>
					<OldProduction />
				</Profiler>,
				{ width: 80, height: 10 },
			)
		})
		await waitFor(() => completionMs > 0, "old production completion")
		peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss())
	} finally {
		if (setup) await act(async () => setup!.renderer.destroy())
	}
	const used = process.cpuUsage(cpu)
	return {
		firstVisibleBatchMs,
		completionMs,
		scanTransactions,
		reactSnapshots,
		reactCommits,
		eventBatches: null,
		readerReads,
		cpuUserMs: used.user / 1_000,
		cpuSystemMs: used.system / 1_000,
		peakRssDeltaBytes: Math.max(0, peakRssBytes - baselineRssBytes),
		snapshotPublications: null,
		mutationLatencyMs: null,
		atomicSaveLatencyMs: null,
	}
}

const runCurrentTrial = async (root: string, expectedCount: number): Promise<TrialMetrics> => {
	let firstVisibleBatchMs = 0
	let completionMs = 0
	let reactSnapshots = 0
	let reactCommits = 0
	let eventBatches = 0
	let readerReads = 0
	const baselineRssBytes = process.memoryUsage.rss()
	let peakRssBytes = baselineRssBytes
	const mutationLatencyMs: number[] = []
	const atomicSaveLatencyMs: number[] = []
	const cpu = process.cpuUsage()
	const started = performance.now()
	const handle = createRef<FileNavigatorHandle>()
	let emitEvents: ((events: readonly { type: "create" | "update" | "delete"; path: string }[]) => void) | null =
		null
	;(globalThis as Record<string, unknown>).__house_file_navigator_watcher_factory__ = () => ({
		async subscribe(_directory: string, callback: (error: Error | null, events: readonly never[]) => void) {
			emitEvents = (events) => {
				eventBatches++
				callback(null, events as readonly never[])
			}
			return { unsubscribe: async () => {} }
		},
	})
	const onRender: ProfilerOnRenderCallback = () => {
		reactCommits++
		const snapshot = handle.current?.getSnapshot()
		if (snapshot && snapshot.files.length > 0 && firstVisibleBatchMs === 0) {
			firstVisibleBatchMs = elapsed(started)
		}
	}
	let setup: Awaited<ReturnType<typeof testRender>> | null = null
	try {
		let seededMutations = 0
		for (let index = 0; index < mutationCount; index++) {
			if (index % 4 === 0) continue
			await writeFile(join(root, `mutation-${index.toString().padStart(3, "0")}.md`), "before")
			seededMutations++
		}
		await act(async () => {
			setup = await testRender(
				<Profiler id="current-production" onRender={onRender}>
					<FileNavigator
						ref={handle}
						root={root}
						query=""
						watch
						consistencyIntervalMs={null}
						width={80}
						height={10}
						active
						visible
						onSnapshot={() => {
							reactSnapshots++
						}}
						onSelectionChange={(file) => {
							if (file) void Bun.file(file.absolutePath).text().then(() => readerReads++)
						}}
					/>
				</Profiler>,
				{ width: 80, height: 10 },
			)
		})
		await waitFor(
			() => {
				const snapshot = handle.current?.getSnapshot()
				return (
					snapshot?.files.length === expectedCount + seededMutations &&
					!snapshot.scanning &&
					snapshot.watching
				)
			},
			"current production completion",
		)
		completionMs = elapsed(started)
		const startupSnapshots = reactSnapshots
		const startupCpu = process.cpuUsage(cpu)
		peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss())
		for (let index = 0; index < mutationCount; index += 4) {
			const createPath = join(root, `mutation-${index.toString().padStart(3, "0")}.md`)
			const rewritePath = join(root, `mutation-${(index + 1).toString().padStart(3, "0")}.md`)
			const atomicPath = join(root, `mutation-${(index + 2).toString().padStart(3, "0")}.md`)
			const removePath = join(root, `mutation-${(index + 3).toString().padStart(3, "0")}.md`)
			const rewriteBefore = handle.current!.getSnapshot().files.find(
				(file) => file.absolutePath === rewritePath,
			)!
			const temporary = `${atomicPath}.tmp`
			await writeFile(temporary, "after atomic")
			const mutationStarted = performance.now()
			const timestamp = new Date(Date.now() + index * 1_000 + 1_000)
			await Promise.all([
				writeFile(createPath, "created"),
				writeFile(rewritePath, "after!").then(() => utimes(rewritePath, timestamp, timestamp)),
				rename(temporary, atomicPath),
				rm(removePath),
			])
			emitEvents!([
				{ type: "create", path: createPath },
				{ type: "update", path: rewritePath },
				{ type: "update", path: atomicPath },
				{ type: "delete", path: removePath },
			])
			await handle.current!.refresh()
			try {
				await waitFor(() => {
					const files = handle.current!.getSnapshot().files
					return (
						files.some((file) => file.absolutePath === createPath) &&
						files.find((file) => file.absolutePath === rewritePath)?.mtimeMs !==
							rewriteBefore.mtimeMs &&
						files.find((file) => file.absolutePath === atomicPath)?.size === 12 &&
						!files.some((file) => file.absolutePath === removePath)
					)
				}, `mixed burst ${index / 4 + 1}`)
			} catch (error) {
				const files = handle.current!.getSnapshot().files
				throw new Error(
					`${String(error)}; create=${files.some((file) => file.absolutePath === createPath)} ` +
						`rewrite=${files.find((file) => file.absolutePath === rewritePath)?.mtimeMs}/${rewriteBefore.mtimeMs} ` +
						`atomic=${files.find((file) => file.absolutePath === atomicPath)?.size} ` +
						`remove=${files.some((file) => file.absolutePath === removePath)} events=${eventBatches}`,
				)
			}
			const latency = elapsed(mutationStarted)
			mutationLatencyMs.push(latency)
			atomicSaveLatencyMs.push(latency)
			peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss())
		}
		for (let index = 0; index < mutationCount; index++) {
			const path = join(root, `mutation-${index.toString().padStart(3, "0")}.md`)
			await rm(path, { force: true })
			await rm(`${path}.tmp`, { force: true })
		}
		emitEvents!(
			Array.from({ length: mutationCount }, (_, index) => ({
				type: "delete" as const,
				path: join(root, `mutation-${index.toString().padStart(3, "0")}.md`),
			})),
		)
		await waitFor(
			() => handle.current!.getSnapshot().files.length === expectedCount,
			"mutation cleanup",
		)
		return {
			firstVisibleBatchMs,
			completionMs,
			scanTransactions: startupSnapshots - 1,
			reactSnapshots,
			reactCommits,
			eventBatches,
			readerReads,
			cpuUserMs: startupCpu.user / 1_000,
			cpuSystemMs: startupCpu.system / 1_000,
			peakRssDeltaBytes: Math.max(0, peakRssBytes - baselineRssBytes),
			snapshotPublications: reactSnapshots - startupSnapshots,
			mutationLatencyMs,
			atomicSaveLatencyMs,
		}
	} finally {
		delete (globalThis as Record<string, unknown>).__house_file_navigator_watcher_factory__
		if (setup) await act(async () => setup!.renderer.destroy())
	}
}

if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
	console.log("usage: bun run dev/bench-file-navigator.tsx --record")
	process.exit(0)
}
if (!Bun.argv.includes("--record")) {
	console.error("Pass --record to write production benchmark evidence.")
	process.exit(1)
}

const cells = []
for (const count of fixtureCounts) {
	const fixture = await createFixture(count)
	try {
		const oldTrials: TrialMetrics[] = []
		const currentTrials: TrialMetrics[] = []
		for (let run = 1; run <= runs; run++) {
			console.log(`benchmark ${count}: old ${run}/${runs}`)
			oldTrials.push(await runOldTrial(fixture.root))
			console.log(`benchmark ${count}: current ${run}/${runs}`)
			currentTrials.push(await runCurrentTrial(fixture.root, count))
		}
		cells.push({
			fixture: { files: count, shape: "broad", manifestHash: fixture.manifestHash },
			old: {
				productionCommit: baselineCommit,
				batching: { maxEntries: 64, maxWindowMs: 60 },
				liveMutationSupport: false,
				trials: oldTrials,
			},
			current: {
				productionCommit: "working-tree",
				liveMutationSupport: true,
				trials: currentTrials,
				mutationLatencyMs: summarize(currentTrials.flatMap((trial) => trial.mutationLatencyMs ?? [])),
				atomicSaveLatencyMs: summarize(
					currentTrials.flatMap((trial) => trial.atomicSaveLatencyMs ?? []),
				),
			},
		})
	} finally {
		await rm(fixture.root, { recursive: true, force: true })
	}
}

const result = {
	schemaVersion: 1,
	recordedAt: new Date().toISOString(),
	runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
	dependencies: { house: pkg.version, react: "19.2.6", opentui: "0.2.15", parcelWatcher: "2.6.0" },
	methodology: {
		viewport: { width: 80, height: 10 },
		runs,
		mutationsPerCurrentTrial: mutationCount,
		watcherInput: "one deterministic Parcel-shaped event batch per completed mixed burst",
		settlementBarrier: "public FileNavigator refresh after each event batch",
		oldMutationMetrics: "unsupported: pre-migration production had no filesystem watcher",
	},
	cells,
}
await writeFile(outputPath, `${JSON.stringify(result, null, "\t")}\n`)
console.log(`recorded ${outputPath}`)
