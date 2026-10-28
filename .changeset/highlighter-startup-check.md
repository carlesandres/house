---
"@carlesandres/house": patch
---

The Browser TUI now exits at startup if the markdown highlighter cannot initialize, instead of
rendering raw source. CLI and standalone builds fail the same check.
