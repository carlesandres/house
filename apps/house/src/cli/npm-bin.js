#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const pkg = require("../../package.json")

const supportedTargets = {
	darwin: new Set(["arm64", "x64"]),
	linux: new Set(["arm64", "x64"]),
}

const mainBinaryName = "house"
const fastExitFlags = new Set(["--help", "-h", "--version", "-v", "--config-path"])

export const detectLinuxLibc = () => {
	if (process.platform !== "linux") return undefined
	const report = process.report?.getReport?.()
	const header = report?.header
	return typeof header?.glibcVersionRuntime === "string" ? "glibc" : "musl"
}

export const binaryPackageNameFor = (
	platform,
	arch,
	libc = platform === "linux" ? detectLinuxLibc() : undefined,
) => {
	if (platform in supportedTargets && supportedTargets[platform].has(arch)) {
		if (platform === "linux" && libc !== "glibc") return undefined
		return `${pkg.name}-${platform}-${arch}`
	}
	return undefined
}

export const resolveBinaryPath = (packageName, resolve = require.resolve) =>
	resolve(`${packageName}/bin/${mainBinaryName}`)

export const shouldCaptureOutput = (argv) => argv.some((arg) => fastExitFlags.has(arg))

export const main = (
	argv = process.argv.slice(2),
	platform = process.platform,
	arch = process.arch,
	libc = detectLinuxLibc(),
) => {
	if (argv.includes("--version") || argv.includes("-v")) {
		console.log(pkg.version)
		process.exit(0)
	}

	const packageName = binaryPackageNameFor(platform, arch, libc)
	if (packageName === undefined) {
		console.error(
			`house: no prebuilt binary package for ${platform}-${arch}${platform === "linux" ? `-${libc ?? "unknown-libc"}` : ""}`,
		)
		process.exit(1)
	}

	let binaryPath
	try {
		binaryPath = resolveBinaryPath(packageName)
	} catch {
		console.error(
			`house: missing optional dependency ${packageName}; reinstall house to fetch the matching binary package`,
		)
		process.exit(1)
	}

	const captureOutput = shouldCaptureOutput(argv)
	const result = spawnSync(binaryPath, argv, {
		stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
	})

	if (captureOutput) {
		if (result.stdout !== null) process.stdout.write(result.stdout)
		if (result.stderr !== null) process.stderr.write(result.stderr)
	}

	if (result.error !== undefined) {
		console.error(`house: failed to launch ${packageName}: ${result.error.message}`)
		process.exit(1)
	}

	process.exit(result.status ?? 1)
}

const isMain =
	process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) main()
