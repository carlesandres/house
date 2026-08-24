import { decodeValue, isPresent } from "./decode.ts"
import type {
	Catalog,
	LayerValues,
	OptionValues,
	ResolveLayers,
	ResolveResult,
	ResolveLayer,
} from "./types.ts"

const LAYERS: readonly ResolveLayer[] = ["cli", "env", "file"]

export const resolveOptions = <C extends Catalog>(
	specs: C,
	layers: ResolveLayers<C> = {},
): ResolveResult<OptionValues<C>> => {
	const values: Record<string, boolean | number | string> = {}
	for (const key of Object.keys(specs)) {
		const spec = specs[key]!
		let found = false
		for (const layer of LAYERS) {
			const source: LayerValues<C> | undefined = layers[layer]
			if (source === undefined) continue
			const raw = source[key]
			if (!isPresent(raw)) continue
			const decoded = decodeValue(key, spec, layer, raw)
			if (!decoded.ok) return decoded
			values[key] = decoded.value
			found = true
			break
		}
		if (!found) values[key] = spec.default
	}
	return { ok: true, value: values as OptionValues<C> }
}

export const catalogDefaults = <C extends Catalog>(specs: C): OptionValues<C> => {
	const values: Record<string, boolean | number | string> = {}
	for (const key of Object.keys(specs)) values[key] = specs[key]!.default
	return values as OptionValues<C>
}
