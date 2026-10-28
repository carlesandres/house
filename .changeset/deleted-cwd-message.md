---
"@carlesandres/house": patch
---

npm-installed `house` run from a deleted or inaccessible directory now says so and exits,
instead of failing with an unknown error, so the fix (`cd` elsewhere) is clear.
