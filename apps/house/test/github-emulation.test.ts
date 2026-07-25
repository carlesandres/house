import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createEmulator, type Emulator } from "emulate"

const token = "house-local-release-token"
const owner = "admin"
const repo = "house"
const apiPath = `/repos/${owner}/${repo}`
const headers = {
	Accept: "application/vnd.github+json",
	Authorization: `Bearer ${token}`,
	"Content-Type": "application/json",
}

let github: Emulator

const request = async (path: string, init?: RequestInit): Promise<Response> => {
	const response = await fetch(`${github.url}${path}`, {
		...init,
		headers: { ...headers, ...init?.headers },
	})
	if (!response.ok) {
		throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`)
	}
	return response
}

beforeAll(async () => {
	github = await createEmulator({
		service: "github",
		port: 46123,
		seed: {
			tokens: { [token]: { login: owner, scopes: ["repo", "workflow"] } },
			github: {
				repos: [{ owner, name: repo, default_branch: "main", auto_init: true }],
			},
		},
	})
})

afterAll(async () => {
	await github.close()
})

describe("GitHub release automation against vercel-labs/emulate", () => {
	test("creates, reads, and uploads an asset to a release", async () => {
		const created = await request(`${apiPath}/releases`, {
			method: "POST",
			body: JSON.stringify({
				tag_name: "v0.5.1",
				target_commitish: "main",
				name: "v0.5.1",
				draft: false,
				prerelease: false,
				generate_release_notes: true,
			}),
		})
		const release = (await created.json()) as {
			id: number
			tag_name: string
			upload_url: string
		}
		expect(release.tag_name).toBe("v0.5.1")

		const byTag = await request(`${apiPath}/releases/tags/v0.5.1`)
		expect(((await byTag.json()) as { id: number }).id).toBe(release.id)

		const uploadUrl = new URL(release.upload_url.replace(/\{\?.*$/, ""))
		uploadUrl.searchParams.set("name", "house-darwin-arm64.tar.gz")
		const uploaded = await fetch(uploadUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/gzip",
			},
			body: "standalone archive",
		})
		expect(uploaded.status).toBe(201)

		const assets = await request(`${apiPath}/releases/${release.id}/assets`)
		expect((await assets.json()) as Array<{ name: string }>).toEqual([
			expect.objectContaining({ name: "house-darwin-arm64.tar.gz" }),
		])
	})

	test("exposes the Actions API used by release verification", async () => {
		const workflows = await request(`${apiPath}/actions/workflows`)
		expect(await workflows.json()).toEqual({ total_count: 0, workflows: [] })
	})
})
