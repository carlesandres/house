import { decodeValue } from "./decode.ts"
import type {
	Catalog,
	OptionKey,
	OptionValues,
	PersistPolicy,
	Session,
	SessionOptions,
} from "./types.ts"

const persistPolicy = (persist: PersistPolicy | undefined): PersistPolicy => persist ?? "session"

export const createSession = <C extends Catalog>(
	specs: C,
	values: OptionValues<C>,
	options: SessionOptions<C> = {},
): Session<C> => {
	let snapshot: OptionValues<C> = values
	const listeners = new Set<(next: OptionValues<C>) => void>()

	const get = <K extends OptionKey<C>>(key: K): OptionValues<C>[K] => snapshot[key]

	const set = async <K extends OptionKey<C>>(key: K, value: OptionValues<C>[K]): Promise<void> => {
		const spec = specs[key]
		if (spec === undefined) {
			throw new Error(`unknown option ${JSON.stringify(key)}`)
		}
		const decoded = decodeValue(key, spec, "cli", value)
		if (!decoded.ok) {
			throw new Error(`${decoded.error.key}: ${decoded.error.message}`)
		}
		if (Object.is(snapshot[key], decoded.value)) return
		snapshot = { ...snapshot, [key]: decoded.value }
		for (const listener of listeners) listener(snapshot)
		if (persistPolicy(spec.persist) === "file" && options.persist !== undefined) {
			await options.persist({
				key,
				value: decoded.value as OptionValues<C>[K],
				values: snapshot,
			})
		}
	}

	return {
		get,
		set,
		subscribe: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		get values() {
			return snapshot
		},
	}
}
