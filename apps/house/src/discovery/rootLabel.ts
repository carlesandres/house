import { isAbsolute, relative } from "node:path"

export interface DiscoveryRootLabelInput {
	readonly discoveryRoot: string
	readonly home: string
}

export const formatDiscoveryRootLabel = ({
	discoveryRoot,
	home,
}: DiscoveryRootLabelInput): string => {
	if (discoveryRoot === home) return "~"
	const homeRelative = relative(home, discoveryRoot)
	if (homeRelative.length > 0 && !homeRelative.startsWith("..") && !isAbsolute(homeRelative)) {
		return `~/${homeRelative}`
	}
	return discoveryRoot
}
