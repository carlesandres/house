import {
	buildPreviewAssets,
	type PreviewAssets,
	type SerializedPreviewAssets,
} from "./build-assets.ts"

declare const HOUSE_PREVIEW_ASSETS: SerializedPreviewAssets | undefined

let sourceAssets: Promise<PreviewAssets> | null = null
let embeddedAssets: PreviewAssets | null = null

const deserialize = (serialized: SerializedPreviewAssets): PreviewAssets => ({
	clientPath: serialized.clientPath,
	mermaidPath: serialized.mermaidPath,
	files: new Map(
		Object.entries(serialized.files).map(([path, encoded]) => [
			path,
			{
				path,
				body: Uint8Array.from(atob(encoded.body), (character) => character.charCodeAt(0)),
				contentType: "text/javascript; charset=utf-8",
				...(encoded.gzip ? { contentEncoding: "gzip" as const } : {}),
			},
		]),
	),
})

export const getPreviewAssets = (): Promise<PreviewAssets> => {
	if (typeof HOUSE_PREVIEW_ASSETS !== "undefined") {
		embeddedAssets ??= deserialize(HOUSE_PREVIEW_ASSETS)
		return Promise.resolve(embeddedAssets)
	}
	if (sourceAssets === null) sourceAssets = buildPreviewAssets()
	return sourceAssets
}
