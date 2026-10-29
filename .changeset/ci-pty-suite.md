---
"@carlesandres/house": patch
---

CI now runs the PTY suite (`bun run test:pty`) after workspace tests, so real-terminal regressions
for editor, new-file, sidebar selection, status popover, and extension allow-list paths are gated.
