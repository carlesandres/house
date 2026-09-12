#!/usr/bin/env bun

import { appendFile, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { bumpStableVersion, isStableVersion, releaseChangelog, type Bump } from "./release-plan.ts"

const appRoot = resolve(import.meta.dir, "..")
const repoRoot = resolve(appRoot, "../..")

type CommandResult = {
	success: boolean
	output: string
	stderr: string
}

const tryRun = (command: string, args: string[], input?: string): CommandResult => {
	const result = Bun.spawnSync([command, ...args], {
		cwd: repoRoot,
		stdin: input ? new TextEncoder().encode(input) : undefined,
		stdout: "pipe",
		stderr: "pipe",
	})
	return {
		success: result.success,
		output: new TextDecoder().decode(result.stdout).trim(),
		stderr: new TextDecoder().decode(result.stderr).trim(),
	}
}

const run = (command: string, args: string[], input?: string): string => {
	const result = tryRun(command, args, input)
	if (!result.success) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`)
	return result.output
}

const fail = (message: string): never => {
	console.error(`release: ${message}`)
	process.exit(1)
}

const emitOutput = async (name: string, value: string): Promise<void> => {
	const outputPath = process.env.GITHUB_OUTPUT
	if (outputPath) await appendFile(outputPath, `${name}=${value}\n`)
}

type PullRequest = {
	mergedAt: string | null
	state: "CLOSED" | "MERGED" | "OPEN"
	url: string
}

const findReleasePullRequest = (branch: string): PullRequest | undefined => {
	const output = run("gh", [
		"pr",
		"list",
		"--head",
		branch,
		"--state",
		"all",
		"--limit",
		"1",
		"--json",
		"url,state,mergedAt",
	])
	return (JSON.parse(output) as PullRequest[])[0]
}

const validateRemoteReleaseBranch = (branch: string, version: string): void => {
	run("git", ["fetch", "origin", `${branch}:refs/remotes/origin/${branch}`])
	const mainSha = run("git", ["rev-parse", "origin/main"])
	const branchParentSha = run("git", ["rev-parse", `origin/${branch}^`])
	if (branchParentSha !== mainSha)
		fail(`${branch} is stale; delete it and prepare the release again from current main`)
	const manifest = JSON.parse(run("git", ["show", `origin/${branch}:apps/house/package.json`])) as {
		version: string
	}
	if (manifest.version !== version)
		fail(`existing ${branch} has package version ${manifest.version}, expected ${version}`)
	const changelog = run("git", ["show", `origin/${branch}:CHANGELOG.md`])
	if (!changelog.includes(`## [${version}]`))
		fail(`existing ${branch} does not contain the ${version} changelog section`)
}

const createReleasePullRequest = (branch: string, version: string): string => {
	const reviewer = run("gh", ["repo", "view", "--json", "owner", "--jq", ".owner.login"])
	return run("gh", [
		"pr",
		"create",
		"--base",
		"main",
		"--head",
		branch,
		"--reviewer",
		reviewer,
		"--title",
		`chore: release v${version}`,
		"--body",
		`Release v${version}. Merging this pull request publishes the release.`,
	])
}

const createVerifiedReleaseCommit = async (
	branch: string,
	version: string,
	mainSha: string,
): Promise<void> => {
	const repository = run("gh", [
		"repo",
		"view",
		"--json",
		"nameWithOwner",
		"--jq",
		".nameWithOwner",
	])
	run("gh", [
		"api",
		"--method",
		"POST",
		`repos/${repository}/git/refs`,
		"-f",
		`ref=refs/heads/${branch}`,
		"-f",
		`sha=${mainSha}`,
	])

	try {
		const additions = await Promise.all(
			["CHANGELOG.md", "apps/house/package.json", "bun.lock"].map(async (path) => ({
				path,
				contents: Buffer.from(await readFile(resolve(repoRoot, path))).toString("base64"),
			})),
		)
		const query = `mutation CreateReleaseCommit($input: CreateCommitOnBranchInput!) {
			createCommitOnBranch(input: $input) { commit { oid } }
		}`
		const output = run(
			"gh",
			["api", "graphql", "--input", "-"],
			JSON.stringify({
				query,
				variables: {
					input: {
						branch: { repositoryNameWithOwner: repository, branchName: branch },
						expectedHeadOid: mainSha,
						message: { headline: `chore: release v${version}` },
						fileChanges: { additions },
					},
				},
			}),
		)
		const commit = JSON.parse(output) as {
			data?: { createCommitOnBranch?: { commit?: { oid?: string } } }
		}
		const oid = commit.data?.createCommitOnBranch?.commit?.oid
		if (!oid) throw new Error("GitHub did not return the release commit oid")
		const verified = run("gh", [
			"api",
			`repos/${repository}/commits/${oid}`,
			"--jq",
			".commit.verification.verified",
		])
		if (verified !== "true") throw new Error(`GitHub did not verify release commit ${oid}`)
	} catch (error) {
		tryRun("gh", ["api", "--method", "DELETE", `repos/${repository}/git/refs/heads/${branch}`])
		throw error
	}
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
	const pkg = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8")) as {
		version: string
	}
	if (tag !== `v${pkg.version}`)
		fail(`latest tag ${tag} does not match package version ${pkg.version}`)
	const changelog = await readFile(resolve(repoRoot, "CHANGELOG.md"), "utf8")
	const version = isStableVersion(requested)
		? requested
		: bumpStableVersion(pkg.version, requested as Bump)
	const date = new Date().toISOString().slice(0, 10)
	const nextChangelog = releaseChangelog(changelog, version, date, pkg.version)
	const branch = `release/v${version}`
	await emitOutput("version", version)
	await emitOutput("branch", branch)
	console.log(`prepare release v${version} from ${tag} (${branch})`)
	if (dryRun) process.exit(0)
	if (!yes && prompt("Create the release pull request? [y/N]")?.trim().toLowerCase() !== "y")
		process.exit(0)

	const remoteBranch = tryRun("git", [
		"ls-remote",
		"--exit-code",
		"--heads",
		"origin",
		`refs/heads/${branch}`,
	])
	let pullRequest: PullRequest | undefined
	let pullRequestUrl: string
	if (remoteBranch.success) {
		validateRemoteReleaseBranch(branch, version)
		pullRequest = findReleasePullRequest(branch)
		if (pullRequest?.state === "CLOSED" && pullRequest.mergedAt === null)
			fail(
				`${pullRequest.url} was closed without merging; remove or rename ${branch} before retrying`,
			)
		pullRequestUrl = pullRequest?.url ?? createReleasePullRequest(branch, version)
		console.log(`reusing release pull request: ${pullRequestUrl}`)
	} else {
		await writeFile(resolve(repoRoot, "CHANGELOG.md"), nextChangelog)
		run("bun", ["run", "version:set", version])
		if (process.env.GITHUB_ACTIONS === "true") {
			await createVerifiedReleaseCommit(branch, version, run("git", ["rev-parse", "origin/main"]))
			run("git", ["restore", "CHANGELOG.md", "apps/house/package.json", "bun.lock"])
		} else {
			run("git", ["switch", "-c", branch])
			run("git", ["add", "CHANGELOG.md", "apps/house/package.json", "bun.lock"])
			run("git", ["commit", "-S", "-m", `chore: release v${version}`])
			run("git", ["push", "--set-upstream", "origin", branch])
			run("git", ["switch", "main"])
		}
		pullRequestUrl = createReleasePullRequest(branch, version)
		console.log(`release pull request: ${pullRequestUrl}`)
	}
	await emitOutput("pr_url", pullRequestUrl)
	console.log("merge the release pull request after CI passes to publish the release")
} catch (error) {
	fail(error instanceof Error ? error.message : String(error))
}
