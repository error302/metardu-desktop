#!/bin/sh
# Debian package post-remove script.
# Removes the desktop entry created by deb-after-install.sh.

set -e

DESKTOP_FILE=/usr/share/applications/metardu-desktop.desktop
ICON_FILE=/usr/share/icons/hicolor/512x512/apps/metardu-desktop.png

rm -f "$DESKTOP_FILE"
rm -f "$ICON_FILE"

update-desktop-database /usr/share/applications 2>/dev/null || true

exit 0
