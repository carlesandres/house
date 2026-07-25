/**
 * renderHtml — wraps marked-rendered markdown in a self-contained HTML page.
 *
 * Embeds the CSS and a tiny SSE reload script so each response is one round
 * trip. The reload script reconnects on drop; the server's `/__reload`
 * endpoint pushes a `reload` event whenever the served file changes.
 */

import { marked } from "marked"
import { css } from "./css.ts"

const escapeHtml = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => {
		switch (c) {
			case "&":
				return "&amp;"
			case "<":
				return "&lt;"
			case ">":
				return "&gt;"
			case '"':
				return "&quot;"
			default:
				return "&#39;"
		}
	})

const reloadScript = `
<script>
(function () {
	function connect() {
		var es = new EventSource("/__reload");
		es.addEventListener("reload", function () { location.reload(); });
		es.onerror = function () { es.close(); setTimeout(connect, 500); };
	}
	connect();
})();
</script>
`.trim()

export const renderHtml = (markdown: string, title: string): string => {
	const body = marked.parse(markdown, { async: false }) as string
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<main>${body}</main>
${reloadScript}
</body>
</html>`
}
