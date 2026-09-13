import mermaid from "mermaid"

export type MermaidTone = "light" | "dark"

export interface MermaidEnhancement {
	readonly done: Promise<void>
	cleanup(): void
}

const afterPaint = (): Promise<void> =>
	new Promise((resolve) => {
		let settled = false
		const finish = () => {
			if (settled) return
			settled = true
			resolve()
		}
		requestAnimationFrame(finish)
		setTimeout(finish, 50)
	})

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const selectionTouches = (element: Element): boolean => {
	const selection = globalThis.getSelection()
	if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false
	try {
		return selection.getRangeAt(0).intersectsNode(element)
	} catch {
		return false
	}
}

export const enhanceMermaid = (
	root: HTMLElement,
	options: { readonly tone: MermaidTone },
): MermaidEnhancement => {
	let active = true
	root.setAttribute("data-markdown-html-mermaid-state", "enhancing")
	const interacted = new WeakSet<HTMLDetailsElement>()
	const markInteraction = (event: Event) => {
		const details = (event.target as Element | null)?.closest<HTMLDetailsElement>(
			".markdown-html-mermaid-source",
		)
		if (details !== undefined && details !== null && root.contains(details)) interacted.add(details)
	}
	for (const event of ["click", "keydown", "pointerdown", "toggle"]) {
		root.addEventListener(event, markInteraction, true)
	}

	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: options.tone === "dark" ? "dark" : "default",
		htmlLabels: false,
		maxTextSize: 50_000,
		maxEdges: 500,
		secure: ["securityLevel", "startOnLoad", "htmlLabels", "maxTextSize", "maxEdges"],
	})

	const done = (async () => {
		await afterPaint()
		const blocks = root.querySelectorAll<HTMLElement>(
			'[data-markdown-html-mermaid="true"][data-mermaid-eligible="true"]',
		)
		for (const block of blocks) block.setAttribute("data-mermaid-state", "pending")
		let sequence = 0
		for (const block of blocks) {
			if (!active) return
			const sourceDetails = block.querySelector<HTMLDetailsElement>(".markdown-html-mermaid-source")
			const source = sourceDetails?.querySelector("code")?.textContent
			const diagram = block.querySelector<HTMLElement>(".markdown-html-mermaid-diagram")
			if (sourceDetails === null || source === undefined || diagram === null) continue
			diagram.style.setProperty("--diagram-bg", options.tone === "dark" ? "#0d1117" : "#ffffff")

			try {
				block.setAttribute("data-mermaid-state", "rendering")
				const id = `markdown-html-mermaid-${crypto.randomUUID()}-${sequence++}`
				const rendered = await mermaid.render(id, source, diagram)
				if (!active || !root.contains(block)) return
				diagram.innerHTML = rendered.svg
				rendered.bindFunctions?.(diagram)
				const svg = diagram.querySelector("svg")
				svg?.setAttribute("role", "img")
				svg?.setAttribute("aria-label", "Mermaid diagram")
				const focusStayed = sourceDetails.contains(document.activeElement)
				if (!interacted.has(sourceDetails) && !focusStayed && !selectionTouches(sourceDetails)) {
					sourceDetails.open = false
				}
				block.setAttribute("data-mermaid-state", "rendered")
			} catch {
				if (!active || !root.contains(block)) return
				diagram.replaceChildren()
				const error = document.createElement("p")
				error.className = "markdown-html-diagram-error"
				error.textContent = "Could not render this diagram. The source is still available."
				block.append(error)
				block.setAttribute("data-mermaid-state", "error")
			}
			await yieldToBrowser()
		}
	})().finally(() => {
		if (active) root.setAttribute("data-markdown-html-mermaid-state", "complete")
	})

	return {
		done,
		cleanup() {
			if (!active) return
			active = false
			root.removeAttribute("data-markdown-html-mermaid-state")
			for (const event of ["click", "keydown", "pointerdown", "toggle"]) {
				root.removeEventListener(event, markInteraction, true)
			}
		},
	}
}
