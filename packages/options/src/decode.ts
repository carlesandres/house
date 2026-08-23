import type { OptionSpec, ResolveError, ResolveLayer } from "./types.ts"

export const isPresent = (value: unknown): boolean => value !== undefined && value !== null

const stringifyReceived = (value: unknown): string => {
	if (typeof value === "string") return JSON.stringify(value)
	if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value)
	if (value === null) return "null"
	return typeof value
}

export const formatResolveError = (error: ResolveError, filePath?: string): string => {
	if (error.layer === "file") {
		const where = filePath === undefined ? "" : ` in ${filePath}`
		return `invalid value for ${error.key}${where}: ${error.message}`
	}
	return `${error.key}: ${error.message}, got ${stringifyReceived(error.received)}`
}

const fail = (
	key: string,
	layer: ResolveLayer,
	message: string,
	received: unknown,
): ResolveError => ({
	key,
	layer,
	message,
	received,
})

const booleanMessage = "expected true or false"

const numberMessage = (spec: Extract<OptionSpec, { type: "number" }>): string => {
	if (spec.integer === true && spec.min === 1 && spec.max === undefined) {
		return "expected a positive integer"
	}
	if (spec.integer === true) return "expected an integer"
	return "expected a number"
}

const inRange = (value: number, spec: Extract<OptionSpec, { type: "number" }>): boolean => {
	if (spec.min !== undefined && value < spec.min) return false
	if (spec.max !== undefined && value > spec.max) return false
	if (spec.integer === true && !Number.isSafeInteger(value)) return false
	if (!Number.isFinite(value)) return false
	return true
}

const decodeBoolean = (
	key: string,
	layer: ResolveLayer,
	value: unknown,
): { ok: true; value: boolean } | { ok: false; error: ResolveError } => {
	if (layer === "env") {
		if (value === "true") return { ok: true, value: true }
		if (value === "false") return { ok: true, value: false }
		return { ok: false, error: fail(key, layer, booleanMessage, value) }
	}
	if (typeof value === "boolean") return { ok: true, value }
	return { ok: false, error: fail(key, layer, booleanMessage, value) }
}

const decodeNumber = (
	key: string,
	layer: ResolveLayer,
	value: unknown,
	spec: Extract<OptionSpec, { type: "number" }>,
): { ok: true; value: number } | { ok: false; error: ResolveError } => {
	const message = numberMessage(spec)
	if (layer === "env") {
		if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value)) {
			return { ok: false, error: fail(key, layer, message, value) }
		}
		if (spec.integer === true && !/^-?\d+$/.test(value)) {
			return { ok: false, error: fail(key, layer, message, value) }
		}
		const parsed = spec.integer === true ? Number.parseInt(value, 10) : Number.parseFloat(value)
		if (!inRange(parsed, spec)) return { ok: false, error: fail(key, layer, message, value) }
		return { ok: true, value: parsed }
	}
	if (typeof value !== "number" || !inRange(value, spec)) {
		return { ok: false, error: fail(key, layer, message, value) }
	}
	return { ok: true, value }
}

const decodeString = (
	key: string,
	layer: ResolveLayer,
	value: unknown,
	spec: Extract<OptionSpec, { type: "string" }>,
): { ok: true; value: string } | { ok: false; error: ResolveError } => {
	if (typeof value !== "string") {
		const message =
			spec.choices === undefined
				? "expected a string"
				: `expected one of ${spec.choices.join(", ")}`
		return { ok: false, error: fail(key, layer, message, value) }
	}
	if (spec.choices !== undefined && !spec.choices.includes(value)) {
		return {
			ok: false,
			error: fail(key, layer, `expected one of ${spec.choices.join(", ")}`, value),
		}
	}
	return { ok: true, value }
}

export const decodeValue = (
	key: string,
	spec: OptionSpec,
	layer: ResolveLayer,
	value: unknown,
): { ok: true; value: boolean | number | string } | { ok: false; error: ResolveError } => {
	if (spec.type === "boolean") return decodeBoolean(key, layer, value)
	if (spec.type === "number") return decodeNumber(key, layer, value, spec)
	return decodeString(key, layer, value, spec)
}
