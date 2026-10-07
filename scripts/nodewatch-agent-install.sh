#!/usr/bin/env bash
# ==============================================================================
# NodeWatch Linux Agent Standalone Installer & Manager
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/opt/nodewatch"
CONFIG_DIR="/etc/nodewatch"
SERVICE_FILE="/etc/systemd/system/nodewatch-agent.service"
BIN_LINK="/usr/local/bin/nodewatch-agent"

check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}[ERROR] Please run as root (e.g. sudo bash nodewatch-agent-install.sh)${NC}"
        exit 1
    fi
}

is_agent_installed() {
    if [ -f "$SERVICE_FILE" ]; then
        return 0
    else
        return 1
    fi
}

show_agent_menu() {
    while true; do
        clear
        echo -e "${CYAN}${BOLD}"
        echo "=========================================================="
        echo "         NodeWatch Agent - Node Management Console        "
        echo "=========================================================="
        echo -e "${NC}"

        local status="${YELLOW}STOPPED${NC}"
        if systemctl is-active --quiet nodewatch-agent; then
            status="${GREEN}RUNNING${NC}"
        fi

        local srv_url="-"
        if [ -f "$CONFIG_DIR/agent.json" ]; then
            srv_url=$(grep -oE '"server_url": *"[^"]+"' "$CONFIG_DIR/agent.json" | cut -d'"' -f4 || echo "-")
        fi

        echo -e " Agent Status: ${status} | Target Server: ${CYAN}${srv_url}${NC}"
        echo "----------------------------------------------------------"
        echo "  [1]  Status & Diagnostics       (مشاهده وضعیت ایجنت)"
        echo "  [2]  Restart Agent              (راه‌اندازی مجدد ایجنت)"
        echo "  [3]  Stop Agent                 (توقف ایجنت)"
        echo "  [4]  Start Agent                (شروع به کار ایجنت)"
        echo "  [5]  View Real-Time Logs        (مشاهده لاگ‌های زنده journalctl)"
        echo "  [6]  Change Token / Server URL  (تغییر آدرس سرور یا توکن)"
        echo "  [7]  Uninstall Agent            (حذف کامل ایجنت از این سرور)"
        echo "  [0]  Exit                       (خروج)"
        echo "=========================================================="

        read -rp "Select an option [0-7]: " choice
        case $choice in
            1)
                systemctl status nodewatch-agent --no-pager || true
                read -rp "Press Enter to continue..."
                ;;
            2)
                systemctl restart nodewatch-agent
                echo -e "${GREEN}✔ Agent restarted.${NC}"
                sleep 1
                ;;
            3)
                systemctl stop nodewatch-agent
                echo -e "${YELLOW}✔ Agent stopped.${NC}"
                sleep 1
                ;;
            4)
                systemctl start nodewatch-agent
                echo -e "${GREEN}✔ Agent started.${NC}"
                sleep 1
                ;;
            5)
                echo -e "${CYAN}Viewing live agent logs (Ctrl+C to exit):${NC}"
                journalctl -u nodewatch-agent -f -n 30
                ;;
            6)
                read -rp "Enter new Server URL: " new_srv
                read -rp "Enter new Node Token: " new_tok
                if [ -n "$new_srv" ] && [ -n "$new_tok" ]; then
                    cat <<EOF > "$CONFIG_DIR/agent.json"
{
  "server_url": "$new_srv",
  "node_token": "$new_tok",
  "interval": 5
}
EOF
                    chmod 600 "$CONFIG_DIR/agent.json"
                    systemctl restart nodewatch-agent
                    echo -e "${GREEN}✔ Configuration updated and agent restarted.${NC}"
                fi
                read -rp "Press Enter to continue..."
                ;;
            7)
                read -rp "Are you sure you want to remove the NodeWatch Agent? [y/N]: " confirm
                if [[ "$confirm" =~ ^[yY]$ ]]; then
                    systemctl stop nodewatch-agent 2>/dev/null || true
                    systemctl disable nodewatch-agent 2>/dev/null || true
                    rm -f "$SERVICE_FILE"
                    rm -rf "$CONFIG_DIR"
                    rm -f "$INSTALL_DIR/nodewatch-agent"
                    rm -f "$BIN_LINK"
                    systemctl daemon-reload
                    echo -e "${GREEN}✔ NodeWatch agent removed completely.${NC}"
                    exit 0
                fi
                ;;
            0)
                clear
                exit 0
                ;;
            *)
                sleep 1
                ;;
        esac
    done
}

do_agent_install() {
    local SERVER_URL="http://localhost:8080"
    local TOKEN=""
    local INTERVAL=5

    while [[ "$#" -gt 0 ]]; do
        case $1 in
            --token) TOKEN="$2"; shift ;;
            --server) SERVER_URL="$2"; shift ;;
            --interval) INTERVAL="$2"; shift ;;
        esac
        shift
    done

    if [ -z "$TOKEN" ]; then
        clear
        echo -e "${CYAN}${BOLD}=== NodeWatch Agent Quick Setup ===${NC}\n"
        read -rp "Enter Central Server URL [e.g. http://1.2.3.4:8080]: " SERVER_URL
        read -rp "Enter Node Authentication Token: " TOKEN
        if [ -z "$TOKEN" ]; then
            echo -e "${RED}[ERROR] Token cannot be empty.${NC}"
            exit 1
        fi
    fi

    local ARCH
    ARCH=$(uname -m)
    local AGENT_ARCH="amd64"
    case $ARCH in
        x86_64) AGENT_ARCH="amd64" ;;
        aarch64|arm64) AGENT_ARCH="arm64" ;;
        armv7l|armhf) AGENT_ARCH="arm" ;;
    esac

    mkdir -p "$INSTALL_DIR"
    mkdir -p "$CONFIG_DIR"

    cat <<EOF > "$CONFIG_DIR/agent.json"
{
  "server_url": "$SERVER_URL",
  "node_token": "$TOKEN",
  "interval": $INTERVAL
}
EOF
    chmod 600 "$CONFIG_DIR/agent.json"

    # Copy binary if local or build
    if [ -f "./agent/nodewatch-agent" ]; then
        cp ./agent/nodewatch-agent "$INSTALL_DIR/nodewatch-agent"
    elif [ -f "./nodewatch-agent" ]; then
        cp ./nodewatch-agent "$INSTALL_DIR/nodewatch-agent"
    elif command -v go >/dev/null 2>&1 && [ -d "./agent" ]; then
        (cd ./agent && CGO_ENABLED=0 go build -ldflags="-s -w" -o "$INSTALL_DIR/nodewatch-agent" ./cmd/nodewatch-agent)
    else
        # Download from central server /downloads endpoint
        curl -fsSL -o "$INSTALL_DIR/nodewatch-agent" "$SERVER_URL/downloads/nodewatch-agent-$AGENT_ARCH" 2>/dev/null || true
    fi

    if [ -f "$INSTALL_DIR/nodewatch-agent" ]; then
        chmod +x "$INSTALL_DIR/nodewatch-agent"
    fi

    cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=NodeWatch Monitoring Agent
After=network.target

[Service]
Type=simple
User=root
ExecStart=$INSTALL_DIR/nodewatch-agent -config $CONFIG_DIR/agent.json
Restart=always
RestartSec=5
LimitNOFILE=65535
CPUQuota=10%
MemoryMax=64M

[Install]
WantedBy=multi-user.target
EOF

    # Copy script to /opt/nodewatch/agent-menu.sh & create alias
    cp "$0" "$INSTALL_DIR/agent-menu.sh" 2>/dev/null || true
    chmod +x "$INSTALL_DIR/agent-menu.sh" 2>/dev/null || true
    ln -sf "$INSTALL_DIR/agent-menu.sh" "$BIN_LINK" 2>/dev/null || true

    systemctl daemon-reload
    systemctl enable nodewatch-agent
    systemctl restart nodewatch-agent
    sleep 1

    if systemctl is-active --quiet nodewatch-agent; then
        echo -e "\n${GREEN}${BOLD}✔ NodeWatch Agent is online and streaming live metrics to $SERVER_URL!${NC}"
        echo -e "Manage agent anytime by typing: ${YELLOW}nodewatch-agent${NC}\n"
    else
        echo -e "\n${RED}✖ Agent installed but failed to start. View logs with: journalctl -u nodewatch-agent -n 20${NC}"
    fi
}

check_root

if [ "$#" -gt 0 ]; then
    do_agent_install "$@"
elif is_agent_installed; then
    show_agent_menu
else
    do_agent_install "$@"
fi
