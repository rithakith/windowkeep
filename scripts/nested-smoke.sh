#!/usr/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
rig=$(mktemp -d /tmp/windowkeep-shell-XXXXXX)
mkdir -p "$rig/data/applications" "$rig/data/gnome-shell/extensions" "$rig/config" "$rig/cache" "$rig/runtime"
chmod 700 "$rig/runtime"
glib-compile-schemas --strict "$root/schemas"
# Capture the requested wallpaper URI before switching to isolated settings.
if [ "${WINDOWKEEP_DOC_SCREENSHOTS:-}" = "1" ]; then
    export WINDOWKEEP_DOC_WALLPAPER=$(gsettings get org.gnome.desktop.background picture-uri-dark | tr -d "'")
fi
# Keep the test's settings, files, bus and socket separate from the real desktop.
export XDG_DATA_HOME="$rig/data" XDG_CONFIG_HOME="$rig/config" XDG_CACHE_HOME="$rig/cache"
if [ -n "${WINDOWKEEP_TEST_ZIP:-}" ]; then
    python3 -m zipfile -e "$WINDOWKEEP_TEST_ZIP" "$rig/data/gnome-shell/extensions/windowkeep@rithakith.github.io"
else
    ln -s "$root" "$rig/data/gnome-shell/extensions/windowkeep@rithakith.github.io"
fi
cat > "$rig/data/applications/org.example.WindowKeepTest.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=WindowKeep Test
Exec=/usr/bin/python3 "$root/tests/test-app.py"
Terminal=false
DESKTOP
export XDG_RUNTIME_DIR="$rig/runtime" GSETTINGS_BACKEND=memory WINDOWKEEP_SOURCE="$rig/data/gnome-shell/extensions/windowkeep@rithakith.github.io"
export WINDOWKEEP_REAL_SOURCE="$root"
export GI_TYPELIB_PATH="/usr/lib64/gnome-shell/girepository-1.0:/usr/lib64/gnome-shell${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
export LD_LIBRARY_PATH="/usr/lib64/gnome-shell${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export MUTTER_DEBUG_DUMMY_MODE_SPECS=1280x800 GTK_A11Y=none GDK_BACKEND=wayland
exec timeout 100 dbus-run-session -- gnome-shell --headless --virtual-monitor=1280x800 --virtual-monitor=1024x768 --wayland --automation-script="$root/tests/shell-smoke.js"
