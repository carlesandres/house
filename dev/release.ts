#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { bumpStableVersion, isStableVersion, releaseChangelog, type Bump } from "./release-plan.ts"

const root = resolve(import.meta.dir, "..")
const run = (command: string, args: string[], options: { allowFailure?: boolean } = {}): string => {
	const result = Bun.spawnSync([command, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
	const output = new TextDecoder().decode(result.stdout).trim()
	if (!result.success && !options.allowFailure) {
		throw new Error(
			`${command} ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr).trim()}`,
		)
	}
	return output
}
const fail = (message: string): never => {
	console.error(`release: ${message}`)
	process.exit(1)
}
const args = Bun.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
	console.log("usage: bun run release -- [patch|minor|major|VERSION] [--dry-run] [--yes]")
	process.exit(0)
}
const dryRun = args.includes("--dry-run")
const yes = args.includes("--yes")
const requested = args.find((arg) => !arg.startsWith("--")) ?? "patch"
if (!isStableVersion(requested) && !["patch", "minor", "major"].includes(requested))
	fail("expected patch, minor, major, or stable VERSION")

try {
	run("git", ["fetch", "origin", "main", "--tags"])
	if (run("git", ["branch", "--show-current"]) !== "main") fail("run from the local main branch")
	if (run("git", ["status", "--porcelain"]) !== "") fail("working tree is not clean")
	if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"]))
		fail("main is not up to date with origin/main")
	const tag = run("git", ["describe", "--tags", "--abbrev=0"])
	const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
		version: string
	}
	if (tag !== `v${pkg.version}`)
		fail(`latest tag ${tag} does not match package version ${pkg.version}`)
	const changelog = await readFile(resolve(root, "CHANGELOG.md"), "utf8")
	const version = isStableVersion(requested)
		? requested
		: bumpStableVersion(pkg.version, requested as Bump)
	const date = new Date().toISOString().slice(0, 10)
	const nextChangelog = releaseChangelog(changelog, version, date, pkg.version)
	const branch = `release/v${version}`
	console.log(`release v${version} from ${tag} (${branch})`)
	if (dryRun) process.exit(0)
	if (!yes) {
		if (prompt("Continue? [y/N]")?.trim().toLowerCase() !== "y") process.exit(0)
	}
	run("git", ["switch", "-c", branch])
	await writeFile(resolve(root, "CHANGELOG.md"), nextChangelog)
	run("bun", ["run", "version:set", version])
	run("git", ["add", "CHANGELOG.md", "package.json", "bun.lock"])
	run("git", ["commit", "-m", `chore: release v${version}`])
	run("git", ["push", "--set-upstream", "origin", branch])
	const pr = run("gh", [
		"pr",
		"create",
		"--base",
		"main",
		"--head",
		branch,
		"--title",
		`chore: release v${version}`,
		"--body",
		`Release v${version}.`,
	])
	const number = pr.match(/\/(\d+)$/)?.[1] ?? fail(`could not parse PR URL: ${pr}`)
	run("gh", ["pr", "checks", number, "--watch"])
	run("gh", ["pr", "merge", number, "--squash", "--delete-branch"])
	const mergeSha = run("gh", [
		"pr",
		"view",
		number,
		"--json",
		"mergeCommit",
		"--jq",
		".mergeCommit.oid",
	])
	run("git", ["switch", "main"])
	run("git", ["pull", "--ff-only", "origin", "main"])
	run("gh", [
		"release",
		"create",
		`v${version}`,
		"--target",
		mergeSha,
		"--title",
		`v${version}`,
		"--generate-notes",
	])
	const workflow = run("gh", [
		"run",
		"list",
		"--workflow",
		"publish.yml",
		"--branch",
		`v${version}`,
		"--limit",
		"10",
		"--json",
		"databaseId,headSha,status,headBranch",
		"--jq",
		`.[] | select(.headBranch == "v${version}") | .databaseId`,
	])
	const workflowId =
		workflow.split("\n").find(Boolean) ?? fail(`could not find publish workflow for v${version}`)
	console.log(`publish workflow: https://github.com/carlesandres/house/actions/runs/${workflowId}`)
	console.log(
		"If publish is waiting for approval, approve the npm environment in GitHub; the watcher will continue.",
	)
	run("gh", ["run", "watch", workflowId])
} catch (error) {
	fail(error instanceof Error ? error.message : String(error))
}
