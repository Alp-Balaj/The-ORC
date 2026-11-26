#!/usr/bin/env bash
# Linux: add a "The ORC" launcher to the app menu (and ~/Desktop if it exists).
# Safe to re-run; it rewrites the .desktop file with this checkout's path.
set -euo pipefail
repo="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
launcher="$repo/scripts/orc-launch.sh"
icon="$repo/build/icon.png"
chmod +x "$launcher" "$repo/scripts/orc-app.sh"

entry="[Desktop Entry]
Type=Application
Name=The ORC
Comment=Run Claude Code missions
Exec=\"$launcher\"
Icon=$icon
Terminal=false
Categories=Development;
StartupWMClass=The ORC
"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$apps"
printf '%s' "$entry" >"$apps/the-orc.desktop"
chmod +x "$apps/the-orc.desktop"
echo "Installed $apps/the-orc.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$apps" 2>/dev/null || true

desk="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$desk" ]; then
  printf '%s' "$entry" >"$desk/the-orc.desktop"
  chmod +x "$desk/the-orc.desktop"
  # GNOME needs the file marked trusted before it launches on double-click.
  command -v gio >/dev/null && gio set "$desk/the-orc.desktop" metadata::trusted true 2>/dev/null || true
  echo "Installed $desk/the-orc.desktop (if it shows a warning, right-click > Allow Launching)"
fi
echo "Output of launches goes to ~/.local/state/the-orc/launch.log"
