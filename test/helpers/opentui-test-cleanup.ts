import { act } from "react"

const OPENTUI_SINGLETON = Symbol.for("@opentui/core/singleton")

type SingletonBag = Record<string, unknown>

const getSingletonBag = (): SingletonBag | null => {
	const bag = (globalThis as Record<PropertyKey, unknown>)[OPENTUI_SINGLETON]
	return bag && typeof bag === "object" ? (bag as SingletonBag) : null
}

const destroySingletonValue = (value: unknown) => {
	if (!value || typeof value !== "object") return
	const maybeDestroy = (value as { destroy?: () => void }).destroy
	if (typeof maybeDestroy === "function") maybeDestroy.call(value)
}

export const resetOpenTuiSingletons = () => {
	const bag = getSingletonBag()
	if (!bag) return

	for (const key of ["tree-sitter-client", "data-paths-opentui"]) {
		const value = bag[key]
		destroySingletonValue(value)
		delete bag[key]
	}
}

export const destroyTestRenderer = async (setup: { renderer: { destroy: () => void } } | null) => {
	if (setup) {
		await act(async () => {
			setup.renderer.destroy()
			await Promise.resolve()
		})
	}
	resetOpenTuiSingletons()
}
