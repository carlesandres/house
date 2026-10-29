---
"@carlesandres/house": patch
---

House now runs on OpenTUI 0.6 and Effect 4.0 stable, and its binaries are built with Bun 1.3.14, the oldest Bun that OpenTUI 0.6 supports.

Over SSH, House now takes its color depth from `TERM` and `COLORTERM`. A truecolor terminal reached through a client that doesn't forward `COLORTERM`, such as the stock macOS ssh, now shows 256-color approximations: set `COLORTERM=truecolor` on the server, or forward it with `SendEnv COLORTERM` and the server's `AcceptEnv COLORTERM`.
