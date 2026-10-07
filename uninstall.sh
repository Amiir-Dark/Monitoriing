#!/usr/bin/env bash
set -e

if [ "$EUID" -ne 0 ]; then
    echo "Error: Please run as root (sudo bash uninstall.sh)"
    exit 1
fi

echo "Stopping NodeWatch service..."
systemctl stop nodewatch 2>/dev/null || true
systemctl disable nodewatch 2>/dev/null || true

echo "Removing systemd service unit..."
rm -f /etc/systemd/system/nodewatch.service
systemctl daemon-reload

echo "Removing installation files (preserving database in /opt/nodewatch/data)..."
rm -f /opt/nodewatch/nodewatch
rm -rf /opt/nodewatch/dist

read -p "Do you want to permanently delete database and metrics data? (y/N): " -r CONFIRM
if [[ $CONFIRM =~ ^[Yy]$ ]]; then
    rm -rf /opt/nodewatch
    echo "All database files removed."
fi

echo "NodeWatch Central Server successfully uninstalled."
