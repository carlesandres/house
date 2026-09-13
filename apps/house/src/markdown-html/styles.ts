export const markdownHtmlCss = `
.markdown-html {
	min-width: 0;
	--markdown-html-code-bg: var(--code-bg, #f6f8fa);
	--markdown-html-muted: var(--muted, #59636e);
	--markdown-html-border: var(--border, #d1d9e0);
	--markdown-html-bg: var(--bg, #ffffff);
}
.markdown-html .shiki {
	background: var(--markdown-html-code-bg) !important;
}
@media (prefers-color-scheme: dark) {
	.markdown-html {
		--markdown-html-code-bg: var(--code-bg, #151b23);
		--markdown-html-muted: var(--muted, #9198a1);
		--markdown-html-border: var(--border, #30363d);
		--markdown-html-bg: var(--bg, #0d1117);
	}
	.markdown-html .shiki span {
		color: var(--shiki-dark) !important;
		font-style: var(--shiki-dark-font-style) !important;
		font-weight: var(--shiki-dark-font-weight) !important;
		text-decoration: var(--shiki-dark-text-decoration) !important;
	}
}
.markdown-html .markdown-html-note,
.markdown-html .markdown-html-diagram-error {
	color: var(--markdown-html-muted);
	font-size: .875rem;
}
.markdown-html .markdown-html-mermaid-source {
	margin: 0 0 1rem;
}
.markdown-html .markdown-html-mermaid-source > summary {
	cursor: pointer;
	color: var(--markdown-html-muted);
}
.markdown-html .markdown-html-mermaid-diagram {
	overflow: auto;
	padding: 1rem;
	border: 1px solid var(--markdown-html-border);
	border-radius: 6px;
	background: var(--diagram-bg, var(--markdown-html-bg));
}
.markdown-html .markdown-html-mermaid-diagram:empty {
	display: none;
}
.markdown-html .markdown-html-mermaid-diagram svg {
	display: block;
	max-width: 100%;
	height: auto;
	margin: 0 auto;
}
`.trim()
