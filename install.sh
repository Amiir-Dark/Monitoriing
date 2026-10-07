#!/usr/bin/env bash
# ==============================================================================
# NodeWatch - High-Performance Linux Server Monitoring Platform
# Interactive Installer & Service Management Console
# ==============================================================================

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Helper for pipe-safe and tty-safe user input
read_input() {
    local prompt="$1"
    local default_val="$2"
    local input=""
    if [ -r /dev/tty ]; then
        read -rp "$prompt" input < /dev/tty 2>/dev/null || true
    elif [ -t 0 ]; then
        read -rp "$prompt" input 2>/dev/null || true
    fi
    echo "${input:-$default_val}"
}

read_pause() {
    local prompt="${1:-Press Enter to continue...}"
    if [ -r /dev/tty ]; then
        read -rp "$prompt" _dummy < /dev/tty 2>/dev/null || true
    elif [ -t 0 ]; then
        read -rp "$prompt" _dummy 2>/dev/null || true
    fi
}


INSTALL_DIR="/opt/nodewatch"
SRC_DIR="/opt/nodewatch/src"
SERVICE_FILE="/etc/systemd/system/nodewatch.service"
BIN_LINK="/usr/local/bin/nodewatch"
DEFAULT_PORT="8080"
REPO_DEFAULT="https://github.com/Amiir-Dark/Monitoriing.git"

print_banner() {
    clear
    echo -e "${CYAN}${BOLD}"
    cat << "EOF"
 _   _           _      __        __  _          _     
| \ | | ___   __| | ___ \ \      / /_ _| |_ ___| |__  
|  \| |/ _ \ / _` |/ _ \ \ \ /\ / / _` | __/ __| '_ \ 
| |\  | (_) | (_| |  __/  \ V  V / (_| | || (__| | | |
|_| \_|\___/ \__,_|\___|   \_/\_/ \__,_|\__\___|_| |_|
EOF
    echo -e "${NC}"
    echo -e "${BOLD}NodeWatch Central Server - Intelligent Management Console${NC}"
    echo -e "${BLUE}====================================================================${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}[ERROR] Please run this script as root (e.g. sudo bash install.sh)${NC}"
        exit 1
    fi
}

is_installed() {
    if [ -f "$INSTALL_DIR/nodewatch" ] && [ -f "$SERVICE_FILE" ]; then
        return 0
    else
        return 1
    fi
}

get_current_port() {
    if [ -f "$SERVICE_FILE" ]; then
        local p
        p=$(grep -oE '\-port [0-9]+' "$SERVICE_FILE" | awk '{print $2}')
        if [ -n "$p" ]; then
            echo "$p"
            return
        fi
    fi
    echo "$DEFAULT_PORT"
}

get_service_status() {
    if systemctl is-active --quiet nodewatch; then
        echo -e "${GREEN}● RUNNING${NC}"
    elif systemctl is-failed --quiet nodewatch; then
        echo -e "${RED}● FAILED${NC}"
    else
        echo -e "${YELLOW}● STOPPED${NC}"
    fi
}

get_public_ip() {
    local ip
    ip=$(curl -s4 -m 3 https://api.ipify.org 2>/dev/null || curl -s4 -m 3 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    if [ -z "$ip" ]; then
        ip="YOUR-SERVER-IP"
    fi
    echo "$ip"
}

# ------------------------------------------------------------------------------
# Management Menu Actions
# ------------------------------------------------------------------------------

show_status() {
    print_banner
    echo -e "${BOLD}Current Service Status & Diagnostics:${NC}\n"
    systemctl status nodewatch --no-pager || true
    echo ""
    local port
    port=$(get_current_port)
    echo -e "Listening Port: ${CYAN}${port}${NC}"
    if command -v ss >/dev/null 2>&1; then
        ss -tulpn | grep "$port" || echo "(Port not currently listening)"
    fi
    echo ""
    read_pause "Press Enter to return to menu..."
}

restart_service() {
    echo -e "\n${YELLOW}Restarting NodeWatch service...${NC}"
    systemctl restart nodewatch
    sleep 1
    if systemctl is-active --quiet nodewatch; then
        echo -e "${GREEN}✔ NodeWatch restarted successfully!${NC}"
    else
        echo -e "${RED}✖ Failed to restart. Inspect logs with option 5.${NC}"
    fi
    read_pause
}

stop_service() {
    echo -e "\n${YELLOW}Stopping NodeWatch service...${NC}"
    systemctl stop nodewatch
    echo -e "${GREEN}✔ NodeWatch service stopped.${NC}"
    read_pause
}

start_service() {
    echo -e "\n${YELLOW}Starting NodeWatch service...${NC}"
    systemctl start nodewatch
    sleep 1
    if systemctl is-active --quiet nodewatch; then
        echo -e "${GREEN}✔ NodeWatch service started!${NC}"
    else
        echo -e "${RED}✖ Service failed to start. View logs with option 5.${NC}"
    fi
    read_pause
}

view_logs() {
    echo -e "\n${CYAN}Viewing live NodeWatch logs (Press Ctrl+C to exit logs):${NC}\n"
    journalctl -u nodewatch -f -n 50
}

change_port() {
    print_banner
    local current_port
    current_port=$(get_current_port)
    echo -e "Current configured port: ${CYAN}${current_port}${NC}"
    local new_port
    new_port=$(read_input "Enter new port [1024-65535]: " "$current_port")
    if ! [[ "$new_port" =~ ^[0-9]+$ ]] || [ "$new_port" -lt 1 ] || [ "$new_port" -gt 65535 ]; then
        echo -e "${RED}[ERROR] Invalid port number.${NC}"
        sleep 2
        return
    fi

    sed -i -E "s/-port [0-9]+/-port $new_port/" "$SERVICE_FILE"
    systemctl daemon-reload
    systemctl restart nodewatch
    echo -e "${GREEN}✔ Port changed to $new_port and service restarted!${NC}"
    local ip
    ip=$(get_public_ip)
    echo -e "Dashboard URL: ${CYAN}http://${ip}:${new_port}${NC}"
    read_pause
}

backup_database() {
    print_banner
    local backup_dir="$INSTALL_DIR/data/backups"
    mkdir -p "$backup_dir"
    local timestamp
    timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_file="$backup_dir/backup_${timestamp}.db"

    if [ -f "$INSTALL_DIR/data/nodewatch.db" ]; then
        echo -e "${YELLOW}Creating safe SQLite backup...${NC}"
        if [ -x "$INSTALL_DIR/nodewatch" ]; then
            "$INSTALL_DIR/nodewatch" backup "$backup_file"
        else
            cp "$INSTALL_DIR/data/nodewatch.db" "$backup_file"
        fi
        echo -e "${GREEN}✔ Database backup created at:${NC}"
        echo -e "  ${CYAN}${backup_file}${NC}"
        ls -lh "$backup_file"
    else
        echo -e "${RED}[ERROR] Database file not found at $INSTALL_DIR/data/nodewatch.db${NC}"
    fi
    read_pause
}

update_nodewatch() {
    print_banner
    echo -e "${BOLD}Updating NodeWatch to the latest version...${NC}\n"

    # Check where source resides
    local build_src=""
    if [ -d "./backend" ] && [ -f "./install.sh" ]; then
        build_src="."
    elif [ -d "$SRC_DIR/backend" ]; then
        build_src="$SRC_DIR"
    fi

    if [ -z "$build_src" ]; then
        echo -e "${YELLOW}Source repository not found locally. Cloning latest version...${NC}"
        mkdir -p "$SRC_DIR"
        git clone "$REPO_DEFAULT" "$SRC_DIR" || {
            echo -e "${RED}[ERROR] Failed to clone repository.${NC}"
            read_pause
            return
        }
        build_src="$SRC_DIR"
    fi

    echo -e "${CYAN}Pulling latest changes from git...${NC}"
    (cd "$build_src" && git pull || true)

    echo -e "${CYAN}Rebuilding backend binary...${NC}"
    ensure_go
    export GOTOOLCHAIN=local
    export GOPROXY=https://mirror-go.runflare.com,https://goproxy.io,direct
    go env -w GOPROXY=https://mirror-go.runflare.com,https://goproxy.io,direct 2>/dev/null || true
    local go_ver
    go_ver=$(go version | awk '{print $3}' | sed 's/go//' | cut -d'.' -f1,2)
    if [ -n "$go_ver" ]; then
        sed -i -E "s/go 1\.[0-9]+(\.[0-9]+)?/go ${go_ver}/" "$build_src/backend/go.mod" "$build_src/agent/go.mod" 2>/dev/null || true
    fi
    (cd "$build_src/backend" && CGO_ENABLED=0 go build -ldflags="-s -w" -o "$INSTALL_DIR/nodewatch" ./cmd/nodewatch)
    chmod +x "$INSTALL_DIR/nodewatch"

    if [ -d "$build_src/frontend/dist" ]; then
        echo -e "${CYAN}Updating frontend assets...${NC}"
        rm -rf "$INSTALL_DIR/dist"
        cp -r "$build_src/frontend/dist" "$INSTALL_DIR/dist"
    fi

    echo -e "${CYAN}Restarting service...${NC}"
    systemctl restart nodewatch
    sleep 1

    if systemctl is-active --quiet nodewatch; then
        echo -e "${GREEN}✔ NodeWatch updated and restarted successfully!${NC}"
    else
        echo -e "${RED}✖ NodeWatch update completed but service failed to start. View logs with option 5.${NC}"
    fi
    read_pause
}

uninstall_nodewatch() {
    print_banner
    echo -e "${RED}${BOLD}====================================================================${NC}"
    echo -e "${RED}${BOLD}                        UNINSTALL NODEWATCH                        ${NC}"
    echo -e "${RED}${BOLD}====================================================================${NC}"
    echo -e "This will stop and remove the NodeWatch central monitoring service."
    local confirm
    confirm=$(read_input "Are you sure you want to proceed? [y/N]: " "n")
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
        echo "Uninstall cancelled."
        sleep 1
        return
    fi

    echo -e "\n${YELLOW}Stopping and disabling service...${NC}"
    systemctl stop nodewatch 2>/dev/null || true
    systemctl disable nodewatch 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload

    local remove_db
    remove_db=$(read_input "Do you want to delete all stored metrics and database? [y/N]: " "n")
    if [[ "$remove_db" =~ ^[yY]$ ]]; then
        rm -rf "$INSTALL_DIR"
        echo -e "${GREEN}✔ Removed /opt/nodewatch and all database records.${NC}"
    else
        rm -f "$INSTALL_DIR/nodewatch"
        rm -rf "$INSTALL_DIR/dist"
        echo -e "${GREEN}✔ Removed binaries. Database preserved in $INSTALL_DIR/data.${NC}"
    fi

    rm -f "$BIN_LINK"
    echo -e "${GREEN}✔ NodeWatch service successfully uninstalled.${NC}"
    exit 0
}

# ------------------------------------------------------------------------------
# Dependency & Compiler Helpers
# ------------------------------------------------------------------------------

ensure_dependencies() {
    echo -e "${CYAN}Checking essential dependencies (curl, tar, git)...${NC}"
    local missing=()
    for cmd in curl tar git; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing+=("$cmd")
        fi
    done

    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${YELLOW}Installing missing packages: ${missing[*]}...${NC}"
        if command -v apt-get >/dev/null 2>&1; then
            apt-get update -y && apt-get install -y "${missing[@]}"
        elif command -v yum >/dev/null 2>&1; then
            yum install -y "${missing[@]}"
        elif command -v dnf >/dev/null 2>&1; then
            dnf install -y "${missing[@]}"
        elif command -v pacman >/dev/null 2>&1; then
            pacman -Sy --noconfirm "${missing[@]}"
        else
            echo -e "${RED}[ERROR] Please install: ${missing[*]}${NC}"
            exit 1
        fi
    fi
}

ensure_go() {
    export GOTOOLCHAIN=local
    export GOPROXY=https://proxy.golang.org,https://goproxy.io,direct
    if command -v go >/dev/null 2>&1; then
        return
    fi

    echo -e "${YELLOW}Go compiler not found. Installing Go automatically...${NC}"
    local ARCH
    ARCH=$(uname -m)
    local GOARCH="amd64"
    case $ARCH in
        x86_64) GOARCH="amd64" ;;
        aarch64|arm64) GOARCH="arm64" ;;
        armv7l|armhf) GOARCH="armv6l" ;;
    esac

    local GO_VERSION="1.22.4"
    local GO_TAR="go${GO_VERSION}.linux-${GOARCH}.tar.gz"
    echo -e "${CYAN}Downloading Go ${GO_VERSION} (${GOARCH})...${NC}"
    curl -fsSL -o "/tmp/$GO_TAR" "https://go.dev/dl/$GO_TAR" || {
        echo -e "${YELLOW}Falling back to package manager for Go...${NC}"
        if command -v apt-get >/dev/null 2>&1; then
            apt-get update -y && apt-get install -y golang
            return
        elif command -v yum >/dev/null 2>&1; then
            yum install -y golang
            return
        fi
    }

    tar -C /usr/local -xzf "/tmp/$GO_TAR"
    rm -f "/tmp/$GO_TAR"
    export PATH=$PATH:/usr/local/go/bin
    if ! grep -q '/usr/local/go/bin' /etc/profile; then
        echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile
    fi
    echo -e "${GREEN}✔ Go compiler ready: $(go version)${NC}"
}

# ------------------------------------------------------------------------------
# Full Installation Routine (First Time Run)
# ------------------------------------------------------------------------------

do_install() {
    print_banner
    echo -e "${BOLD}Starting NodeWatch Central Server Installation...${NC}\n"

    ensure_dependencies

    # Determine source directory
    local SOURCE_PATH=""
    if [ -d "./backend" ] && [ -f "./install.sh" ]; then
        SOURCE_PATH="."
    elif [ -d "$SRC_DIR/backend" ]; then
        SOURCE_PATH="$SRC_DIR"
        echo -e "${CYAN}Syncing latest changes from repository...${NC}"
        (cd "$SRC_DIR" && git fetch origin main 2>/dev/null && git reset --hard origin/main 2>/dev/null || git pull origin main 2>/dev/null || true)
    else
        echo -e "${CYAN}Cloning NodeWatch source repository...${NC}"
        mkdir -p "$SRC_DIR"
        if ! GIT_TERMINAL_PROMPT=0 git clone "$REPO_DEFAULT" "$SRC_DIR" 2>/dev/null; then
            echo -e "\n${YELLOW}------------------------------------------------------------${NC}"
            echo -e "${YELLOW}[!] ریپازیتوری شما در گیت‌هاب Private (خصوصی) است یا نیاز به دسترسی دارد.${NC}"
            echo -e "${CYAN}دو راه برای ادامه دارید:${NC}"
            echo -e " ۱) ریپازیتوری را در گیت‌هاب Public کنید (Settings -> Make Public)."
            echo -e " ۲) یا یک توکن GitHub Personal Access Token (PAT) وارد کنید."
            echo -e "${YELLOW}------------------------------------------------------------${NC}\n"
            local gh_token
            gh_token=$(read_input "Enter GitHub Token (یا اینتر بزنید برای تلاش مجدد): " "")
            if [ -n "$gh_token" ]; then
                git clone "https://${gh_token}@github.com/Amiir-Dark/Monitoriing.git" "$SRC_DIR"
            else
                git clone "$REPO_DEFAULT" "$SRC_DIR"
            fi
        fi
        SOURCE_PATH="$SRC_DIR"
    fi

    # Create target directories
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/data"
    mkdir -p "$INSTALL_DIR/data/backups"

    # Build binary
    echo -e "\n${CYAN}Compiling NodeWatch central binary...${NC}"
    ensure_go
    export GOTOOLCHAIN=local
    export GOPROXY=https://mirror-go.runflare.com,https://goproxy.io,direct
    go env -w GOPROXY=https://mirror-go.runflare.com,https://goproxy.io,direct 2>/dev/null || true
    local go_ver
    go_ver=$(go version | awk '{print $3}' | sed 's/go//' | cut -d'.' -f1,2)
    if [ -n "$go_ver" ]; then
        sed -i -E "s/go 1\.[0-9]+(\.[0-9]+)?/go ${go_ver}/" "$SOURCE_PATH/backend/go.mod" "$SOURCE_PATH/agent/go.mod" 2>/dev/null || true
    fi
    (cd "$SOURCE_PATH/backend" && CGO_ENABLED=0 go build -ldflags="-s -w" -o "$INSTALL_DIR/nodewatch" ./cmd/nodewatch)
    chmod +x "$INSTALL_DIR/nodewatch"

    # Copy frontend dist
    if [ -d "$SOURCE_PATH/frontend/dist" ]; then
        echo -e "${CYAN}Installing frontend dashboard assets...${NC}"
        rm -rf "$INSTALL_DIR/dist"
        cp -r "$SOURCE_PATH/frontend/dist" "$INSTALL_DIR/dist"
    fi

    # Generate random secret key
    local secret_key
    secret_key=$(head -c 32 /dev/urandom | base64 2>/dev/null || openssl rand -hex 32 2>/dev/null || echo "nodewatch-super-secret-key-32bytes!")

    # Ask for port
    echo -e "\n${BOLD}Configuration:${NC}"
    local user_port
    user_port=$(read_input "Enter port to run NodeWatch on [Default: 8080]: " "8080")
    local run_port="${PORT:-$user_port}"
    echo -e "Configured port: ${CYAN}${run_port}${NC}"

    # Create systemd service
    cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=NodeWatch Central Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/nodewatch -port $run_port -db $INSTALL_DIR/data/nodewatch.db -dist $INSTALL_DIR/dist -secret "$secret_key"
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

    # Copy install script to install dir & create symlink in /usr/local/bin
    cp "$SOURCE_PATH/install.sh" "$INSTALL_DIR/install.sh"
    chmod +x "$INSTALL_DIR/install.sh"
    ln -sf "$INSTALL_DIR/install.sh" "$BIN_LINK"

    echo -e "${CYAN}Reloading systemd and enabling service...${NC}"
    systemctl daemon-reload
    systemctl enable nodewatch
    systemctl restart nodewatch
    sleep 1

    local ip
    ip=$(get_public_ip)

    print_banner
    echo -e "${GREEN}${BOLD}====================================================================${NC}"
    echo -e "${GREEN}${BOLD}         ✔ NodeWatch Central Server Installed Successfully!         ${NC}"
    echo -e "${GREEN}${BOLD}====================================================================${NC}\n"
    echo -e "  🌐 ${BOLD}Dashboard URL:${NC}    ${CYAN}http://${ip}:${run_port}${NC}"
    echo -e "  👤 ${BOLD}Username:${NC}         ${WHITE}admin${NC}"
    echo -e "  🔑 ${BOLD}Password:${NC}         ${WHITE}admin123${NC}"
    echo -e "  ⚙️  ${BOLD}Management Command:${NC} ${YELLOW}nodewatch${NC} (run anywhere anytime)\n"
    echo -e "${BLUE}--------------------------------------------------------------------${NC}"
    echo -e "You can type ${BOLD}nodewatch${NC} in your terminal anytime to open the management menu."
    echo -e "${BLUE}====================================================================${NC}\n"
}

# ------------------------------------------------------------------------------
# Interactive Management Menu (Subsequent Runs)
# ------------------------------------------------------------------------------

show_menu() {
    while true; do
        print_banner
        local svc_status
        svc_status=$(get_service_status)
        local cur_port
        cur_port=$(get_current_port)
        local ip
        ip=$(get_public_ip)

        echo -e " Service Status: ${svc_status}  |  Port: ${CYAN}${cur_port}${NC}  |  Web: ${CYAN}http://${ip}:${cur_port}${NC}"
        echo -e "${BLUE}--------------------------------------------------------------------${NC}"
        echo -e "  ${BOLD}[1]${NC}  Status & Diagnostics       (مشاهده وضعیت و سلامت سرویس)"
        echo -e "  ${BOLD}[2]${NC}  Restart Service            (راه‌اندازی مجدد سرویس)"
        echo -e "  ${BOLD}[3]${NC}  Stop Service               (توقف سرویس)"
        echo -e "  ${BOLD}[4]${NC}  Start Service              (شروع به کار سرویس)"
        echo -e "  ${BOLD}[5]${NC}  View Real-Time Logs        (مشاهده لاگ‌های زنده journalctl)"
        echo -e "  ${BOLD}[6]${NC}  Update to Latest Version   (آپدیت سورس از گیت‌هاب و بیلد مجدد)"
        echo -e "  ${BOLD}[7]${NC}  Change Port                (تغییر پورت سرور مرکزی)"
        echo -e "  ${BOLD}[8]${NC}  Backup Database            (تهیه نسخه پشتیبان از دیتابیس)"
        echo -e "  ${BOLD}[9]${NC}  Reinstall NodeWatch        (نصب مجدد از اول)"
        echo -e "  ${BOLD}[10]${NC} Uninstall NodeWatch        (حذف کامل سرویس و برنامه‌ها)"
        echo -e "  ${BOLD}[0]${NC}  Exit                       (خروج)"
        echo -e "${BLUE}====================================================================${NC}"

        local choice
        choice=$(read_input "Select an option [0-10]: " "0")
        case $choice in
            1) show_status ;;
            2) restart_service ;;
            3) stop_service ;;
            4) start_service ;;
            5) view_logs ;;
            6) update_nodewatch ;;
            7) change_port ;;
            8) backup_database ;;
            9) do_install ;;
            10) uninstall_nodewatch ;;
            0) clear; exit 0 ;;
            *) echo -e "${RED}Invalid option.${NC}"; sleep 1 ;;
        esac
    done
}

# ------------------------------------------------------------------------------
# Entry Point
# ------------------------------------------------------------------------------

check_root

# Parse command line flags if provided
if [ "$1" == "--install" ] || [ "$1" == "-i" ]; then
    do_install
    exit 0
elif [ "$1" == "--menu" ] || [ "$1" == "-m" ]; then
    show_menu
    exit 0
elif [ "$1" == "--status" ]; then
    systemctl status nodewatch --no-pager
    exit 0
elif [ "$1" == "--restart" ]; then
    systemctl restart nodewatch
    exit 0
elif [ "$1" == "--update" ]; then
    update_nodewatch
    exit 0
elif [ "$1" == "--uninstall" ]; then
    uninstall_nodewatch
    exit 0
fi

# Automatic detection: First time vs Subsequent
if is_installed; then
    show_menu
else
    do_install
fi
