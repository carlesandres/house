# VHS tape: records a feature tour of house and writes tape/house.gif
#
# Run from the repo root:
#   vhs tape/house.tape
#
# Produces:
#   tape/house.gif

Output tape/house.gif

Set Shell "bash"
Set FontSize 28
Set Width 2800
Set Height 1800
Set Padding 40
Set Theme "TokyoNight"
Set Framerate 12

# VHS has no native caption overlay, so each section starts with a short
# terminal title card. Launch commands are hidden so the viewer sees the
# caption, then the app state.

# Browse local docs
Hide
Type "clear; echo; echo \ \ Browse\ local\ docs; echo; echo \ \ Open\ a\ project\ and\ move\ through\ Markdown\ files\ from\ the\ sidebar."
Enter
Show
Sleep 1600ms
Hide
Type "clear; bun run src/index.tsx --root . --focus sidebar --no-update-check"
Enter
Sleep 1800ms
Show
Sleep 900ms
Down@350ms 3
Sleep 1000ms
Up@350ms 1
Sleep 900ms
Enter
Sleep 1800ms
Type "q"
Sleep 500ms

# File search
Hide
Type "clear; echo; echo \ \ File\ search; echo; echo \ \ Fuzzy-filter\ the\ sidebar,\ then\ open\ the\ matching\ file."
Enter
Show
Sleep 1600ms
Hide
Type "clear; bun run src/index.tsx --root . --focus sidebar --no-update-check"
Enter
Sleep 1800ms
Show
Sleep 700ms
Type "/"
Sleep 600ms
Type@220ms "road"
Sleep 1800ms
Enter
Sleep 1800ms
Type "q"
Sleep 500ms

# Reader navigation
Hide
Type "clear; echo; echo \ \ Reader\ navigation; echo; echo \ \ Launch\ into\ a\ file,\ page\ through\ it,\ and\ jump\ between\ files."
Enter
Show
Sleep 1600ms
Hide
Type "clear; bun run src/index.tsx README.md --root . --focus reader --no-update-check"
Enter
Sleep 1800ms
Show
Sleep 1000ms
Space
Sleep 1400ms
Space
Sleep 1400ms
PageUp
Sleep 1200ms
Type "]"
Sleep 1500ms
Type "["
Sleep 1500ms
Type "q"
Sleep 500ms

# Command discovery
Hide
Type "clear; echo; echo \ \ Command\ discovery; echo; echo \ \ Use\ help\ and\ the\ command\ palette\ to\ find\ actions,\ including\ file\ hand-offs."
Enter
Show
Sleep 1700ms
Hide
Type "clear; bun run src/index.tsx README.md --root . --focus reader --no-update-check"
Enter
Sleep 1800ms
Show
Sleep 900ms
Type "?"
Sleep 2200ms
Escape
Sleep 900ms
Ctrl+p
Sleep 700ms
Type@180ms "open"
Sleep 2200ms
Escape
Sleep 900ms
Type "q"
Sleep 500ms

# Themes and tone
Hide
Type "clear; echo; echo \ \ Themes\ and\ tone; echo; echo \ \ Cycle\ themes\ and\ switch\ between\ dark\ and\ light\ without\ leaving\ the\ reader."
Enter
Show
Sleep 1700ms
Hide
Type "clear; bun run src/index.tsx README.md --root . --focus reader --no-update-check"
Enter
Sleep 1800ms
Show
Sleep 1000ms
Type "t"
Sleep 1800ms
Type "t"
Sleep 1800ms
Type "L"
Sleep 2200ms
Type "L"
Sleep 1800ms

# Quit
Type "q"
Sleep 500ms
