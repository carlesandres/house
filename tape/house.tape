# VHS tape: records a short demo of house and writes tape/house.gif
#
# Run from the repo root:
#   vhs tape/house.tape
#
# Produces:
#   tape/house.gif

Output tape/house.gif

Set Shell "bash"
Set FontSize 32
Set Width 2800
Set Height 1600
Set Padding 40
Set Theme "TokyoNight"

# Launch house against the repo's own markdown files
Type "bun run src/index.tsx ."
Enter
Sleep 2s

# Browse the sidebar
Down@300ms 4
Sleep 800ms

# Open a file
Enter
Sleep 1500ms

# Page through it
Space
Sleep 1s
Space
Sleep 1s

# Back to the sidebar, cycle themes
Escape
Sleep 500ms
Type "t"
Sleep 1600ms
Type "t"
Sleep 1600ms
Type "t"
Sleep 1600ms

# Flip dark/light tone
Type "L"
Sleep 2s
Type "L"
Sleep 1600ms

# Quit
Type "q"
Sleep 500ms
