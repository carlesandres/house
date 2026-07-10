export declare const detectLinuxLibc: () => "glibc" | "musl" | undefined

export declare const binaryPackageNameFor: (
	platform: NodeJS.Platform,
	arch: NodeJS.Architecture,
	libc?: "glibc" | "musl" | undefined,
) => string | undefined

export declare const resolveBinaryPath: (
	packageName: string,
	resolve?: (specifier: string) => string,
) => string

export declare const shouldCaptureOutput: (argv: readonly string[]) => boolean

export declare const main: (
	argv?: readonly string[],
	platform?: NodeJS.Platform,
	arch?: NodeJS.Architecture,
	libc?: "glibc" | "musl" | undefined,
) => never
