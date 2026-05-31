# VHS tape: captures a single still PNG of house and writes tape/house.png
#
# Run from the repo root:
#   vhs tape/screenshot.tape
#
# Produces:
#   tape/house.png

Output tape/house.png

Set Shell "bash"
Set FontSize 32
Set Width 2800
Set Height 1600
Set Padding 40
Set Theme "TokyoNight"

Type "bun run src/index.tsx --root . --no-update-check"
Enter
Sleep 2s

# Open the first file so both panes have content
Enter
Sleep 1500ms

Screenshot tape/house.png

# Quit cleanly so vhs exits
Escape
Sleep 200ms
Type "q"
Sleep 300ms
