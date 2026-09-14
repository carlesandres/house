# ADR 0001: Do not adopt Streamdown for browser preview yet

- Status: Accepted
- Date: 2026-05-31
- Reconsidered: 2026-09-13

## Context

`house` currently renders the browser preview opened with `O` by reading the selected file,
passing it through `marked`, and embedding the resulting HTML into a self-contained page with
inline CSS and a small live-reload script.

We investigated whether Vercel's `streamdown` package would be a better renderer for that preview
path.

`streamdown` is a React markdown renderer built for AI-style streaming content. Its relevant
benefits for `house` would be better static markdown rendering ergonomics, safer rendering, and an
optional richer plugin story for code, math, diagrams, and GFM behavior.

Using it here would not be a drop-in replacement:

- the current preview path renders a plain HTML string, not a React tree
- `streamdown` would require a server-side React render path via `react-dom/server`
- its styling model would require integrating Streamdown's CSS and design-token variables into the
  self-contained preview page
- richer features would pull in additional plugin dependencies and styling work

The headline value of `streamdown` is streaming and incomplete-markdown handling, but `house`
previews complete files, not model-token streams.

## Decision

We will not adopt `streamdown` for the `O` browser preview in v1 / current beta work.

We will keep the existing `marked`-based HTML preview path for now to avoid adding React SSR,
extra CSS integration, and additional dependency and maintenance complexity to a feature that is
currently simple and sufficient.

## Consequences

### Positive

- Keeps the preview path small, understandable, and easy to maintain.
- Preserves the current self-contained HTML page model.
- Avoids adding `react-dom` and the surrounding server-rendering glue.
- Avoids taking on Streamdown's CSS token and optional plugin integration work.

### Negative

- Browser preview does not get Streamdown's richer static rendering features.
- If we later want stronger browser-preview markdown fidelity, syntax highlighting, or richer
  extension points, we may need to revisit this decision.

## Revisit triggers

Reconsider this ADR if one of these becomes true:

- the browser preview needs richer markdown fidelity that the current `marked` path cannot provide
  cleanly
- we decide the preview should be rendered through React for other reasons anyway
- we add concrete requirements for browser-preview syntax highlighting, math, diagrams, or stronger
  sanitization that justify the extra integration cost

## 2026-09-13 reconsideration

The syntax-highlighting, diagram, and sanitization triggers fired. The decision against Streamdown
still holds: complete local files do not need React or streaming-aware parsing. The Marked path now
feeds an extractable asynchronous renderer that sanitizes authored HTML, highlights fixed languages
with Shiki, and returns heading metadata plus Mermaid source markers. House composes that safe
fragment into its local page shell and loads a root-scoped Mermaid enhancer from embedded assets.

This keeps the TUI renderer independent, gives browser preview the required fidelity, and leaves a
future library extraction as a move of the rendering boundary rather than another renderer rewrite.
