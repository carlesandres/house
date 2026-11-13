---
"@carlesandres/house": patch
---

`house --serve` now tells you when a newer version is available, printing the upgrade tip to stderr like the TUI does on quit. `--no-update-check` now actually turns the check off (it was ignored before; `NO_UPDATE_NOTIFIER=1` always worked). The update check also stops reading an unexpectedly large registry response instead of downloading and parsing all of it.
