import { validateFooterSpecs } from "./footer.ts"
import { catalogDefaults, resolveOptions } from "./resolve.ts"
import { createSession } from "./session.ts"
import type { Catalog, Options, ResolveLayers, SessionOptions, OptionValues } from "./types.ts"

/**
 * Declare a catalog of options. The returned object is the only API:
 * `resolve` layers CLI/env/file/defaults; `createSession` holds the live
 * values and optionally persists keys marked `persist: "file"`.
 * Footer opt-in on a spec is validated here (icon + toggle/cycle strategy).
 */
export const defineOptions = <const C extends Catalog>(specs: C): Options<C> => {
	validateFooterSpecs(specs)
	return {
		specs,
		defaults: catalogDefaults(specs),
		resolve: (layers?: ResolveLayers<C>) => resolveOptions(specs, layers),
		createSession: (values: OptionValues<C>, options?: SessionOptions<C>) =>
			createSession(specs, values, options),
	}
}
