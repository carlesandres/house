import type { MermaidEnhancement, MermaidTone } from "../markdown-html/browser.ts"

const metadata = (name: string): string | null =>
	document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null

let reloadSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let diagramEnhancement: MermaidEnhancement | null = null

const stopReload = () => {
	reloadSource?.close()
	reloadSource = null
	if (reconnectTimer !== null) clearTimeout(reconnectTimer)
	reconnectTimer = null
}

const startReload = () => {
	stopReload()
	const expectedOrigin = metadata("house-preview-origin")
	if (
		expectedOrigin === null ||
		expectedOrigin !== location.origin ||
		!/^https?:$/.test(location.protocol)
	) {
		return
	}
	const connect = () => {
		if (document.visibilityState === "hidden") return
		const events = new EventSource(new URL("/__reload", expectedOrigin))
		reloadSource = events
		events.addEventListener("reload", () => location.reload())
		events.onerror = () => {
			events.close()
			if (reloadSource === events) reloadSource = null
			reconnectTimer = setTimeout(connect, 500)
		}
	}
	connect()
}

const startDiagrams = async () => {
	const root = document.querySelector<HTMLElement>(".markdown-html")
	const asset = metadata("house-mermaid-asset")
	if (
		root === null ||
		asset === null ||
		root.querySelector('[data-markdown-html-mermaid="true"][data-mermaid-eligible="true"]') === null
	) {
		return
	}
	try {
		const module = (await import(asset)) as typeof import("../markdown-html/browser.ts")
		const tone: MermaidTone = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
		diagramEnhancement = module.enhanceMermaid(root, { tone })
		await diagramEnhancement.done
	} catch {
		const reload = document.createElement("button")
		reload.type = "button"
		reload.className = "markdown-html-diagram-error"
		reload.textContent = "Reload preview to try rendering diagrams again"
		reload.addEventListener("click", () => location.reload())
		root.append(reload)
	}
}

const teardown = () => {
	stopReload()
	diagramEnhancement?.cleanup()
	diagramEnhancement = null
}

addEventListener("pagehide", teardown)
addEventListener("pageshow", () => {
	startReload()
	void startDiagrams()
})
