# VHS tape: records a short demo of house and writes tape/house.gif
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

# Launch the installed house against the repo's own markdown files
Hide
Type "house ."
Enter
Sleep 2s
Show

# Browse the sidebar
Down@300ms 4
Sleep 800ms

# Filter the sidebar — show live narrowing as we type
Type "/"
Sleep 600ms
Type@180ms "road"
Sleep 1200ms
Backspace@150ms 4
Sleep 800ms
Escape
Sleep 1500ms

# Open a file
Enter
Sleep 1500ms

# Page through it
Space
Sleep 1s
Space
Sleep 1s
Escape
Sleep 1500ms

# Command palette — fuzzy-find a command and run it
Ctrl+p
Sleep 600ms
Type@180ms "theme"
Sleep 1200ms
Down
Sleep 600ms
Enter
Sleep 1500ms

# Cycle a couple more themes directly
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
