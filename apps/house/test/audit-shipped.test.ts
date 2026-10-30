import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
	applyExceptions,
	type AuditAdvisory,
	auditConfigErrors,
	type AuditReport,
	auditReportErrors,
	findShippedAdvisories,
	packageName,
	shippedPackages,
	shippedPackagesOf,
	validateExceptions,
} from "../dev/audit-shipped.ts"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

const advisory = (
	id: string,
	severity: string,
	...paths: readonly string[]
): [string, AuditAdvisory] => [
	id,
	{
		github_advisory_id: id,
		module_name: "pkg",
		severity,
		vulnerable_versions: "<2.0.0",
		patched_versions: ">=2.0.0",
		url: `https://github.com/advisories/${id}`,
		findings: [{ paths }],
	},
]

const found = (...advisories: [string, AuditAdvisory][]) =>
	findShippedAdvisories(
		{ advisories: Object.fromEntries(advisories) },
		new Map([
			["apps__house", new Set(["marked", "mermaid"])],
			["packages__ui", new Set(["fuzzysort"])],
		]),
	).map(({ advisory, path }) => [advisory.github_advisory_id, path])

describe("audit-shipped", () => {
	test("reduces import specifiers to package names", () => {
		expect(packageName("effect/reactivity/Atom")).toBe("effect")
		expect(packageName("@shikijs/langs/yaml")).toBe("@shikijs/langs")
		expect(packageName("react")).toBe("react")
	})

	test("ships production dependencies and the devDependencies src imports", () => {
		const shipped = shippedPackagesOf(
			{
				dependencies: { marked: "1" },
				optionalDependencies: { "@carlesandres/house-linux-x64": "1" },
				devDependencies: { mermaid: "1", playwright: "1" },
				peerDependencies: { react: "1" },
			},
			new Set(["mermaid", "react", "node:fs", "undeclared"]),
		)
		expect([...shipped].sort()).toEqual([
			"@carlesandres/house-linux-x64",
			"marked",
			"mermaid",
			"react",
		])
	})

	test("finds the bundled devDependencies of every workspace package", () => {
		const shipped = shippedPackages(repoRoot)
		const house = shipped.get("apps__house")!
		expect(house.has("mermaid")).toBe(true)
		expect(house.has("@opentui/core")).toBe(true)
		expect(house.has("tuistory")).toBe(false)
		expect(house.has("playwright")).toBe(false)
		const ui = shipped.get("packages__ui")!
		expect(ui.has("fuzzysort")).toBe(true)
		expect(ui.has("oxfmt")).toBe(false)
		expect(shipped.has("packages__options")).toBe(true)
	})

	test("blocks only high and critical advisories reached through a shipped package", () => {
		expect(
			found(
				advisory(
					"GHSA-aaaa-aaaa-aaaa",
					"high",
					"apps__house>tuistory>hono",
					"apps__house>mermaid>x",
				),
				advisory("GHSA-bbbb-bbbb-bbbb", "critical", "packages__ui>fuzzysort"),
				advisory("GHSA-cccc-cccc-cccc", "moderate", "apps__house>marked"),
				advisory("GHSA-dddd-dddd-dddd", "critical", "apps__house>tuistory>zod"),
				advisory("GHSA-eeee-eeee-eeee", "high", "packages__ui>oxfmt>tinypool"),
				advisory("GHSA-ffff-ffff-ffff", "high", ".>turbo>x"),
			),
		).toEqual([
			["GHSA-aaaa-aaaa-aaaa", "apps__house>mermaid>x"],
			["GHSA-bbbb-bbbb-bbbb", "packages__ui>fuzzysort"],
		])
	})

	test("rejects audit reports it cannot classify", () => {
		const shipped = new Map([["apps__house", new Set(["marked"])]])
		const errors = (...advisories: [string, AuditAdvisory][]) =>
			auditReportErrors({ advisories: Object.fromEntries(advisories) }, shipped)
		expect(
			errors(
				advisory("GHSA-aaaa-aaaa-aaaa", "high", "apps__house>marked", ".>turbo>x"),
				advisory("GHSA-bbbb-bbbb-bbbb", "info", "apps__house>tuistory>@hono/node-server"),
			),
		).toEqual([])
		expect(
			errors(
				advisory("GHSA-aaaa-aaaa-aaaa", "HIGH", "apps__house>marked"),
				advisory("GHSA-bbbb-bbbb-bbbb", "high", "apps/house>marked"),
				advisory("GHSA-cccc-cccc-cccc", "high", "apps__house > marked"),
				advisory("GHSA-dddd-dddd-dddd", "high", "marked"),
				advisory("GHSA-eeee-eeee-eeee", "high"),
				advisory("GHSA-ffff-ffff-ffff", "high", "apps__house>marked@18.0.0"),
				advisory("GHSA-gggg-gggg-gggg", "high", "apps__house>node_modules/marked"),
			),
		).toEqual([
			'GHSA-aaaa-aaaa-aaaa: unrecognised severity "HIGH"',
			'GHSA-bbbb-bbbb-bbbb: unrecognised audit path "apps/house>marked"',
			'GHSA-cccc-cccc-cccc: unrecognised audit path "apps__house > marked"',
			'GHSA-dddd-dddd-dddd: unrecognised audit path "marked"',
			"GHSA-eeee-eeee-eeee: no dependency paths in the audit report",
			'GHSA-ffff-ffff-ffff: unrecognised audit path "apps__house>marked@18.0.0"',
			'GHSA-gggg-gggg-gggg: unrecognised audit path "apps__house>node_modules/marked"',
		])
	})

	test("accepts an exception with a reason that expires within 90 days", () => {
		const entry = {
			advisory: "GHSA-aaaa-aaaa-aaaa",
			reason: "not reachable",
			expires: "2026-12-01",
		}
		expect(validateExceptions([entry], "2026-10-29")).toEqual([])
		expect(validateExceptions([], "2026-10-29")).toEqual([])
	})

	test("rejects expired, open-ended and incomplete exceptions", () => {
		const base = { advisory: "GHSA-aaaa-aaaa-aaaa", reason: "not reachable" }
		expect(validateExceptions([{ ...base, expires: "2026-10-28" }], "2026-10-29")).toEqual([
			"GHSA-aaaa-aaaa-aaaa: expired on 2026-10-28",
		])
		expect(validateExceptions([{ ...base, expires: "2027-01-28" }], "2026-10-29")).toEqual([
			'GHSA-aaaa-aaaa-aaaa: "expires" must be at most 90 days away',
		])
		expect(validateExceptions([{ ...base, expires: "2026-11-31" }], "2026-10-29")).toEqual([
			'GHSA-aaaa-aaaa-aaaa: "expires" must be a YYYY-MM-DD date',
		])
		expect(
			validateExceptions(
				[{ advisory: "CVE-2026-1", reason: " ", expires: "2026-11-01" }],
				"2026-10-29",
			),
		).toEqual([
			'CVE-2026-1: "advisory" must be a GHSA id',
			'CVE-2026-1: "reason" must say why the advisory is accepted',
		])
		expect(validateExceptions({}, "2026-10-29")).toEqual([
			"the exceptions file must hold a JSON array",
		])
	})

	test("reads real pnpm audit output", () => {
		const report = JSON.parse(
			readFileSync(new URL("fixtures/pnpm-audit.json", import.meta.url), "utf8"),
		) as AuditReport
		const shipped = shippedPackages(repoRoot)
		expect(auditReportErrors(report, shipped)).toEqual([])
		const ids = findShippedAdvisories(report, shipped).map(
			({ advisory }) => advisory.github_advisory_id,
		)
		expect(ids.sort()).toEqual(["GHSA-cg2g-xh64-v4q7", "GHSA-r5fr-rjxr-66jc"])
	})

	test("stops blocking only the advisories an exception accepts", () => {
		const [, high] = advisory("GHSA-aaaa-aaaa-aaaa", "high", "apps__house>marked")
		const [, critical] = advisory("GHSA-bbbb-bbbb-bbbb", "critical", "apps__house>mermaid")
		const accepted = {
			advisory: "GHSA-aaaa-aaaa-aaaa",
			reason: "unreachable",
			expires: "2026-12-01",
		}
		const stale = { advisory: "GHSA-cccc-cccc-cccc", reason: "fixed", expires: "2026-12-01" }
		const result = applyExceptions(
			[
				{ advisory: high, path: "apps__house>marked" },
				{ advisory: critical, path: "apps__house>mermaid" },
			],
			[accepted, stale],
		)
		expect(result.blocking.map(({ advisory }) => advisory.github_advisory_id)).toEqual([
			"GHSA-bbbb-bbbb-bbbb",
		])
		expect(result.accepted).toEqual([accepted])
		expect(result.unused).toEqual([stale])
	})

	test("rejects pnpm's own audit ignore list", () => {
		expect(auditConfigErrors({}, {})).toEqual([])
		expect(
			auditConfigErrors(
				{ auditConfig: { ignoreGhsas: ["GHSA-aaaa-aaaa-aaaa"] } },
				{ pnpm: { auditConfig: {} } },
			),
		).toEqual([
			"pnpm-workspace.yaml: remove auditConfig and accept advisories in audit-exceptions.json",
			"package.json: remove pnpm.auditConfig and accept advisories in audit-exceptions.json",
		])
		const workspace = Bun.YAML.parse(readFileSync(`${repoRoot}pnpm-workspace.yaml`, "utf8"))
		const manifest = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"))
		expect(auditConfigErrors(workspace as object, manifest)).toEqual([])
	})

	test("keeps every checked-in exception well formed", () => {
		const file = new URL("../dev/audit-exceptions.json", import.meta.url)
		const today = new Date().toISOString().slice(0, 10)
		const errors = validateExceptions(JSON.parse(readFileSync(file, "utf8")), today)
		expect(errors.filter((error) => !/: expired on /.test(error))).toEqual([])
	})
})
