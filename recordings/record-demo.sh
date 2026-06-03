#!/usr/bin/env bash

set -euo pipefail

session_name="house-demo"
recording_path="recordings/house-demo.termctrl"
video_path="recordings/house-demo.mp4"

termctrl stop "$session_name" >/dev/null 2>&1 || true
rm -f "$recording_path" "$video_path"

termctrl start \
	"$session_name" \
	--cols 112 \
	--rows 34 \
	--cwd "." \
	--host opentui \
	--record "$recording_path" \
	-- env -i HOME="$HOME" PATH="$PATH" TERM=xterm-256color zsh -f

termctrl send "$session_name" ctrl-l
sleep 1
termctrl send "$session_name" --pace-ms 120 text:house enter
sleep 2
termctrl send "$session_name" --pace-ms 120 text:READ
sleep 2
termctrl send "$session_name" enter
sleep 1
termctrl send "$session_name" --pace-ms 250 down down down down down
sleep 1
termctrl send "$session_name" text:t
sleep 1
termctrl send "$session_name" text:t
sleep 1
termctrl send "$session_name" ctrl-p
sleep 1
termctrl send "$session_name" --pace-ms 250 down down down
sleep 1
termctrl send "$session_name" --pace-ms 250 up up
sleep 1
termctrl send "$session_name" escape
sleep 1
termctrl send "$session_name" tab
sleep 1
termctrl send "$session_name" tab
sleep 1
termctrl send "$session_name" tab
sleep 1
termctrl send "$session_name" text:s
sleep 1
termctrl send "$session_name" text:s
sleep 4

termctrl stop "$session_name"
termctrl video "$recording_path" --out "$video_path"

printf 'Wrote %s\n' "$video_path"
