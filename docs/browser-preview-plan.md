---
status: implemented-technical-plan
---

# Browser preview MVP: highlighted code, Mermaid, and contents

Revised and implemented 2026-09-13 after owner feedback: **local preview first; ship an MVP, then
iterate**. Decision 1 is resolved. This document records the implemented MVP boundary and its
deferred follow-ups.

## Outcome and release boundary

Use the existing `O`, **Open in browser** palette command, or `house --serve <path>` to read a
Markdown file with:

1. Code syntax highlighting already present in the HTML.
2. A simple native, collapsible contents list above the document.
3. Mermaid diagrams rendered by local browser JavaScript, with source retained as fallback.

Text, highlighted code, and contents must work without browser JavaScript. Built-in assets work
without internet access while house runs. Existing system light/dark CSS and live reload remain.

The first release excludes copy buttons, active-section tracking, a sticky contents sidebar,
manual theme controls, preference persistence, viewport-based diagram scheduling, custom print
behavior and portable HTML export. These are possible later iterations, not unfinished MVP work.
No new public command, flag, configuration key, TUI key binding, or source-file mutation is needed.

Markdown-to-HTML rendering **must be extractable into a shareable library**. Implement an app-local,
self-contained rendering module with an explicit API now; package creation and publication remain
future work. House's preview server consumes that module rather than owning the conversion logic.

**Browser preview** means the web page for one file, distinct from the capitalized **Browser** TUI
and its **Reader**. **Preview target** is the explicitly served file; selection movement alone does
not change it. **Document contents** navigates headings within that file, not File Navigator entries.

## Feedback disposition

| Owner feedback                                                | Disposition                                   | Result                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Local preview first                                           | Accepted; Decision 1 settled                  | Portable export is outside this release. Do not ask this question again.                                                 |
| Iterate and improve; MVP approach                             | Accepted                                      | Retain the three reading capabilities; defer optional controls and advanced lifecycle/performance behavior.              |
| Rendering must be extractable into a future shareable library | Accepted; Decision 33 is an owner requirement | Separate the reusable conversion API and its dependencies from House preview integration without creating a package now. |

Decision numbers 1–32 retain their original topics for review. Deferred rows explain the new
boundary rather than specifying features to build now. Acceptance IDs A1–A24 are also preserved.
Decision 33 and acceptance scenario A25 append the extractability requirement without renumbering.

## Baseline and constraints at implementation start

- `apps/house/src/serve/render.ts` uses synchronous Marked, inline CSS and an inline reload script.
  Only the title is explicitly escaped; there is no highlighting, TOC, heading ID or sanitization.
- `src/serve/css.ts` already provides system light/dark styling and an 860px article. Preserve that
  reading layout instead of introducing a second column.
- `src/serve/server.ts` exposes `/` and `/__reload` on loopback. It supports retargeting, a 30ms
  watcher debounce, atomic-save rewatching and SSE without Bun's idle timeout. Unknown paths 404.
  It reads on each request: its last-good-read comment is inaccurate; read failure returns 500.
  Timer ownership needs tightening when adding asynchronous rendering.
- `src/Browser.tsx`, `src/index.tsx` and `src/prompts/helpers.ts` own opening/retargeting and Rename
  integration. Preserve the synchronous `ServerHandle` interface and explicit target semantics.
- `test/serve.test.ts` covers rendered output, title escaping, target switching, atomic saves,
  loopback, unknown paths and a 12-second idle SSE regression. OpenTUI tests do not exercise HTML DOM.
- `dev/build-cli.ts` and `dev/build-standalone.ts` build distinct outputs. Standalone already embeds
  its tree-sitter worker through a Bun plugin. Browser assets must also survive native packaging.
- `dev/build-npm-main.ts` stages the shim/bundled source; platform packages contain the executable.
  An installed preview cannot depend on checkout files, browser-side CDN assets or Bun on PATH.
- `apps/house/tsconfig.json` is for ES2022 server/TUI code, without browser DOM libraries. Give the
  small browser client its own typecheck boundary.
- DESIGN.md §§3, 7.3–7.5, 10, 12 and ADR 0001 favor the existing Marked preview and independent TUI
  renderer. Rich-preview requirements trigger reconsideration of ADR 0001, not an automatic rewrite.
- ROADMAP.md tracks relative user assets separately in #75 and TUI heading navigation in #30.
  Adding built-in JavaScript routes does not implement either feature. Issue #18's portable-output
  investigation does not override the owner's local-preview-first decision.
- At inspection, CI uses Bun 1.3.10; root packageManager is Bun 1.4.2; npm smokes use Node 26.4.0/26.
  Validate the repository's actual versions and native matrix without an unrelated runtime upgrade.

Existing plans live directly in `docs/`. This plan was the only working-tree change when the MVP
implementation began; the implementation and documentation changes are recorded below.

## Decision tree

Decisions 1 and 33 record owner requirements. Other rows specify the revised MVP proposal.

|   # | Question                                        | Recommended decision                                                                                                                                                                                                                                                                       | Rejected branches and reason                                                                                                                                                         |
| --: | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | Is portable export included?                    | **Owner-confirmed:** local preview first, offline for built-in assets while house runs. Export is deferred.                                                                                                                                                                                | Portable HTML/SVG/PDF introduces a separate delivery and asset policy.                                                                                                               |
|   2 | Where are features available?                   | Both existing browser entry points, on by default; contents only when useful, diagrams only when present.                                                                                                                                                                                  | Additional flags/commands add discoverability work without a new workflow.                                                                                                           |
|   3 | Which Markdown pipeline?                        | Keep Marked with per-render heading/code state.                                                                                                                                                                                                                                            | React/Streamdown, unified migration and Bun.markdown replace a working parser without an MVP need.                                                                                   |
|   4 | What happens to raw HTML?                       | Sanitize a safe reading subset; keep common details/kbd/table formatting, strip active content and forged app markers.                                                                                                                                                                     | Unsanitized rendering is an existing execution gap; escaping all HTML needlessly loses common README formatting.                                                                     |
|   5 | What URLs/files can content use?                | Safe fragment/relative/http(s)/mailto links and http(s)/relative images. No file-serving fallback or remote renderer.                                                                                                                                                                      | Relative user-asset serving is #75; backend fetching expands scope. Authored remote images, including diagram images, may need internet.                                             |
|   6 | How is code highlighted?                        | Shiki in Bun, JS regexp engine, static GitHub light/dark colors, lazy reusable initialization.                                                                                                                                                                                             | Browser highlighting weakens baseline reading; highlight.js is viable but not necessary to switch to; another WASM engine complicates packaging.                                     |
|   7 | Which languages?                                | Fixed common-language catalog below; unknown/unlabelled blocks remain plain text.                                                                                                                                                                                                          | All-language bundles and runtime grammar downloads add cost; custom grammars and automatic guessing are deferred.                                                                    |
|   8 | How much highlighting work?                     | Per fence: 100,000 UTF-16 units/2,000 lines; admitted total: 1,000,000 units per document. Skip highlighting, never source.                                                                                                                                                                | Truncation loses content; unlimited enhancement work can delay reading. Limits are internal, not new Options.                                                                        |
|   9 | Which headings enter contents?                  | Markdown h1–h6 tokens in order, actual ancestor nesting; show contents at two or more entries.                                                                                                                                                                                             | h2/h3-only hides valid structure; raw HTML headings stay outside the generated outline.                                                                                              |
|  10 | What fragment IDs?                              | GitHub-style unprefixed slugs, per-document deduplication; empty slug becomes section.                                                                                                                                                                                                     | Prefixing breaks #usage links; global state mixes concurrent documents. Strip authored IDs/names; use explicit DOM queries and Maps.                                                 |
|  11 | What responsive contents?                       | One native collapsed details/summary above the article, at every width.                                                                                                                                                                                                                    | Sticky desktop rail, duplicated navigation and custom mobile drawer are later enhancements.                                                                                          |
|  12 | Active-section tracking?                        | **Deferred.** Native anchor links only.                                                                                                                                                                                                                                                    | Scroll observers, active-state rules and geometry repair are unnecessary for the MVP.                                                                                                |
|  13 | Where does Mermaid render?                      | Full pinned Mermaid in the browser, locally bundled, strict mode; escaped source remains available.                                                                                                                                                                                        | Remote services expose source; headless SVG generation changes installation; alternate/tiny renderers narrow diagram support.                                                        |
|  14 | When do diagrams render?                        | After baseline paint, import only on pages containing eligible diagrams; render sequentially in document order.                                                                                                                                                                            | Viewport scheduling/observers are deferred until long-document use demonstrates a need; parallel rendering increases contention.                                                     |
|  15 | Diagram limits?                                 | 50,000 UTF-16 units per diagram, Mermaid's 500-edge limit where supported, one render at a time.                                                                                                                                                                                           | Whole-page failure or source truncation is disproportionate; these limits do not claim CPU preemption.                                                                               |
|  16 | Diagram failure/retry?                          | Keep source expanded until success; show local safe errors. A failed module load offers native Reload preview.                                                                                                                                                                             | Early source hiding creates blank content; bespoke retry machinery and raw upstream HTML errors are unnecessary.                                                                     |
|  17 | Appearance controls?                            | **Deferred.** Keep system CSS. Render diagrams once using initial system tone and a matching fixed panel background.                                                                                                                                                                       | Manual theme controls/live diagram rerender create extra UI and async states. Reload applies a new diagram tone.                                                                     |
|  18 | Preference persistence?                         | **Deferred.** No preview storage or config writes.                                                                                                                                                                                                                                         | There is no MVP preference to persist.                                                                                                                                               |
|  19 | Copy buttons?                                   | **Deferred.** Native selection and copying remain.                                                                                                                                                                                                                                         | Clipboard permissions, feedback and source-copy state are optional convenience work.                                                                                                 |
|  20 | Print/Save Page As?                             | No new guarantee or dedicated behavior in the MVP; ordinary browser functionality remains available.                                                                                                                                                                                       | Print-specific source duplication and self-contained enhanced output belong to later use cases.                                                                                      |
|  21 | Browser asset delivery?                         | Shared Bun browser-build helper, embedded production asset map, lazy in-memory source provider.                                                                                                                                                                                            | CDN/runtime filesystem lookup breaks offline/native operation; committed generated bundles or required presteps complicate development.                                              |
|  22 | Routes?                                         | Exact immutable built-in asset paths under /__house/assets/; retain /, /__reload and unknown-path 404.                                                                                                                                                                                     | General static-file serving would inadvertently implement #75.                                                                                                                       |
|  23 | Page/network protection?                        | Sanitization, CSP, nosniff, no-referrer, loopback Host validation and same-origin Origin when present.                                                                                                                                                                                     | Permissive script/eval exceptions or CORS grants are not required by this feature.                                                                                                   |
|  24 | Concurrent target changes?                      | Snapshot path/revision for success and error; retry once if superseded, then safe 503. Preserve current SSE protocol.                                                                                                                                                                      | Mixed title/body is incorrect; new ready handshake, guaranteed missed-event recovery and scroll reset are deferred.                                                                  |
|  25 | Watcher/reload ownership?                       | Clear owned debounce timers and guard old callbacks on retarget/stop; preserve current rewatching.                                                                                                                                                                                         | Missing-file polling/automatic recreation recovery expands the watcher state machine and is deferred.                                                                                |
|  26 | Caching?                                        | Reuse lazy highlighter/assets only; failed init may retry next request.                                                                                                                                                                                                                    | Document/SVG caches need invalidation and memory policy without measured benefit.                                                                                                    |
|  27 | Failure surfaces?                               | Safe read/render errors; enhancement failures retain static reading and source. No telemetry or source/path disclosure in errors.                                                                                                                                                          | One broken diagram must not lose the document; unsanitized fallback is prohibited.                                                                                                   |
|  28 | Accessibility/browser coverage?                 | Native keyboard/disclosure/link behavior, readable overflow and diagram labels/source. Real Chromium checks plus desktop/mobile visual review.                                                                                                                                             | Custom keymaps/polyfills and a new mandatory three-browser CI matrix exceed the MVP; no claim of exhaustive browser support.                                                         |
|  29 | Architecture boundaries?                        | An app-local reusable rendering module, separate House preview adapters and browser TS boundary; no TUI/File Navigator changes.                                                                                                                                                            | A new package/publication step or React state layer is unnecessary for the MVP; application coupling would violate Decision 33.                                                      |
|  30 | Dependencies?                                   | Pin stable tested Shiki, Mermaid, sanitizer and slugger versions; browser build/test inputs stay dev-only when absent from runtime imports.                                                                                                                                                | Floating/runtime dependency fetches make binaries irreproducible.                                                                                                                    |
|  31 | Completion evidence?                            | Focused Bun rendering/HTTP tests, a small durable browser smoke and actual native/installed asset verification. Preserve existing CI/platform gates.                                                                                                                                       | HTML snapshots alone cannot prove SVG/CSP/layout; a broad new testing platform is not needed.                                                                                        |
|  32 | Delivery strategy?                              | Three independently reviewable vertical slices: highlighted reading, contents, diagrams. Then use the MVP before choosing another enhancement.                                                                                                                                             | Requiring every future enhancement before shipping conflicts with the owner's MVP direction.                                                                                         |
|  33 | Must Markdown-to-HTML rendering be extractable? | **Owner-required:** expose a typed, independently usable rendering API with a self-contained dependency boundary. House owns file IO, full-page shell, serving, live reload and asset delivery. Future extraction moves the module and its tests, without redesigning conversion behavior. | Keeping conversion inside server/page orchestration makes reuse expensive. Publishing a package, designing arbitrary plugin hooks or creating a second consumer now exceeds the MVP. |

## Detailed MVP behavior

### Static document and trust boundary — Decisions 3–10, 27

The reusable renderer accepts Markdown text and returns a rendered fragment plus structured metadata
(Decision 33). House's `renderHtml` becomes an async adapter composing that result into a preview
page; keep the existing server handle synchronous. Use one isolated Marked
context, heading slugger and output map per render. Never use a module-global heading collector.
Retain current GFM behavior; do not add MDX, math, frontmatter interpretation or a new Markdown dialect.

Generate heading/code fragments through bounded adapters. Separate trusted generated HTML from
untrusted document HTML: use per-render unguessable slot IDs registered in a Map, sanitize the
complete untrusted result, then replace only exact registered slots with safe generated fragments.
Use HTML-aware substitution, not broad replacement against authored text. Strip forged/duplicate
markers; never restore a slot removed with an unsafe surrounding element. Heading inline content
gets its own inline sanitation; fence content is escaped or passed through Shiki, never raw HTML.
Do not interpolate source into executable scripts or JSON script blocks. This is a small trust
boundary, not a general templating/plugin system.

Use the maintained `sanitize-html` package with an explicit schema and current security fixes;
research in the original plan identified 2.17.6 as a minimum fixed release, but recheck when pinning.
Permit common reading elements: paragraphs, headings, lists, emphasis, blockquotes, links, images,
pre/code, tables, details/summary, kbd, sub/sup and neutral div/span wrappers. Preserve list starts,
table spans/alignment, image alt/title/dimensions and details open state. GFM task checkboxes must
always be disabled and of type checkbox. Remove author styles, IDs/names, classes, data attributes,
events, autofocus, tabindex and application ARIA markers. Drop scripts/styles/frames/forms/base/meta,
objects/embeds and authored SVG/MathML with their active payloads. Generated SVG comes only from
Mermaid's strict renderer. Do not weaken the schema to accommodate a failing test.

Validate decoded URL attributes: links permit http/https/mailto, fragments and relative paths;
images permit http/https and relative paths. Reject javascript/vbscript/file/data/blob and protocol-
relative URLs. External author images may load directly in the browser; house does not proxy them.
Mermaid image syntax, where supported, has the same allowance. Offline promises concern bundled
functionality, not remote content authored into the file. Relative local images/links still 404.

Shiki uses its JavaScript regexp engine and explicit imports for GitHub light/dark themes and:
JavaScript, TypeScript, JSX, TSX, JSON, JSONC, Bash, Python, CSS, HTML, Markdown, YAML, TOML, SQL,
Rust, Go, Java, C, C++, C#, diff and Dockerfile. Normalize the first fence info token and common
aliases (`js`, `ts`, `sh`, `shell`, `py`, `yml`, `rs`, `golang`, `c++`, `csharp`, `cs`, `md`). Verify
exact grammar IDs/aliases against the pinned release. Empty/text/txt/plaintext are plain text.
Case-insensitive `mermaid` goes only to the diagram path. Other metadata is not configuration.

Initialize lazily for eligible code, reuse the instance, and keep code readable on unknown language,
grammar failure or limit overflow. Apply Decision 8 limits before highlighting, counting only admitted
blocks in source order. Skipped blocks remain complete, with a small highlighting-unavailable/limit
note where appropriate; unknown languages need no warning. Do not initialize Shiki during normal
TUI/version/help execution. Use complete Shiki pre/code output without nesting it in a second pre.

House still reads the entire chosen file and passes its text to the renderer for parsing.
Enhancement limits do not provide hard CPU/memory
isolation or a giant-file paging feature. No new benchmark infrastructure or latency SLA is required.

### Contents — Decisions 9–12, 28

Assign IDs to every Markdown heading even if contents is omitted. Use per-render `github-slugger`,
including duplicate handling; empty/punctuation-only slug uses section with normal deduplication.
Keep Unicode and existing #usage links. Use Maps and explicit scoped DOM APIs, not window properties
named after headings. Shell IDs use a separate opaque namespace. Test clobber-like heading names.

Generate navigation labels from visible decoded inline text, including inline code and image alt;
escape labels and never nest author links inside navigation links. An empty label becomes Untitled
section in contents without rewriting document text. Actual heading ancestors determine nesting;
a jump from h2 to h5 nests one step without fake headings. Multiple h1 headings remain peers. Raw
HTML headings render sanitized but do not enter the outline. Headings inside code fences are excluded.

At two or more entries, render one native collapsed details above the article with summary Contents
and a labelled nav. Same markup at desktop/mobile; no sidebar, scroll tracker or JS needed. With zero
or one heading omit contents entirely. An empty document has the existing empty article, no placeholder
spinner/TOC/diagram controls. Preserve the article's existing reading width and native anchor/history
behavior. At 320px and 200% zoom, overflow stays inside code/table/diagram containers, not the page.

### Mermaid — Decisions 13–17, 27–28

Each Mermaid fence renders an escaped pre/code inside native source details, initially open, with
an empty diagram container. No-JS users see complete source. Keep source even after successful SVG;
collapse it only after success, unless the reader toggled the disclosure, focused it or selected text
while rendering. Do not hide source based merely on a CSS class indicating JavaScript is available.

After baseline paint, import the locally bundled full Mermaid package only if at least one diagram
is within the source-size limit. Render eligible diagrams sequentially in document order. Yield to
browser painting between blocks. There is no viewport observer, offscreen scheduling, output cache,
manual render queue control or theme-driven rerender in the MVP.

Use `startOnLoad:false`, `securityLevel:strict`, `htmlLabels:false`, initial system tone, a local
system font, `maxTextSize:50000`, `maxEdges:500`, and suppressed upstream error artwork. Lock security,
resource, font/theme and startup keys through Mermaid's secure configuration mechanism; author
frontmatter/directives cannot relax them. Do not register remote icon packs or runtime plugins.
Author http(s) diagram images may load under the same policy as other document images; strict mode
is not a promise that images cannot make network requests. Never upload source to a renderer.

Give the diagram panel an explicit background matching the tone captured at page initialization.
If system appearance changes later, article/code CSS follows the system; existing diagrams retain
their contrasting original panel. Reload picks the new diagram tone. No preference control/storage.

Render into an app-owned staging container and mount only successful library SVG. Clean staging
nodes on success/failure and ignore completions after page teardown. Invalid/limited diagrams keep
source open with a concise local message; other diagrams continue. Module-load failure leaves all
sources available and offers a normal Reload preview link. No automatic import retry/watchdog is
required: a pending import must not hide source or block the independent reload client. Size/edge
limits and sequential work cannot interrupt a synchronous pathological browser layout; do not claim
otherwise.

Keep Mermaid accessibility title/description when supplied; otherwise label the figure Mermaid
diagram N and retain source access. Source is an alternative representation, not an invented natural-
language description. Native browser zoom/overflow remains available; custom pan/zoom is deferred.

### Assets and HTTP — Decisions 21–26, 29–31

Use a shared Bun browser-build helper returning entry URLs and an exact asset map of emitted paths,
bytes, MIME and content hashes. Use one graph hash under `/__house/assets/<graph-hash>/`, preserving
relative output paths so split ESM imports work. All chunks/runtime dependencies are local. No CDN,
source maps containing checkout paths, or bare browser imports. Include dependency license notices.

The source asset provider builds lazily in memory, with no generated checked-in files or mandatory
prestep for `bun test`/direct source runs. Both CLI and standalone build scripts use the same helper
and an onLoad plugin replacing that provider with embedded bytes; the production graph must not
retain a runtime browser-build helper, source lookup or Bun.build invocation. Follow existing Bun
plugin precedent and preserve tree-sitter/native host embedding. Verify Turbo inputs/cache account
for the client/helper/package/lock. If the embedding tracer fails on CI Bun, resolve it before adding
diagram features; do not fall back to a CDN or ship a source-only success.

Serve only exact built-in paths, with correct MIME, GET/HEAD and immutable caching. `/` remains
no-store; `/__reload` remains GET SSE/no-cache with its timeout exemption. Unknown paths return 404;
unsupported methods return 405. Validate Host against the bound localhost/127.0.0.1 port; a present
Origin must match the request origin. Absent Origin is permitted for ordinary navigation. No CORS.

Move executable reload/diagram setup to local nonblocking scripts, with independent initialization
so a failed/hanging Mermaid import cannot stop reload. Inline CSS remains. Apply nosniff, no-referrer
and a tested CSP: default-src none; script-src self; style-src self unsafe-inline; img-src self http:
https:; font-src self; connect-src self; object-src none; base-uri none; form-action none;
frame-ancestors none. Use proper quoted CSP keywords in implementation. Author styles are removed
independently; no script unsafe-inline/eval. Do not promise all outbound requests are blocked.

Capture target path and revision before each read; title/body/error all use that snapshot. If it
changes before completion, retry once; another supersession returns safe 503 with Retry-After:1
and a native Reload link. Apply the check to failed reads/renders too. Safe 500 errors use basename,
not raw OS errors/absolute paths; no retained-last-good-document promise. Parser/sanitizer failure
never falls back to unsanitized HTML. Highlighter/source-dev asset failure preserves safe baseline;
production asset generation failure fails the build.

Keep existing SSE reload events/reconnect semantics. No new ready handshake, explicit reading-position
persistence or retarget hash-reset policy in this release. Missed events during page loading or
reconnection remain best effort: manual browser refresh recovers. Clear old watcher debounce timers
and guard callbacks with a generation on retarget/stop, preserving atomic-save rewatching and the
existing idle-SSE guarantee. Invalidate pending client commits and dispose reload resources on page
teardown; handle persisted pageshow by restarting the existing connection. Automatic missing-file
polling/recreation recovery is deferred; after recreation, refresh the page for content and restart
preview to reestablish watching if necessary. Stopping house leaves an already-loaded page readable.

Reload script execution is limited to the expected serving HTTP origin encoded safely in page
metadata. A saved/rehosted page does not start an accidental reconnect loop. This small guard does
not establish a portable-output feature or a new Save Page As/print compatibility contract.

## Extractable rendering boundary — Decision 33

Place the reusable implementation behind `apps/house/src/markdown-html/index.ts`. Keep its own
modules, default styling and focused tests logically together, with imports pointing inward or to
declared third-party rendering dependencies. No imports back into `serve/`, the TUI, `@house/ui`,
the Option catalog, House theme globals, CLI metadata or build scripts are permitted.

Use a small typed API with this conceptual contract; exact type names can follow implementation
conventions:

```ts
const renderer = createMarkdownRenderer()
const result = await renderer.render(markdownText)
// result: { html, headings, hasMermaid, diagnostics }
```

- `html` is the sanitized, highlighted content fragment, including safe Mermaid source markup.
  It contains no document shell, filename/title, asset URL, serving origin or live-reload script.
- `headings` is a readonly list of plain `{ id, level, text }` values in document order. Consumers can build a TOC
  without reparsing HTML or reproducing slug logic. House owns its native Contents disclosure.
- `hasMermaid` reports the presence of Mermaid source blocks; the separate browser enhancer decides
  whether any are eligible for rendering. No browser library loads as a side effect of core import.
- `diagnostics` contains plain typed per-block warning codes and stable per-render block indices,
  with optional source locations when available, not HTTP
  responses, logging side effects or House-specific notices. Preserve the MVP's safe inline fallback
  messages; diagnostics let a future consumer surface the same conditions in its own interface.
- The renderer instance owns lazy highlighter reuse. Each render call owns document-specific state,
  so concurrent calls cannot share slugs/slots. It starts no servers, timers, filesystem watchers or
  network requests, reads no file/config/environment, and does not access `Bun` or browser DOM APIs.
  Use portable primitives for any internal randomness. Rendering is not required to be synchronous
  or mathematically pure: lazy initialization and safe per-render IDs are allowed.

Expose plain public types, not Marked/Shiki token objects or House types. Creation is synchronous
and lazy; rendering is async. Provide idempotent async disposal for the renderer-owned highlighter:
reject new renders once disposal begins, let already-accepted renders finish, then release resources.
House owns when its renderer instance is disposed; an independent caller has the same lifecycle.

Keep reusable content CSS and the optional Mermaid browser enhancer inside the same module boundary
as separate exports/entry points. Their selectors/markup contract must travel with the renderer;
do not leave necessary styles or diagram-marker knowledge scattered through House. The enhancer
accepts a root element and explicit tone, enhances only that root, and exposes cleanup. It must not
know House URLs, SSE, server lifetime, or global app state. Export portable CSS as text, scoped to a
documented library root class such as `markdown-html`, with library-scoped classes/data attributes.
The consumer applies that root class even when JavaScript is disabled; do not style global body or
House shell elements. Browser DOM APIs belong only in that
entry point. Never eagerly import it or Mermaid's browser runtime from the server rendering entry.

House adapters own reading files, choosing the preview title, page layout/Contents presentation,
system appearance integration, HTTP errors/headers, watcher revisions, SSE, browser launch and
bundling/serving assets. House's bundler may compile the reusable browser entry and embed its output;
the rendering module must not import that build helper or hardcode `/__house/assets/`/`/__reload`.
The adapter explicitly composes portable content CSS with its preview-shell CSS.

Keep Marked, sanitation, the fixed Shiki policy and diagram-source contract inside the module; no
caller injection of unsafe HTML callbacks is required. Do not generalize to arbitrary plugins,
languages, themes or export modes solely to anticipate reuse. Maintain a short module-level API and
dependency-boundary note, including the consumer's duty to style the fragment and explicitly attach
optional enhancements. A future package needs packaging/licensing/version decisions, but not a
rewrite of the rendering API or hidden House behavior. No npm package is created by this MVP.

## Architecture seams

Keep responsibility local; these are likely seams, not an instruction to create every listed file.

| Area                                                          | Likely location                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Public rendering API, per-document state, sanitized fragments | `src/markdown-html/index.ts`; internal document/sanitizer helpers as needed                       |
| Fixed highlighter/catalog                                     | `src/markdown-html/highlight.ts`                                                                  |
| Portable content styles and optional Mermaid client           | Separate styling/browser entry points inside `src/markdown-html/`                                 |
| Full HTML shell, title and Contents presentation              | `src/serve/render.ts` consumes the rendering API                                                  |
| Existing layout and House preview styling                     | `src/serve/css.ts` composes portable content CSS                                                  |
| Asset routes, headers, snapshot/timer ownership               | `src/serve/server.ts`                                                                             |
| Source provider/shared builder/production replacement         | `src/serve/assets.ts`, `build-assets.ts`, `dev/preview-assets-plugin.ts`                          |
| House reload/client adapter                                   | `src/serve/client/` mounts the reusable enhancer; browser TS config covers both client boundaries |
| Static and HTTP regressions                                   | `test/serve.test.ts`, `test/preview-render.test.ts`                                               |
| Focused browser and artifact smoke                            | Small `dev/smoke-preview.ts` plus Markdown fixtures and agent-browser scenario                    |

No React/hydration, generic preview framework, new @house package, database, persistence abstraction,
or changes to OpenTUI markdown rendering, its fail-closed highlighter gate, or File Navigator.
The lack of a new package does not relax the extractability requirement.

## Observable acceptance scenarios

Original IDs retain their subject. Only MVP rows gate this release; deferred rows are intentionally
not tests to implement now.

| ID  | MVP result or disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Evidence                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | O/palette/serve share behavior; explicit retarget and Rename still work; selection alone does not retarget.                                                                                                                                                                                                                                                                                                                                                               | Existing Browser integration + HTTP                                                                                                                   |
| A2  | JS disabled: GFM text/tables/tasks, highlighted code and native contents work; Mermaid source stays visible.                                                                                                                                                                                                                                                                                                                                                              | Render + real browser                                                                                                                                 |
| A3  | Catalog/aliases highlight representative code in both system tones; unknown labels and injected failure retain complete code.                                                                                                                                                                                                                                                                                                                                             | Focused render tests + browser sample                                                                                                                 |
| A4  | Per-fence size/line and cumulative limits work at boundaries without truncation.                                                                                                                                                                                                                                                                                                                                                                                          | Render tests                                                                                                                                          |
| A5  | Duplicate/Unicode/inline/empty/skipped-level headings produce valid matching anchors; code-fence headings excluded; raw HTML headings omitted.                                                                                                                                                                                                                                                                                                                            | Render + browser #usage navigation                                                                                                                    |
| A6  | Empty/one-heading document has no contents; multiple headings have one native collapsible nav at every width.                                                                                                                                                                                                                                                                                                                                                             | Render + browser                                                                                                                                      |
| A7  | Active-section tracking deferred; native links and Back work without changing URL on scrolling.                                                                                                                                                                                                                                                                                                                                                                           | Browser baseline check                                                                                                                                |
| A8  | No eligible diagram means no Mermaid request. Otherwise render sequentially after paint, including diagrams below the fold.                                                                                                                                                                                                                                                                                                                                               | Browser request/state checks                                                                                                                          |
| A9  | Flowchart, sequence and one non-flowchart type (class or ER) render from real bundled Mermaid; source can be reopened.                                                                                                                                                                                                                                                                                                                                                    | Focused real browser smoke; no exhaustive upstream syntax suite                                                                                       |
| A10 | Invalid syntax, oversized source/edges and failed/pending module load preserve source and later content. Valid sibling diagrams continue after a per-diagram error.                                                                                                                                                                                                                                                                                                       | Browser + small failure seam                                                                                                                          |
| A11 | Source interaction during render is preserved; page teardown discards stale results/staging. Theme-retarget rerender scenarios are deferred.                                                                                                                                                                                                                                                                                                                              | Browser interaction + lifecycle seam                                                                                                                  |
| A12 | System article/code CSS works; initial diagram panel remains legible after OS tone change and reload applies new tone. Manual theme/storage tests deferred.                                                                                                                                                                                                                                                                                                               | Browser media emulation + visual check                                                                                                                |
| A13 | Copy-button/clipboard tests deferred; native text selection/copy is unobstructed.                                                                                                                                                                                                                                                                                                                                                                                         | Manual browser check                                                                                                                                  |
| A14 | Active HTML, encoded bad URLs, SVG/MathML parser confusion, forged slots and clobber heading names cannot execute/control shell; safe HTML remains.                                                                                                                                                                                                                                                                                                                       | Render + browser security regression fixtures                                                                                                         |
| A15 | Mermaid author config cannot relax host security/limits/startup; no external runtime/plugin loads. Author http(s) images remain allowed; source/accessibility metadata retained.                                                                                                                                                                                                                                                                                          | Focused browser fixture                                                                                                                               |
| A16 | With non-loopback network blocked, local fixtures fully render. Authored remote images may fail; relative user assets remain 404.                                                                                                                                                                                                                                                                                                                                         | Browser network + HTTP                                                                                                                                |
| A17 | Full emitted asset graph resolves with correct MIME/hash/cache; invalid routes/Host/Origin/method are rejected; no filesystem fallback.                                                                                                                                                                                                                                                                                                                                   | HTTP + artifact smoke                                                                                                                                 |
| A18 | Delayed success/failure for A during retarget to B cannot mix content/title/error; bounded retry or 503; concurrent documents have independent headings.                                                                                                                                                                                                                                                                                                                  | Deterministic HTTP/render seam                                                                                                                        |
| A19 | Existing atomic-save/12-second idle SSE tests pass; stale timer after retarget/stop cannot rewatch old file. Missing-file polling/recreation recovery deferred.                                                                                                                                                                                                                                                                                                           | Existing HTTP/filesystem tests + targeted regression                                                                                                  |
| A20 | Existing save/retarget live reload works, stop leaves readable page. Ready handshake, guaranteed missed-event recovery and precise scroll restoration deferred.                                                                                                                                                                                                                                                                                                           | Browser + HTTP; manual refresh remains recovery                                                                                                       |
| A21 | Specialized print/portable-save tests deferred; no support claim. Saved/rehosted page cannot start an unintended SSE loop.                                                                                                                                                                                                                                                                                                                                                | Small origin-guard test                                                                                                                               |
| A22 | Desktop 1440×900/mobile 390×844, 320px/200% zoom, light/dark: visible focus, usable native disclosures/anchors, no page-wide overflow.                                                                                                                                                                                                                                                                                                                                    | Desktop/mobile visual review                                                                                                                          |
| A23 | Fresh source/test and shipped CLI/native/installed paths serve highlighted HTML and all assets without runtime checkout/Bun/grammar lookup. TUI/version/help do not build browser assets.                                                                                                                                                                                                                                                                                 | Exact artifact and build smoke                                                                                                                        |
| A24 | Read/parser/sanitizer error is safe and manually reloadable; enhancement failure retains reading; production asset-build failure fails build.                                                                                                                                                                                                                                                                                                                             | Focused failure tests                                                                                                                                 |
| A25 | A caller imports only the rendering entry, passes Markdown text, and receives plain typed safe HTML/heading metadata/Mermaid source without booting House, initializing browser modules, or providing files/config/URLs/server state. Concurrent calls are isolated; disposal drains accepted calls, rejects new calls and releases resources. Portable CSS/enhancer work under a caller-owned root with caller-owned asset URLs and cleanup, outside House's page shell. | Direct API tests in Bun, a small Node consumer smoke of the isolated module, and a minimal independent browser fixture mounting the separate enhancer |

## Three test-first delivery slices

Each slice begins with one observable failing test, confirms red, makes the smallest production
change to reach green, and extends coverage only for its behavior. These are independently reviewable
increments of this MVP, not a requirement to implement the deferred backlog before releasing.

### Slice 1: safe highlighted reading

- Begin with A3/A14 in `test/preview-render.test.ts`: representative code is highlighted and active
  authored HTML cannot execute, while common safe formatting survives.
- Establish the reusable API/boundary and A25 first: direct string-in/result-out tests must run
  without importing House's preview entry. Add per-render Marked context/trusted-fragment boundary,
  sanitizer and lazy Shiki catalog/limits inside that module; keep `serve/render.ts` an adapter.
  Adapt render calls to async. Cover fallback, A4/A18/A24 and existing title/read regressions.
- Preserve server/timer consistency introduced by async work; no reload protocol redesign. For CSP,
  add the minimal locally served reload asset and production embedding tracer now. Prove assets work
  from a clean source run and real binary before expanding the graph for Mermaid.
- Check highlighted light/dark/no-JS desktop/mobile reading and native artifact packaging. Update
  existing serve tests to assert semantic output, not exact old heading markup.

### Slice 2: simple document contents

- Begin with A5/A6: repeated headings produce working #usage links and a collapsed native Contents
  disclosure; zero/one-heading cases omit it.
- Add per-document slugger/outline in the reusable module and return heading metadata. House uses
  those final IDs/labels to render one escaped navigation element above the article.
  Keep the existing width/system CSS. No sidebar, active state or scroll observer.
- Verify keyboard/no-JS/Back behavior and desktop/mobile overflow. This slice adds no browser runtime.

### Slice 3: local Mermaid enhancement

- Begin with A9/A10: a real flowchart renders from local assets; malformed sibling source remains
  visible. Add full pinned Mermaid to the browser build graph and sequential after-paint rendering.
- Keep the optional diagram enhancer/required content styles extractable alongside rendering; mount
  it through a thin House adapter. Finish A25's caller-owned root/asset URL and cleanup checks.
- Add strict configuration, size bounds, source disclosure intent, fixed initial-tone panel and
  teardown cleanup. A failed module import must not break independent reload or hide any source.
- Finish A8–A12/A15–A17/A20/A22/A23 through a small durable browser/artifact smoke. Add representative
  sequence/class-or-ER coverage, not a comprehensive test suite for Mermaid itself.
- Document the three shipped capabilities and limitations, run existing gates, then use the MVP
  before selecting the next enhancement. No fourth hardening phase hiding required MVP correctness.

## Verification and documentation

Keep rendering API tests independent of the HTTP harness. As extraction evidence, bundle only the
portable server entry and a tiny consumer into a temporary Node-targeted test artifact, then invoke
it with Node from outside the repo. Exercise real highlighting, headings and Mermaid source using
string input with no House bootstrap/config/files. Check its import graph excludes House adapters,
Bun-only APIs and the browser entry; assert no DOM/Mermaid runtime initialization from core import.
Separately mount the exported CSS/enhancer in a tiny browser fixture without House's page shell,
with caller-owned asset URLs and two roots, proving enhancement is confined to the supplied root.
This narrow check uses the existing Node CI environment; it
does not establish a new published-library/browser-runtime support matrix. No second product or
package is built. A declaration-only boundary check is insufficient to prove independent use.

Use Bun tests for renderer/HTTP behavior and agent-browser first for actual SVG, CSP, no-JS and
layout verification. Use an isolated browser session with local fixtures. Disable JS before page
navigation, block non-loopback requests, inspect actual SVG/visible source and wait for concrete
states rather than network-idle while SSE is open. A narrow CDP call through its connection is
acceptable if the CLI cannot express a required check.

Add a small explicit browser smoke command (proposed `test:preview`) that fails when requested but
browser tooling is missing. Ordinary `bun test` remains browser-install independent. Pin automation
as a dev input and install Chromium only for development/CI, never the published application runtime.
Run the focused browser smoke in CI check; avoid introducing a browser matrix, screenshot-baseline
service or benchmark project. Desktop/mobile visual inspection remains a completion requirement.

Extend artifact smoke with the actual native executable and staged installed binary: use a temp cwd,
remove Bun from the artifact PATH, start `--serve` on an assigned port, read its URL, request HTML and
all asset imports, and stop cleanly. A test-local open/xdg-open stub can suppress automatic browser
launch; add no public flag solely for tests. Browser smoke must also render a diagram from an exact
artifact, not exclusively from source. Carry lightweight HTTP/asset smoke through existing native
build/installed jobs; preserve their platform/Node matrix and existing File Navigator smokes.

Existing final gates (run after focused tests, not for this documentation-only revision):

```bash
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run test:pty
bun run verify:github
bun run build:standalone
bun run --cwd apps/house smoke:file-navigator:standalone
bun run npm:pack
```

Also run the new preview browser/artifact smoke once its implementation adds the documented command.
Confirm the browser graph size and a representative long document remain practical; record observed
issues rather than inventing new numerical latency release gates. Scan diffs for secrets, unexpected
runtime/lockfile changes, generated source leaks and unrelated work. No safeguard bypass is authorized.

Update on each shipped slice:

- README.md: user-visible preview features and local/offline scope, no promised future controls.
- DESIGN.md: static baseline plus Mermaid enhancement; retain non-export and independent TUI renderer.
- ADR 0001: dated reconsideration explaining why Marked still meets this concrete requirement.
- CONTRIBUTING.md: preview build/typecheck/smoke commands, extraction boundary/API ownership and
  runtime limitations; keep public-module API/dependency notes alongside the reusable module.
- CHANGELOG.md: outcome-focused Added/Security notes for implemented behavior only.
- CONTEXT.md only if Browser preview/Document contents need formal disambiguation; no new glossary
  or ADR file solely for this feature. ROADMAP links may reference this plan without closing #75,
  #30 or the portable-output portion of #18.

## Later iterations: choose from observed need

| Candidate                              | Revisit when                                                                             | MVP decision |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | ------------ |
| Copy buttons                           | Repeated manual copying is inconvenient in daily use                                     | 19           |
| Sticky contents/active section         | Long documents make returning to contents awkward                                        | 11–12        |
| Viewport-based diagram loading         | Many diagrams cause measurable startup/scroll contention                                 | 14           |
| Manual appearance and diagram rerender | System-only appearance causes reading friction                                           | 17–18        |
| Ready handshake/recreation recovery    | Missed reloads or editor delete/recreate behavior causes repeated manual refresh/restart | 24–25        |
| Print or portable export               | A concrete sharing/printing workflow is requested                                        | 1, 20        |
| More languages/diagram types           | Real documents expose unsupported content                                                | 7, 13        |
| Package the reusable renderer          | A real second consumer needs a separately versioned dependency                           | 33           |

These are candidate follow-ups, not preapproved implementation or a fixed sequence. Select one from
feedback after the first release rather than designing all their state and tests now.

### GitHub handoff: proposed issue set

Checked existing issues and milestones on 2026-09-13. GitHub issues will own follow-up details;
ROADMAP.md will link the feature area and priorities, and this plan remains the MVP implementation
record. The existing `backlog` milestone means no commitment to ship. The following drafts have not
been published; replace the draft labels with issue links once issue creation is authorized.

For every draft, use this plan/decision as context, preserve the stated outcome as acceptance
criteria, and record the revisit trigger above for optional work. Avoid full implementation plans
for backlog items until selected. The three MVP issues depend on each other in the order below.

| Draft issue title                                                          | Scope and acceptance outcome                                                                                                                                   | Tracking                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| feat(preview): render safe highlighted Markdown through an extractable API | Slice 1; standalone text-in/HTML-out API, sanitization, code highlighting/fallbacks and packaged preview assets. Include Decision 33 from the start.           | MVP, first                     |
| feat(preview): add native document contents                                | Slice 2; reusable heading metadata, stable anchors and one accessible native contents disclosure, including no-JS use.                                         | MVP, after highlighted reading |
| feat(preview): render Mermaid diagrams from bundled local assets           | Slice 3; actual offline native/installed rendering, sequential enhancement and complete source on failure.                                                     | MVP, after contents            |
| feat(preview): copy code and diagram source                                | A click copies canonical source with accessible success/error feedback; no inert no-JS controls.                                                               | backlog; Decision 19           |
| feat(preview): keep document contents available while reading              | Desktop sticky contents/current-section indicator with native anchor history and usable mobile navigation.                                                     | backlog; Decisions 11–12       |
| perf(preview): defer offscreen Mermaid rendering                           | Measure a many-diagram document, then defer work near viewport without hiding readable source or breaking print expectations.                                  | backlog; Decision 14           |
| feat(preview): choose browser appearance                                   | System/Light/Dark control with deliberate persistence and safe diagram updates; independent of TUI themes.                                                     | backlog; Decisions 17–18       |
| fix(preview): recover missed reloads and recreated files                   | Reproduce missed SSE/recreation cases; restore preview convergence without stale targets or leaked watchers. Split if the two fixes need independent delivery. | backlog; Decisions 24–25       |
| feat(preview): improve browser printing                                    | Printed output includes readable diagrams or complete source even from closed disclosures; light/dark content stays legible. No PDF command or export format.  | backlog; Decision 20           |
| research: package the Markdown renderer for another consumer               | Identify a real consumer, verify the existing extraction boundary and propose package API/ownership/versioning; publishing requires separate authorization.    | backlog; Decision 33           |

Reuse these existing issue references without silently broadening or closing them:

- [#18](https://github.com/carlesandres/house/issues/18): original HTML-rendering investigation and
  portable-output question; relate the MVP issues to it, leaving portable export deferred.
- [#75](https://github.com/carlesandres/house/issues/75): relative user assets, already tracked separately.
- [#82](https://github.com/carlesandres/house/issues/82): a PDF preview action, distinct from browser print CSS.
- [#30](https://github.com/carlesandres/house/issues/30),
  [#72](https://github.com/carlesandres/house/issues/72) and
  [#216](https://github.com/carlesandres/house/issues/216) concern TUI contents/highlighting/copying,
  not substitutes for these browser tasks. #27's general file-watching scope is not evidence that
  browser reconnect/recreation recovery is already specified.

No new language-support issue is needed without an actual unsupported-language example. The
implementation plan stays stable after shipping; selected follow-ups receive their own scoped plan
when complexity warrants it. Do not keep expanding the completed MVP plan into a perpetual backlog.

Relative user-asset serving (#75), cross-file navigation, TUI contents (#30), math/MDX, streaming,
custom styles/grammars/plugins, pan/zoom tooling, hard CPU isolation, accounts, analytics, cloud
services and platform expansion remain outside this plan. No destructive actions, credentials,
persisted-data migration or external publication are needed.

## Completion and review

The MVP is complete when the three reading capabilities work through the existing entry points,
all non-deferred acceptance requirements pass, the static baseline survives missing JS/enhancement
failures, shipped native/installed artifacts provide their own assets, and desktop/mobile checks,
docs and existing release gates are complete. The rendering API and its style/enhancement contract
must also pass A25's independent-consumer evidence with no House dependency. Future-iteration features
and actual package creation/publication are not release blockers.

The owner approved local preview first, the MVP direction, mandatory extractability, and
implementation. The three slices and their non-deferred acceptance scenarios are implemented and
verified. Feedback can cite the stable decision numbers; deferred candidates remain separate future
work and the draft GitHub issues above remain unpublished.

## Primary-source references retained from investigation

Checked during the 2026-09-13 investigation; capability evidence is not proof the integration ran.
Recheck versions/advisories when implementing rather than copying a stale dependency pin.

- [Marked sanitation requirement](https://marked.js.org/).
- [Shiki engines](https://shiki.style/guide/regex-engines) and
  [dual themes](https://shiki.style/guide/dual-themes).
- [Heading extension's shared state](https://github.com/markedjs/marked-gfm-heading-id/blob/main/src/index.js)
  motivates a per-render slugger instead of its module-global collector.
- [Mermaid rendering/security](https://mermaid.js.org/config/usage.html) and
  [accessibility](https://mermaid.js.org/config/accessibility.html).
- [Maintained sanitize-html documentation](https://github.com/apostrophecms/apostrophe/blob/main/packages/sanitize-html/README.md)
  and [security-fix history](https://github.com/apostrophecms/apostrophe/blob/main/packages/sanitize-html/CHANGELOG.md).
- [Bun browser bundling](https://bun.com/docs/bundler) and
  [native embedding/plugins](https://bun.com/docs/bundler/executables).
