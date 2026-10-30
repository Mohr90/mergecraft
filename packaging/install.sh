#!/usr/bin/env bash
# Installiert Mergecraft für den aktuellen Benutzer nach ~/.local (kein sudo).
# Vorher bauen:  npm run build
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="target/release/mergecraft"
[ -x "$BIN" ] || BIN="src-tauri/target/release/mergecraft"
if [ ! -x "$BIN" ]; then
  echo "Binary nicht gefunden – bitte zuerst bauen:  npm run build" >&2
  exit 1
fi

install -Dm755 "$BIN" "$HOME/.local/bin/mergecraft"
install -Dm644 src-tauri/icons/128x128.png \
  "$HOME/.local/share/icons/hicolor/128x128/apps/mergecraft.png"
install -Dm644 src-tauri/icons/32x32.png \
  "$HOME/.local/share/icons/hicolor/32x32/apps/mergecraft.png"
install -Dm644 packaging/mergecraft.desktop \
  "$HOME/.local/share/applications/mergecraft.desktop"

update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "Mergecraft installiert:"
echo "  $HOME/.local/bin/mergecraft"
echo "  $HOME/.local/share/applications/mergecraft.desktop"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "Hinweis: ~/.local/bin liegt nicht in PATH." ;;
esac
for d in target/release/bundle src-tauri/target/release/bundle; do
  [ -d "$d" ] && ls -1 "$d"/*/*.deb "$d"/*/*.AppImage 2>/dev/null | sed 's/^/  Paket: /'
done
