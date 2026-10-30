#!/usr/bin/env bun
// Fails on high or critical advisories in dependencies that ship in house. A package ships when
// it is a production dependency of a workspace package or when that package's src/ imports it:
// the build bundles src/, so bundled devDependencies such as mermaid ship too. Every workspace
// package counts as bundled into house. HOUSE_AUDIT_BLOCKING=false reports without failing.
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

export interface AuditFinding {
	readonly paths: readonly string[]
}

export interface AuditAdvisory {
	readonly github_advisory_id: string
	readonly module_name: string
	readonly severity: string
	readonly vulnerable_versions: string
	readonly patched_versions: string
	readonly url: string
	readonly findings: readonly AuditFinding[]
}

export interface AuditReport {
	readonly advisories: Readonly<Record<string, AuditAdvisory>>
}

export interface AuditException {
	readonly advisory: string
	readonly reason: string
	readonly expires: string
}

export interface ShippedAdvisory {
	readonly advisory: AuditAdvisory
	readonly path: string
}

interface PackageManifest {
	readonly dependencies?: Readonly<Record<string, string>>
	readonly devDependencies?: Readonly<Record<string, string>>
	readonly optionalDependencies?: Readonly<Record<string, string>>
	readonly peerDependencies?: Readonly<Record<string, string>>
}

interface Workspace {
	readonly packages: readonly string[]
	readonly auditConfig?: unknown
}

export interface AppliedExceptions {
	readonly blocking: readonly ShippedAdvisory[]
	readonly accepted: readonly AuditException[]
	readonly unused: readonly AuditException[]
}

const BLOCKING_SEVERITIES = new Set(["high", "critical"])
const KNOWN_SEVERITIES = new Set(["info", "low", "moderate", ...BLOCKING_SEVERITIES])
const ROOT_IMPORTER = "."
const PACKAGE_NAME = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i
const MAX_EXCEPTION_DAYS = 90
const GHSA_ID = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

const repoRoot = resolve(import.meta.dir, "../../..")
const exceptionsPath = join(import.meta.dir, "audit-exceptions.json")

export const packageName = (specifier: string): string => {
	const parts = specifier.split("/")
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!
}

const transpilers: Readonly<Record<string, Bun.Transpiler>> = {
	ts: new Bun.Transpiler({ loader: "ts" }),
	tsx: new Bun.Transpiler({ loader: "tsx" }),
	js: new Bun.Transpiler({ loader: "js" }),
	jsx: new Bun.Transpiler({ loader: "jsx" }),
	mjs: new Bun.Transpiler({ loader: "js" }),
	cjs: new Bun.Transpiler({ loader: "js" }),
}

const sourceImports = (dir: string): Set<string> => {
	const imports = new Set<string>()
	for (const file of new Bun.Glob("src/**/*.{ts,tsx,js,jsx,mjs,cjs}").scanSync(dir)) {
		if (file.endsWith(".d.ts")) continue
		const transpiler = transpilers[file.slice(file.lastIndexOf(".") + 1)]!
		const source = readFileSync(join(dir, file), "utf8").replace(/^#!.*/, "")
		for (const { path } of transpiler.scanImports(source)) {
			imports.add(packageName(path))
		}
	}
	return imports
}

export const shippedPackagesOf = (
	manifest: PackageManifest,
	imports: ReadonlySet<string>,
): Set<string> => {
	const shipped = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
	])
	const declared = new Set([
		...Object.keys(manifest.devDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	])
	for (const name of imports) if (declared.has(name)) shipped.add(name)
	return shipped
}

// Keyed by pnpm audit's importer id: the workspace directory with "/" replaced by "__".
const readWorkspace = (root: string): Workspace =>
	Bun.YAML.parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")) as Workspace

export const shippedPackages = (root: string): Map<string, Set<string>> => {
	const workspace = readWorkspace(root)
	const shipped = new Map<string, Set<string>>()
	for (const pattern of workspace.packages) {
		for (const file of new Bun.Glob(`${pattern}/package.json`).scanSync(root)) {
			const dir = file.slice(0, -"/package.json".length).replace(/^\.\//, "")
			const manifest = JSON.parse(readFileSync(join(root, file), "utf8")) as PackageManifest
			shipped.set(
				dir.replaceAll("/", "__"),
				shippedPackagesOf(manifest, sourceImports(join(root, dir))),
			)
		}
	}
	return shipped
}

const parseDate = (value: string): number | undefined => {
	if (!ISO_DATE.test(value)) return undefined
	const time = Date.parse(`${value}T00:00:00Z`)
	return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value
		? undefined
		: time
}

export const validateExceptions = (exceptions: unknown, today: string): string[] => {
	if (!Array.isArray(exceptions)) return ["the exceptions file must hold a JSON array"]
	const now = parseDate(today)!
	const errors: string[] = []
	for (const [index, entry] of exceptions.entries()) {
		const { advisory, reason, expires } = (entry ?? {}) as Partial<AuditException>
		const label = typeof advisory === "string" ? advisory : `entry ${index}`
		if (typeof advisory !== "string" || !GHSA_ID.test(advisory)) {
			errors.push(`${label}: "advisory" must be a GHSA id`)
		}
		if (typeof reason !== "string" || reason.trim() === "") {
			errors.push(`${label}: "reason" must say why the advisory is accepted`)
		}
		const until = typeof expires === "string" ? parseDate(expires) : undefined
		if (until === undefined) {
			errors.push(`${label}: "expires" must be a YYYY-MM-DD date`)
		} else if (until < now) {
			errors.push(`${label}: expired on ${expires}`)
		} else if (until - now > MAX_EXCEPTION_DAYS * DAY_MS) {
			errors.push(`${label}: "expires" must be at most ${MAX_EXCEPTION_DAYS} days away`)
		}
	}
	return errors
}

const findingPaths = (finding: AuditFinding): readonly string[] =>
	Array.isArray(finding.paths) ? finding.paths : []

export const findShippedAdvisories = (
	report: AuditReport,
	shipped: ReadonlyMap<string, ReadonlySet<string>>,
): ShippedAdvisory[] => {
	const found: ShippedAdvisory[] = []
	for (const advisory of Object.values(report.advisories)) {
		if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue
		const path = advisory.findings.flatMap(findingPaths).find((candidate) => {
			const [importer, dependency] = candidate.split(">")
			return dependency !== undefined && shipped.get(importer!)?.has(dependency) === true
		})
		if (path !== undefined) found.push({ advisory, path })
	}
	return found
}

// findShippedAdvisories treats a path it cannot place as not shipped, so a change in pnpm's
// report format must fail here instead of passing silently.
export const auditReportErrors = (
	report: AuditReport,
	shipped: ReadonlyMap<string, ReadonlySet<string>>,
): string[] => {
	const errors: string[] = []
	for (const advisory of Object.values(report.advisories)) {
		const id = advisory.github_advisory_id
		if (!KNOWN_SEVERITIES.has(advisory.severity)) {
			errors.push(`${id}: unrecognised severity "${advisory.severity}"`)
		}
		const paths = advisory.findings.flatMap(findingPaths)
		if (paths.length === 0) errors.push(`${id}: no dependency paths in the audit report`)
		for (const path of paths) {
			const [importer, ...dependencies] = path.split(">")
			if (
				dependencies.length === 0 ||
				(importer !== ROOT_IMPORTER && !shipped.has(importer!)) ||
				!dependencies.every((name) => PACKAGE_NAME.test(name))
			) {
				errors.push(`${id}: unrecognised audit path "${path}"`)
			}
		}
	}
	return errors
}

// pnpm's own ignore list has no reason or expiry, and it hides advisories from this report.
export const auditConfigErrors = (
	workspace: { readonly auditConfig?: unknown },
	rootManifest: { readonly pnpm?: { readonly auditConfig?: unknown } },
): string[] => [
	...(workspace.auditConfig === undefined
		? []
		: ["pnpm-workspace.yaml: remove auditConfig and accept advisories in audit-exceptions.json"]),
	...(rootManifest.pnpm?.auditConfig === undefined
		? []
		: ["package.json: remove pnpm.auditConfig and accept advisories in audit-exceptions.json"]),
]

export const applyExceptions = (
	found: readonly ShippedAdvisory[],
	exceptions: readonly AuditException[],
): AppliedExceptions => {
	const ids = new Set(exceptions.map((entry) => entry.advisory))
	const used = new Set(found.map(({ advisory }) => advisory.github_advisory_id))
	return {
		blocking: found.filter(({ advisory }) => !ids.has(advisory.github_advisory_id)),
		accepted: exceptions.filter((entry) => used.has(entry.advisory)),
		unused: exceptions.filter((entry) => !used.has(entry.advisory)),
	}
}

const runAudit = (): AuditReport => {
	const result = Bun.spawnSync(["pnpm", "audit", "--json", "--audit-level", "low"], {
		cwd: repoRoot,
		stderr: "pipe",
	})
	const stdout = result.stdout.toString()
	try {
		const report = JSON.parse(stdout) as Partial<AuditReport>
		if (report.advisories !== null && typeof report.advisories === "object") {
			return report as AuditReport
		}
	} catch {}
	console.error(stdout.trim())
	console.error(result.stderr.toString().trim())
	throw new Error(`pnpm audit did not return a report (exit ${result.exitCode})`)
}

const describe = ({ advisory, path }: ShippedAdvisory): string =>
	`${advisory.severity} ${advisory.github_advisory_id} in ${advisory.module_name} ` +
	`${advisory.vulnerable_versions} (fixed in ${advisory.patched_versions}) via ${path}: ` +
	advisory.url

const annotate = (level: "error" | "warning", line: string): void => {
	console.error(process.env.GITHUB_ACTIONS === "true" ? `::${level}::${line}` : line)
}

const audit = (): string[] => {
	const today = new Date().toISOString().slice(0, 10)
	const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
		pnpm?: { auditConfig?: unknown }
	}
	const problems = auditConfigErrors(readWorkspace(repoRoot), rootManifest)
	const exceptions = JSON.parse(readFileSync(exceptionsPath, "utf8")) as unknown
	const exceptionErrors = validateExceptions(exceptions, today)
	problems.push(...exceptionErrors.map((error) => `audit-exceptions.json: ${error}`))

	const report = runAudit()
	const shipped = shippedPackages(repoRoot)
	problems.push(...auditReportErrors(report, shipped))
	const found = findShippedAdvisories(report, shipped)
	const valid = exceptionErrors.length === 0 ? (exceptions as AuditException[]) : []
	const { blocking, accepted, unused } = applyExceptions(found, valid)
	for (const entry of accepted) {
		console.log(`accepted ${entry.advisory} until ${entry.expires}: ${entry.reason}`)
	}
	for (const entry of unused) {
		annotate("warning", `exception ${entry.advisory} matches nothing shipped; remove it`)
	}
	return [...problems, ...blocking.map(describe)]
}

if (import.meta.main) {
	let problems: string[]
	try {
		problems = audit()
	} catch (error) {
		problems = [error instanceof Error ? error.message : String(error)]
	}
	if (problems.length === 0) {
		console.log("No high or critical advisories in shipped dependencies.")
	} else {
		const blocking = process.env.HOUSE_AUDIT_BLOCKING !== "false"
		for (const line of problems) annotate(blocking ? "error" : "warning", line)
		process.exit(blocking ? 1 : 0)
	}
}
