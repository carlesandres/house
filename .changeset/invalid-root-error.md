---
"@carlesandres/house": patch
---

`house --root` pointing at a file, missing path or unreadable directory now prints an error before
the TUI starts, instead of exiting silently, so the bad root is obvious.
