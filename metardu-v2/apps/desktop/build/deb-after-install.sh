#!/bin/sh
# Debian package post-install script.
# Creates a desktop entry so MetaRDU appears in the application menu.

set -e

DESKTOP_FILE=/usr/share/applications/metardu-desktop.desktop

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=MetaRDU Desktop
Comment=Multi-country survey automation platform
Exec=/opt/MetaRDU\ Desktop/metardu-desktop
Icon=metardu-desktop
Terminal=false
Type=Application
Categories=Science;Geoscience;
StartupWMClass=MetaRDU Desktop
EOF

# Install the icon (AppImage extracts its own; for .deb we install to hicolor)
if [ -d /opt/MetaRDU\ Desktop ]; then
  # Copy icon to hicolor theme
  mkdir -p /usr/share/icons/hicolor/512x512/apps
  cp /opt/MetaRDU\ Desktop/resources/metardu-logo.jpeg /usr/share/icons/hicolor/512x512/apps/metardu-desktop.png 2>/dev/null || true
fi

# Update desktop database
update-desktop-database /usr/share/applications 2>/dev/null || true

exit 0
