import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { generateStandaloneHost } from "../dev/standalone-host.ts"
import { releaseTargets } from "../dev/release-targets.ts"

const repoFile = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8")

type ChangelogFunctions = {
	getReleaseLine: (changeset: { summary: string }) => Promise<string>
	getDependencyReleaseLine: () => Promise<string>
}

describe("release", () => {
	test("maps every release target to its exact Parcel native package", () => {
		expect(releaseTargets.map((target) => target.parcelNativePackage)).toEqual([
			"@parcel/watcher-darwin-arm64",
			"@parcel/watcher-darwin-x64",
			"@parcel/watcher-linux-arm64-glibc",
			"@parcel/watcher-linux-x64-glibc",
		])
	})

	test("generates a static Parcel host before importing House", () => {
		const source = generateStandaloneHost(releaseTargets[0]!)
		expect(source).toContain('import binding from "@parcel/watcher-darwin-arm64"')
		expect(source).toContain('import { createWrapper } from "@parcel/watcher/wrapper"')
		expect(source.indexOf("createWrapper")).toBeLessThan(source.indexOf("await import"))
		expect(source).toContain("__house_file_navigator_watcher_factory__")
	})

	test("pins CI and publish jobs to the approved Bun runtime", () => {
		const ci = repoFile(".github/workflows/ci.yml")
		const publish = repoFile(".github/workflows/publish.yml")
		const release = repoFile(".github/workflows/release.yml")
		expect(repoFile(".bun-version").trim()).toBe("1.3.14")
		expect(ci.match(/bun-version-file: \.bun-version/g)).toHaveLength(2)
		expect(publish.match(/bun-version-file: \.bun-version/g)).toHaveLength(3)
		expect(release).not.toContain("oven-sh/setup-bun@")
		expect(`${ci}\n${publish}\n${release}`).not.toMatch(/bun-version:|bun install/)
	})

	test("installs CI and publish dependencies from the frozen pnpm lockfile", () => {
		for (const name of ["ci.yml", "publish.yml"]) {
			const workflow = repoFile(`.github/workflows/${name}`)
			const setups = workflow.match(/oven-sh\/setup-bun@/g)?.length ?? 0
			expect(workflow.match(/pnpm\/action-setup@/g)).toHaveLength(setups)
			expect(workflow.match(/- run: pnpm install --frozen-lockfile$/gm)).toHaveLength(setups)
		}
		const release = repoFile(".github/workflows/release.yml")
		expect(release.match(/pnpm\/action-setup@/g)).toHaveLength(1)
		expect(release).toContain("run: pnpm install --frozen-lockfile --ignore-scripts\n")
	})

	test("keeps the pnpm lockfile readable by GitHub's dependency graph", () => {
		const lockfile = repoFile("pnpm-lock.yaml")
		expect(lockfile).not.toMatch(/^---$/m)
		expect(lockfile).not.toContain("packageManagerDependencies")
	})

	test("releases from main through a Changesets version pull request", () => {
		const release = repoFile(".github/workflows/release.yml")
		expect(release).toContain("push:\n    branches: [main]")
		expect(release).toContain(
			"uses: changesets/action/version@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2",
		)
		expect(release).not.toContain("id-token")
		expect(release.match(/persist-credentials: false/g)).toHaveLength(
			release.match(/actions\/checkout@/g)!.length,
		)
		expect(release).toContain('--notes-file "${notes}"')
		expect(release).toContain('gh workflow run publish.yml --ref "${tag}"')
		expect(release).toContain("gh workflow run ci.yml")
		expect(release).toContain("--ref changeset-release/main")
	})

	test("keeps installed dependencies away from the token that can dispatch publishing", () => {
		const release = repoFile(".github/workflows/release.yml")
		const jobs = release
			.slice(release.indexOf("\njobs:\n"))
			.split(/^ {2}(?=[a-z-]+:\n)/m)
			.slice(1)
		expect(jobs.map((job) => job.slice(0, job.indexOf(":")))).toEqual([
			"release",
			"version",
			"start-ci",
		])
		const [releaseJob, versionJob, startCiJob] = jobs as [string, string, string]
		expect(versionJob).not.toContain("actions: write")
		expect(versionJob).toContain("pnpm install --frozen-lockfile --ignore-scripts")
		expect(versionJob).toContain("changesets/action/version@")
		for (const job of [releaseJob, startCiJob]) {
			expect(job).toContain("actions: write")
			expect(job).not.toMatch(/pnpm|npx|node_modules|setup-node|changesets\/action|actions\/cache/)
		}
	})

	test("names only the published package in changesets", () => {
		const dir = new URL("../../../.changeset/", import.meta.url)
		const files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md")
		for (const name of files) {
			const frontmatter = readFileSync(new URL(name, dir), "utf8").split("---")[1] ?? ""
			const packages = [...frontmatter.matchAll(/^\s*["']?([^"':]+)["']?\s*:/gm)].map(
				(match) => match[1],
			)
			expect({ name, packages }).toEqual({ name, packages: ["@carlesandres/house"] })
		}
	})

	test("publishes only tags whose commit is on main and sets the package version", () => {
		const release = repoFile(".github/workflows/release.yml")
		const publish = repoFile(".github/workflows/publish.yml")
		expect(release).toContain("git log -1 --first-parent --diff-merges=first-parent")
		expect(release).toContain('[ "$(version_at "${target}")" != "${version}" ]')
		expect(release).toContain('[ "${tag_commit}" != "${target}" ]')
		expect(release).toContain('if ! gh release view "${tag}" >/dev/null; then')
		expect(release).toContain('[[ "${subject}" != "chore: version packages"* ]]')
		expect(publish).toContain('git/ref/heads/main" --jq .object.sha')
		expect(publish).toContain('compare/${main_sha}...${GITHUB_SHA}"')
		expect(publish.indexOf("Verify the ref is on main")).toBeLessThan(
			publish.indexOf("build-binary:"),
		)
	})

	test("limits the version pull request to release files", () => {
		const ci = repoFile(".github/workflows/ci.yml")
		expect(ci).toContain("version-pr-scope:")
		expect(ci).toContain("github.event.pull_request.head.repo.full_name == github.repository)")
		expect(ci).toContain('[ "$(git rev-list --count "${base}..HEAD")" != 1 ]')
		expect(ci).toContain("needs: version-pr-scope\n    if: ${{ !cancelled() }}")
		expect(ci).toContain("if: needs.version-pr-scope.result == 'failure'")
		expect(ci).toContain("needs: [version-pr-scope, check, npm-install-smoke]")
		expect(ci).toContain('[ "${SCOPE_RESULT}" = "success" ]')
	})

	test("blocks the version pull request on advisories in shipped dependencies", () => {
		const ci = repoFile(".github/workflows/ci.yml")
		const check = ci.slice(ci.indexOf("\n  check:\n"), ci.indexOf("\n  npm-install-smoke:\n"))
		const step = check.slice(check.indexOf("- name: Audit shipped dependencies"))
		const blocking = step.slice(step.indexOf("HOUSE_AUDIT_BLOCKING:"), step.indexOf("run:"))
		expect(blocking.replace(/\s+/g, " ")).toBe(
			"HOUSE_AUDIT_BLOCKING: >- ${{ github.ref_name == 'changeset-release/main' || " +
				"github.head_ref == 'changeset-release/main' }} ",
		)
		expect(step).toContain("run: bun run --cwd apps/house audit:shipped\n")
		expect(step.slice(0, step.indexOf("run:"))).not.toContain("continue-on-error")
	})

	test("reports the required check on the workflow-created version pull request", () => {
		const ci = repoFile(".github/workflows/ci.yml")
		expect(ci).toContain("statuses: write")
		expect(ci.match(/context=check/g)).toHaveLength(2)
		expect(ci.match(/github\.ref_name == 'changeset-release\/main'/g)).toHaveLength(4)
		expect(ci).not.toContain("release/v")
	})

	test("writes changelog entries as plain bullets", async () => {
		const path = new URL("../../../.changeset/changelog.mjs", import.meta.url).href
		const changelog = ((await import(path)) as { default: ChangelogFunctions }).default
		expect(await changelog.getReleaseLine({ summary: "Fixed a thing.  \n\nMore detail." })).toBe(
			"- Fixed a thing.\n\n  More detail.",
		)
		expect(await changelog.getDependencyReleaseLine()).toBe("")
	})

	test("verifies every published package, the installed binary, and release assets", () => {
		const publish = repoFile(".github/workflows/publish.yml")
		expect(publish).toContain("verify-published:")
		expect(publish).toContain("@carlesandres/house-darwin-arm64")
		expect(publish).toContain("@carlesandres/house-darwin-x64")
		expect(publish).toContain("@carlesandres/house-linux-arm64")
		expect(publish).toContain("@carlesandres/house-linux-x64")
		expect(publish).toContain('house-release-smoke/bin/house" --version')
		expect(publish).toContain('gh release view "v${VERSION}" --json assets')
	})
})
