#!/usr/bin/env bash
# Launch an isolated test browser (CDP 9333) with a given unpacked extension dir.
# Run it as a long-lived background process.
# BROWSER: a Chromium-based browser that still accepts --load-extension. Default: Brave from its standard
#   install dirs. Chromium and Chrome for Testing work too; branded Google Chrome dropped the flag in 137.
# TEST_WINDOW_POS (default 4000,100): where the window opens, meant to be outside every monitor so it never
#   shows up on screen yet keeps rendering (page translation needs IntersectionObserver, which stops when
#   the window is minimised). Move it further out if your desktop reaches that far.
# Translate (the browser's own "translate this page?" bubble) is disabled: anchored to an off-screen
# window, that bubble gets clamped onto the primary monitor.
# usage: tests/launch-test-browser.sh <extension-dir> [profile-dir] [start-url]
# BROWSER_EXTRA_FLAGS=--enable-webgpu-developer-features gives full-precision WebGPU timestamps (GPU profile builds)
EXT="$1"
# default profile: .work/test-profile in the project (a Windows path for the browser)
PROFILE="${2:-$(cd "$(dirname "$0")/.." && pwd -W)/.work/test-profile}"
URL="${3:-about:blank}"
if [ -z "$BROWSER" ]; then
  for base in "$PROGRAMFILES" "$LOCALAPPDATA"; do
    [ -n "$base" ] || continue
    candidate="$(cygpath -u "$base")/BraveSoftware/Brave-Browser/Application/brave.exe"
    if [ -x "$candidate" ]; then BROWSER="$candidate"; break; fi
  done
fi
if [ -z "$BROWSER" ]; then
  echo "BROWSER is not set: point it at a browser that accepts --load-extension (Brave, Chromium, Chrome for Testing)" >&2
  exit 1
fi
# Brave 1.99 still shows its "translate this page?" bubble with --disable-features=Translate, clamped onto a
# visible monitor: switch translation off in the test profile itself (Preferences is read at startup).
node -e '
const fs = require("fs"), path = require("path");
const f = path.join(process.argv[1], "Default", "Preferences");
let p = {};
try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
if (!p.translate || p.translate.enabled !== false) {
  p.translate = Object.assign({}, p.translate, { enabled: false });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(p));
}' "$PROFILE"
exec "$BROWSER" \
  --user-data-dir="$PROFILE" --remote-debugging-port=9333 --no-first-run --no-default-browser-check \
  --disable-features=DisableLoadExtensionCommandLineSwitch,CalculateNativeWinOcclusion,Translate \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --hide-crash-restore-bubble --load-extension="$EXT" \
  --window-position="${TEST_WINDOW_POS:-4000,100}" --window-size=1280,900 $BROWSER_EXTRA_FLAGS "$URL"
