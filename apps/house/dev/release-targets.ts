export interface ReleaseTarget {
	readonly id: string
	readonly os: "darwin" | "linux"
	readonly arch: "arm64" | "x64"
	readonly libc?: "glibc"
	readonly bunTarget: string
	readonly binaryName: string
	readonly opentuiNativePackage: string
}

export const releaseTargets = [
	{
		id: "darwin-arm64",
		os: "darwin",
		arch: "arm64",
		bunTarget: "bun-darwin-arm64",
		binaryName: "house",
		opentuiNativePackage: "@opentui/core-darwin-arm64",
	},
	{
		id: "darwin-x64",
		os: "darwin",
		arch: "x64",
		bunTarget: "bun-darwin-x64",
		binaryName: "house",
		opentuiNativePackage: "@opentui/core-darwin-x64",
	},
	{
		id: "linux-arm64",
		os: "linux",
		arch: "arm64",
		libc: "glibc",
		bunTarget: "bun-linux-arm64",
		binaryName: "house",
		opentuiNativePackage: "@opentui/core-linux-arm64",
	},
	{
		id: "linux-x64",
		os: "linux",
		arch: "x64",
		libc: "glibc",
		bunTarget: "bun-linux-x64",
		binaryName: "house",
		opentuiNativePackage: "@opentui/core-linux-x64",
	},
] as const satisfies readonly ReleaseTarget[]

export type ReleaseTargetId = (typeof releaseTargets)[number]["id"]

export const findReleaseTarget = (id: string): ReleaseTarget | undefined =>
	releaseTargets.find((target) => target.id === id)

export const hostReleaseTarget = (): ReleaseTarget | undefined =>
	releaseTargets.find((target) => target.os === process.platform && target.arch === process.arch)
