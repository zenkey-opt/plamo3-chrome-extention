#!/usr/bin/env bash
# Launch the isolated test Brave (CDP 9333) with a given unpacked extension dir.
# Run it as a long-lived background process. The window opens outside every monitor
# (this PC's virtual desktop spans x -1265..2167), so it never shows up on the user's screens
# yet keeps rendering (page translation needs IntersectionObserver, which stops when minimised).
# Translate (Brave's own "translate this page?" bubble) is disabled: anchored to an off-screen
# window, that bubble gets clamped onto the primary monitor.
# usage: tests/launch-test-brave.sh <extension-dir> [profile-dir] [start-url]
# BRAVE_EXTRA_FLAGS=--enable-webgpu-developer-features gives full-precision WebGPU timestamps (GPU profile builds)
EXT="$1"
# default profile: .work/brave-profile in the project (Windows path for brave.exe)
PROFILE="${2:-$(cd "$(dirname "$0")/.." && pwd -W)/.work/brave-profile}"
URL="${3:-about:blank}"
exec "/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe" \
  --user-data-dir="$PROFILE" --remote-debugging-port=9333 --no-first-run --no-default-browser-check \
  --disable-features=DisableLoadExtensionCommandLineSwitch,CalculateNativeWinOcclusion,Translate \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --hide-crash-restore-bubble --load-extension="$EXT" \
  --window-position=4000,100 --window-size=1280,900 $BRAVE_EXTRA_FLAGS "$URL"
