#!/usr/bin/env bash
set -e

if [ "$EUID" -ne 0 ]; then
    echo "Error: Please run as root (sudo bash update.sh)"
    exit 1
fi

echo "Updating NodeWatch Central Server..."

INSTALL_DIR="/opt/nodewatch"

# 1. Build or copy new backend binary
if [ -d "./backend" ] && command -v go >/dev/null 2>&1; then
    echo "Compiling latest backend binary..."
    (cd ./backend && CGO_ENABLED=0 go build -o "$INSTALL_DIR/nodewatch.new" ./cmd/nodewatch)
    mv "$INSTALL_DIR/nodewatch.new" "$INSTALL_DIR/nodewatch"
    chmod +x "$INSTALL_DIR/nodewatch"
fi

# 2. Update frontend assets if present
if [ -d "./frontend/dist" ]; then
    echo "Updating frontend static assets..."
    rm -rf "$INSTALL_DIR/dist"
    cp -r ./frontend/dist "$INSTALL_DIR/dist"
fi

# 3. Restart systemd service
echo "Restarting nodewatch service..."
systemctl restart nodewatch
systemctl status nodewatch --no-pager -l

echo "NodeWatch updated successfully!"
