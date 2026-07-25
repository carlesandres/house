/**
 * Neutral GitHub-ish CSS for the serve action.
 *
 * Embedded inline by render.ts so each served page is self-contained — no
 * second request, "Save Page As" gives a working file, future --export
 * reuses the same renderer.
 */
export const css = `
:root {
	color-scheme: light dark;
	--bg: #ffffff;
	--fg: #1f2328;
	--muted: #59636e;
	--border: #d1d9e0;
	--code-bg: #f6f8fa;
	--accent: #0969da;
	--blockquote: #59636e;
	--blockquote-border: #d1d9e0;
}
@media (prefers-color-scheme: dark) {
	:root {
		--bg: #0d1117;
		--fg: #e6edf3;
		--muted: #9198a1;
		--border: #30363d;
		--code-bg: #151b23;
		--accent: #4493f8;
		--blockquote: #9198a1;
		--blockquote-border: #30363d;
	}
}
* { box-sizing: border-box; }
html, body {
	margin: 0;
	padding: 0;
	background: var(--bg);
	color: var(--fg);
}
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
		Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
	font-size: 16px;
	line-height: 1.6;
}
main {
	max-width: 860px;
	margin: 0 auto;
	padding: 2.5rem 1.5rem 6rem;
}
h1, h2, h3, h4, h5, h6 {
	margin-top: 1.75em;
	margin-bottom: 0.6em;
	font-weight: 600;
	line-height: 1.25;
}
h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: .9em; }
h6 { font-size: .85em; color: var(--muted); }
p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
ul, ol { padding-left: 2em; }
li + li { margin-top: .25em; }
blockquote {
	margin: 0 0 1em;
	padding: 0 1em;
	color: var(--blockquote);
	border-left: .25em solid var(--blockquote-border);
}
code {
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
		"Liberation Mono", monospace;
	font-size: 85%;
	padding: .2em .4em;
	background: var(--code-bg);
	border-radius: 6px;
}
pre {
	background: var(--code-bg);
	border: 1px solid var(--border);
	padding: 1em;
	border-radius: 6px;
	overflow: auto;
	font-size: 85%;
	line-height: 1.45;
}
pre code {
	padding: 0;
	background: transparent;
	border-radius: 0;
	font-size: 100%;
}
table {
	border-collapse: collapse;
	display: block;
	overflow: auto;
	width: max-content;
	max-width: 100%;
}
th, td { padding: .4em .8em; border: 1px solid var(--border); }
th { background: var(--code-bg); font-weight: 600; }
hr { height: 1px; border: 0; background: var(--border); margin: 1.5em 0; }
img { max-width: 100%; }
kbd {
	display: inline-block;
	padding: 3px 5px;
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	font-size: 11px;
	line-height: 10px;
	color: var(--fg);
	vertical-align: middle;
	background: var(--code-bg);
	border: 1px solid var(--border);
	border-radius: 6px;
	box-shadow: inset 0 -1px 0 var(--border);
}
`.trim()
