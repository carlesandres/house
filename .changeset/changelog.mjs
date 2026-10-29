const releaseLine = (changeset) => {
	const [first, ...rest] = changeset.summary.split("\n").map((line) => line.trimEnd())
	return [`- ${first}`, ...rest.map((line) => (line ? `  ${line}` : line))].join("\n")
}

export default {
	getReleaseLine: async (changeset) => releaseLine(changeset),
	getDependencyReleaseLine: async () => "",
}
