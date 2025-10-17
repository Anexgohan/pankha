#!/bin/bash

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_SCRIPT="$SCRIPT_DIR/pankha-agent/pankha-agent.py"
CONFIG_FILE="/$SCRIPT_DIR/pankha-agent/config/config.json"
CONFIG_DIR="/$SCRIPT_DIR/pankha-agent/config"
LOG_FILE="/var/log/pankha-agent/agent.log"
LOG_DIR="/var/log/pankha-agent"
PID_FILE="/run/pankha-agent/pankha-agent.pid"
PID_DIR="/run/pankha-agent"
SYSTEMD_SERVICE="/etc/systemd/system/pankha-agent.service"

# Colors for output
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
NC="\033[0m" # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Dependency checker
check_dependencies() {
    local missing_required=()
    local missing_optional=()
    local all_ok=true

    log_header "Checking Dependencies"

    # Required dependencies
    if ! command -v python3 >/dev/null 2>&1; then
        missing_required+=("python3:Runs the agent and parses JSON configuration files")
        all_ok=false
    else
        log_info "✓ python3 found"
    fi

    if ! command -v awk >/dev/null 2>&1; then
        missing_required+=("awk:Validates decimal numbers in user input")
        all_ok=false
    else
        log_info "✓ awk found"
    fi

    if ! command -v sed >/dev/null 2>&1; then
        missing_required+=("sed:Processes configuration strings and URLs")
        all_ok=false
    else
        log_info "✓ sed found"
    fi

    # Optional dependencies
    if ! command -v timeout >/dev/null 2>&1; then
        missing_optional+=("coreutils:Provides timeout command for connection testing")
    else
        log_info "✓ timeout found (from coreutils)"
    fi

    if ! command -v nano >/dev/null 2>&1 && ! command -v vi >/dev/null 2>&1; then
        missing_optional+=("nano or vim:Allows editing configuration files interactively")
    else
        if command -v nano >/dev/null 2>&1; then
            log_info "✓ nano found"
        else
            log_info "✓ vi found"
        fi
    fi

    # Check Python packages (only if python3 is available)
    if command -v python3 >/dev/null 2>&1; then
        # Check for websockets library
        if ! python3 -c "import websockets" >/dev/null 2>&1; then
            log_warn "✗ Python package 'websockets' not found"
            log_info "Attempting to install websockets..."

            # Method 1: Try existing pip
            if command -v pip3 >/dev/null 2>&1; then
                if pip3 install websockets >/dev/null 2>&1; then
                    log_info "✓ websockets installed via pip3"
                fi
            elif python3 -m pip --version >/dev/null 2>&1; then
                if python3 -m pip install websockets >/dev/null 2>&1; then
                    log_info "✓ websockets installed via python3 -m pip"
                fi
            fi

            # Check if successful
            if python3 -c "import websockets" >/dev/null 2>&1; then
                log_info "✓ Python websockets library installed successfully"
            else
                # Method 2: Try installing python3-websockets package from distro
                log_info "Trying distro package python3-websockets..."
                if command -v apt-get >/dev/null 2>&1; then
                    if apt-get install -y python3-websockets >/dev/null 2>&1; then
                        log_info "✓ websockets installed via apt"
                    fi
                elif command -v yum >/dev/null 2>&1; then
                    if yum install -y python3-websockets >/dev/null 2>&1; then
                        log_info "✓ websockets installed via yum"
                    fi
                elif command -v dnf >/dev/null 2>&1; then
                    if dnf install -y python3-websockets >/dev/null 2>&1; then
                        log_info "✓ websockets installed via dnf"
                    fi
                fi

                # Check again
                if python3 -c "import websockets" >/dev/null 2>&1; then
                    log_info "✓ Python websockets library installed successfully"
                else
                    # Method 3: Bootstrap pip using ensurepip
                    log_info "Trying to bootstrap pip with ensurepip..."
                    if python3 -m ensurepip --default-pip >/dev/null 2>&1; then
                        log_info "✓ pip bootstrapped"
                        if python3 -m pip install websockets >/dev/null 2>&1; then
                            log_info "✓ websockets installed"
                        fi
                    fi

                    # Check again
                    if python3 -c "import websockets" >/dev/null 2>&1; then
                        log_info "✓ Python websockets library installed successfully"
                    else
                        # Method 4: Install pip package from distro, then websockets
                        log_info "Trying to install pip from package manager..."
                        local pip_installed=false

                        if command -v apt-get >/dev/null 2>&1; then
                            if apt-get install -y python3-pip >/dev/null 2>&1; then
                                pip_installed=true
                            fi
                        elif command -v yum >/dev/null 2>&1; then
                            if yum install -y python3-pip >/dev/null 2>&1; then
                                pip_installed=true
                            fi
                        elif command -v dnf >/dev/null 2>&1; then
                            if dnf install -y python3-pip >/dev/null 2>&1; then
                                pip_installed=true
                            fi
                        elif command -v pacman >/dev/null 2>&1; then
                            if pacman -S --noconfirm python-pip >/dev/null 2>&1; then
                                pip_installed=true
                            fi
                        fi

                        if $pip_installed; then
                            log_info "✓ pip installed from package manager"
                            if python3 -m pip install websockets >/dev/null 2>&1 || pip3 install websockets >/dev/null 2>&1; then
                                log_info "✓ websockets installed"
                            fi
                        fi

                        # Final verification
                        if ! python3 -c "import websockets" >/dev/null 2>&1; then
                            echo ""
                            log_error "Failed to install websockets library after trying all methods"
                            log_error "Please manually install using one of these commands:"
                            echo "  pip3 install websockets"
                            echo "  python3 -m pip install websockets"
                            echo "  apt-get install python3-websockets  # Debian/Ubuntu"
                            echo "  yum install python3-websockets      # RHEL/CentOS"
                            exit 1
                        fi
                    fi
                fi
            fi
        else
            log_info "✓ Python websockets library found"
        fi
    fi

    # Report missing dependencies
    if [[ ${#missing_required[@]} -gt 0 ]]; then
        echo ""
        log_error "Missing REQUIRED dependencies:"
        for dep in "${missing_required[@]}"; do
            IFS=':' read -r pkg reason <<< "$dep"
            echo "  ❌ $pkg - $reason"
        done

        echo ""
        log_info "Install missing dependencies:"

        # Detect OS and provide install command
        if command -v apt-get >/dev/null 2>&1; then
            local packages=$(printf '%s\n' "${missing_required[@]}" | cut -d: -f1 | tr '\n' ' ')
            echo "  sudo apt-get update && sudo apt-get install -y $packages"
        elif command -v yum >/dev/null 2>&1; then
            local packages=$(printf '%s\n' "${missing_required[@]}" | cut -d: -f1 | tr '\n' ' ')
            echo "  sudo yum install -y $packages"
        elif command -v dnf >/dev/null 2>&1; then
            local packages=$(printf '%s\n' "${missing_required[@]}" | cut -d: -f1 | tr '\n' ' ')
            echo "  sudo dnf install -y $packages"
        elif command -v pacman >/dev/null 2>&1; then
            local packages=$(printf '%s\n' "${missing_required[@]}" | cut -d: -f1 | tr '\n' ' ')
            echo "  sudo pacman -S $packages"
        else
            echo "  (Unable to detect package manager - please install manually)"
        fi

        echo ""
        read -p "Would you like to install missing dependencies now? [y/N]: " install_now
        if [[ "$install_now" =~ ^[Yy] ]]; then
            if command -v apt-get >/dev/null 2>&1; then
                local packages=$(printf '%s\n' "${missing_required[@]}" | cut -d: -f1 | tr '\n' ' ')
                apt-get update && apt-get install -y $packages
            elif command -v yum >/dev/null 2>&1; then
                local packages=$(printf '%s\n' "${missing_required[@]}" | cut -d: -f1 | tr '\n' ' ')
                yum install -y $packages
            elif command -v dnf >/dev/null 2>&1; then
                local packages=$(printf '%s\n' "${missing_required[@]}" | cut -d: -f1 | tr '\n' ' ')
                dnf install -y $packages
            elif command -v pacman >/dev/null 2>&1; then
                local packages=$(printf '%s\n' "${missing_required[@]}" | cut -d: -f1 | tr '\n' ' ')
                pacman -S --noconfirm $packages
            else
                log_error "Cannot auto-install - package manager not detected"
                exit 1
            fi
            log_info "Dependencies installed. Please re-run this script."
            exit 0
        else
            log_error "Cannot proceed without required dependencies"
            exit 1
        fi
    fi

    # Optional dependencies warning
    if [[ ${#missing_optional[@]} -gt 0 ]]; then
        echo ""
        log_warn "Missing optional dependencies (script will work, but with reduced functionality):"
        for dep in "${missing_optional[@]}"; do
            IFS=':' read -r pkg reason <<< "$dep"
            echo "  ⚠️  $pkg - $reason"
        done
    fi

    if $all_ok && [[ ${#missing_optional[@]} -eq 0 ]]; then
        echo ""
        log_info "All dependencies satisfied! ✓"
    fi

    echo ""
}

create_directories() {
    # Create necessary directories
    mkdir -p "$CONFIG_DIR" "$LOG_DIR" "$PID_DIR"

    # Set appropriate permissions
    chmod 755 "$CONFIG_DIR" "$LOG_DIR" "$PID_DIR"
}

get_pid() {
    if [[ -f "$PID_FILE" ]]; then
        cat "$PID_FILE"
    else
        echo ""
    fi
}

is_running() {
    local pid=$(get_pid)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Interactive setup function
interactive_setup() {
    log_header "Pankha Agent Interactive Setup"

    create_directories

    echo "This will guide you through configuring your Pankha agent."
    echo "Values in [brackets] are defaults - press Enter to use them."
    echo ""

    # Get current settings or defaults
    local current_server_ip="192.168.100.237:3000"
    local current_interval="10"
    local current_name="$(hostname)"
    local current_fan_control="true"

    if [[ -f "$CONFIG_FILE" ]]; then
        log_info "Found existing configuration file"
        # Extract IP:PORT from existing WebSocket URL
        local full_url=$(python3 -c "
import json, sys
try:
    with open(\"$CONFIG_FILE\") as f: config = json.load(f)
    print(config.get(\"backend\", {}).get(\"server_url\", \"ws://192.168.100.237:3000/websocket\"))
except: print(\"ws://192.168.100.237:3000/websocket\")
" 2>/dev/null)
        # Strip ws:// or wss:// and /websocket to get just IP:PORT
        current_server_ip=$(echo "$full_url" | sed -E 's|^wss?://||' | sed 's|/websocket$||')

        current_interval=$(python3 -c "
import json, sys
try:
    with open(\"$CONFIG_FILE\") as f: config = json.load(f)
    print(config.get(\"agent\", {}).get(\"update_interval\", \"$current_interval\"))
except: print(\"$current_interval\")
" 2>/dev/null)
    fi

    # Server IP:PORT with strict validation
    while true; do
        read -e -p "Enter Pankha server IP:PORT [$current_server_ip]: " server_input
        server_input=${server_input:-$current_server_ip}

        # STRICT validation: should be in format IP:PORT or hostname:PORT (no extra characters)
        if [[ "$server_input" =~ ^[a-zA-Z0-9.-]+:[0-9]+$ ]]; then
            server_ip_port=$server_input
            # Construct full WebSocket URL automatically
            server_url="ws://${server_ip_port}/websocket"
            log_info "WebSocket URL will be: $server_url"
            break
        else
            log_error "Invalid format: '$server_input'"
            log_error "Please enter IP:PORT only (e.g., 192.168.1.100:3000)"
            log_error "Do not include ws://, brackets, or /websocket"
        fi
    done

    # Update interval with validation (FIXED: using awk instead of bc)
    while true; do
        read -e -p "Enter update interval in seconds [$current_interval]: " interval_input
        interval_input=${interval_input:-$current_interval}

        # Validate: must be a positive number (allow decimals)
        if [[ "$interval_input" =~ ^[0-9]+\.?[0-9]*$ ]] && awk -v n="$interval_input" 'BEGIN { if (n > 0) exit 0; else exit 1 }' 2>/dev/null; then
            update_interval=$interval_input
            break
        else
            log_error "Invalid input. Please enter a positive number (e.g., 0.5, 1, 3, 10)"
        fi
    done

    # Agent name
    read -e -p "Enter agent name [$current_name]: " name_input
    agent_name=${name_input:-$current_name}

    # Fan control - default to NO (safer)
    read -e -p "Enable fan control? [y/N]: " fan_input
    if [[ "$fan_input" =~ ^[Yy] ]]; then
        fan_control="true"
    else
        fan_control="false"
    fi

    # Fan safety minimum with validation
    while true; do
        read -e -p "Fan safety minimum percentage (0-100%, default 30, 0=allow stop): " fan_min_input
        fan_min_input=${fan_min_input:-30}

        # Validate: must be integer between 0-100
        if [[ "$fan_min_input" =~ ^[0-9]+$ ]] && [ "$fan_min_input" -ge 0 ] && [ "$fan_min_input" -le 100 ]; then
            fan_min=$fan_min_input

            # Warn if user sets to 0
            if [[ "$fan_min" -eq 0 ]]; then
                echo "⚠️  WARNING: Fans can completely stop. Ensure adequate passive cooling!"
                read -e -p "Are you sure? [y/N]: " confirm
                if [[ ! "$confirm" =~ ^[Yy] ]]; then
                    fan_min=30
                    log_info "Reset to safe default: 30%"
                fi
            fi
            break
        else
            log_error "Invalid input. Please enter a number between 0 and 100"
        fi
    done

    # Sensor deduplication - default to YES (recommended)
    read -e -p "Filter duplicate sensors (removes duplicate temperature sensors)? [Y/n]: " dedup_input
    if [[ "$dedup_input" =~ ^[Nn] ]]; then
        sensor_dedup="false"
    else
        sensor_dedup="true"
    fi

    # Duplicate sensor tolerance with validation (FIXED: using awk instead of bc)
    while true; do
        read -e -p "Duplicate sensor tolerance in °C (default 0.5): " dedup_tolerance_input
        dedup_tolerance_input=${dedup_tolerance_input:-0.5}

        # Validate: must be a positive number (allow decimals)
        if [[ "$dedup_tolerance_input" =~ ^[0-9]+\.?[0-9]*$ ]] && awk -v n="$dedup_tolerance_input" 'BEGIN { if (n > 0) exit 0; else exit 1 }' 2>/dev/null; then
            dedup_tolerance=$dedup_tolerance_input
            break
        else
            log_error "Invalid input. Please enter a positive number (e.g., 0.5, 1.0, 2.0)"
        fi
    done

    # Create configuration
    log_info "Creating configuration..."
    cat > "$CONFIG_FILE" << EOL
{
  "agent": {
    "id": "linux-agent-$(hostname)",
    "name": "$agent_name",
    "update_interval": $update_interval,
    "log_level": "INFO"
  },
  "backend": {
    "server_url": "$server_url",
    "reconnect_interval": 30.0,
    "max_reconnect_attempts": -1,
    "connection_timeout": 10.0
  },
  "hardware": {
    "enable_fan_control": $fan_control,
    "enable_sensor_monitoring": true,
    "fan_safety_minimum": $fan_min,
    "temperature_critical": 85.0,
    "duplicate_sensor_tolerance": $dedup_tolerance,
    "filter_duplicate_sensors": $sensor_dedup
  },
  "logging": {
    "enable_file_logging": true,
    "log_file": "$LOG_FILE",
    "max_log_size_mb": 10,
    "log_retention_days": 7
  }
}
EOL

    chmod 644 "$CONFIG_FILE"
    log_info "Configuration saved to $CONFIG_FILE"

    # Test the configuration
    echo ""
    echo "Testing configuration..."
    test_connection_internal

    echo ""
    log_info "Setup complete! You can now:"
    echo "  - Start the agent: pankha-agent.sh start"
    echo "  - Edit config: pankha-agent.sh config"
    echo "  - Test connection: pankha-agent.sh test-connection"
}

# Config file editor
config_editor() {
    log_header "Pankha Agent Configuration Editor"

    create_directories

    # Create default config if it doesn""t exist
    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_info "Creating default configuration file..."
        interactive_setup
        return
    fi

    log_info "Opening configuration file: $CONFIG_FILE"
    echo "Save and exit when done editing."
    echo ""

    # Use the best available editor
    if command -v nano >/dev/null 2>&1; then
        nano "$CONFIG_FILE"
    elif command -v vi >/dev/null 2>&1; then
        vi "$CONFIG_FILE"
    else
        log_error "No text editor found (nano or vi required)"
        return 1
    fi

    # Validate the configuration
    log_info "Validating configuration..."
    if python3 "$SCRIPT_DIR/config.py" validate >/dev/null 2>&1; then
        log_info "Configuration is valid"
    else
        log_warn "Configuration validation failed. Please check syntax."
    fi
}

# Test connection function
test_connection() {
    log_header "Pankha Agent Connection Test"
    test_connection_internal
}

test_connection_internal() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_error "Configuration file not found. Run: pankha-agent.sh setup"
        return 1
    fi

    log_info "Testing hardware discovery..."
    cd "$SCRIPT_DIR"

    # Test sensor discovery
    if python3 sensor_discovery.py >/dev/null 2>&1; then
        sensors_count=$(python3 sensor_discovery.py 2>/dev/null | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('sensor_count', '?'))" 2>/dev/null || echo "?")
        log_info "✓ Discovered $sensors_count temperature sensors"
    else
        log_warn "✗ Sensor discovery failed"
    fi

    # Test fan control
    if python3 fan_control.py >/dev/null 2>&1; then
        fans_count=$(python3 fan_control.py 2>/dev/null | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('fan_count', '?'))" 2>/dev/null || echo "?")
        log_info "✓ Discovered $fans_count controllable fans"
    else
        log_warn "✗ Fan control discovery failed"
    fi

    # Test system info
    if python3 system_info.py >/dev/null 2>&1; then
        cpu_model=$(python3 system_info.py 2>/dev/null | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('cpu', {}).get('model_name', 'Unknown'))" 2>/dev/null || echo "Unknown")
        log_info "✓ System: $cpu_model"
    else
        log_warn "✗ System information gathering failed"
    fi

    # Test server connection
    log_info "Testing server connection..."
    server_url=$(python3 -c "
import json
try:
    with open(\"$CONFIG_FILE\") as f: config = json.load(f)
    print(config.get(\"backend\", {}).get(\"server_url\", \"unknown\"))
except: print(\"unknown\")
" 2>/dev/null)

    if [[ "$server_url" != "unknown" ]]; then
        # Extract host and port from WebSocket URL
        host=$(echo "$server_url" | sed -E "s#ws://([^/:]+).*#\1#")
        port=$(echo "$server_url" | sed -E "s#ws://[^:]+:([0-9]+).*#\1#")

        if timeout 5 bash -c "</dev/tcp/$host/$port" 2>/dev/null; then
            log_info "✓ Server is reachable at $host:$port"
        else
            log_warn "✗ Cannot reach server at $host:$port"
        fi
    else
        log_warn "✗ Invalid server URL in configuration"
    fi
}

# Start function
start_agent() {
    log_header "Starting Pankha Agent"

    if is_running; then
        log_warn "Agent is already running (PID: $(get_pid))"
        return 1
    fi

    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_error "Configuration file not found. Run: pankha-agent.sh setup"
        return 1
    fi

    create_directories

    # Start the agent
    cd "$SCRIPT_DIR"
    nohup python3 "$AGENT_SCRIPT" > "$LOG_FILE" 2>&1 &
    local pid=$!

    # Save PID
    echo $pid > "$PID_FILE"

    # Wait a moment to check if it started successfully
    sleep 2
    if is_running; then
        log_info "Agent started successfully (PID: $pid)"
        log_info "Logs: tail -f $LOG_FILE"
    else
        log_error "Failed to start agent. Check logs: $LOG_FILE"
        return 1
    fi
}

# Stop function
stop_agent() {
    log_header "Stopping Pankha Agent"

    if ! is_running; then
        log_warn "Agent is not running"
        return 1
    fi

    local pid=$(get_pid)
    log_info "Stopping agent (PID: $pid)"

    # Send SIGTERM
    kill "$pid" 2>/dev/null

    # Wait for graceful shutdown
    for i in {1..10}; do
        if ! is_running; then
            break
        fi
        sleep 1
    done

    # Force kill if necessary
    if is_running; then
        log_warn "Force killing agent"
        kill -9 "$pid" 2>/dev/null
    fi

    # Clean up PID file
    rm -f "$PID_FILE"
    log_info "Agent stopped"
}

# Status function
status_agent() {
    log_header "Pankha Agent Status"

    if is_running; then
        local pid=$(get_pid)
        log_info "Agent is running (PID: $pid)"

        # Show some runtime info
        if [[ -f "$LOG_FILE" ]]; then
            echo "Last 5 log entries:"
            tail -5 "$LOG_FILE" 2>/dev/null | sed "s/^/  /"
        fi
    else
        log_warn "Agent is not running"
    fi

    # Show configuration info
    if [[ -f "$CONFIG_FILE" ]]; then
        echo ""
        echo "Configuration:"
        python3 -c "
import json
try:
    with open(\"$CONFIG_FILE\") as f: config = json.load(f)
    print(f\"  Server: {config.get(\"backend\", {}).get(\"server_url\", \"unknown\")}\")
    print(f\"  Update Interval: {config.get(\"agent\", {}).get(\"update_interval\", \"unknown\")}s\")
    print(f\"  Agent Name: {config.get(\"agent\", {}).get(\"name\", \"unknown\")}\")
except Exception as e: print(f\"  Error reading config: {e}\")
" 2>/dev/null
    else
        echo "No configuration file found"
    fi
}

# Logs function
show_logs() {
    if [[ -f "$LOG_FILE" ]]; then
        tail -f "$LOG_FILE"
    else
        log_error "Log file not found: $LOG_FILE"
    fi
}

# Main script logic
case "$1" in
    start)
        check_root
        check_dependencies
        start_agent
        ;;
    stop)
        check_root
        stop_agent
        ;;
    restart)
        check_root
        stop_agent
        sleep 1
        start_agent
        ;;
    status)
        status_agent
        ;;
    logs)
        show_logs
        ;;
    setup)
        check_root
        check_dependencies
        interactive_setup
        ;;
    config)
        check_root
        config_editor
        ;;
    test-connection)
        test_connection
        ;;
    *)
        echo "Pankha Agent Control Script"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|logs|setup|config|test-connection}"
        echo ""
        echo "Commands:"
        echo "  start           Start the agent daemon"
        echo "  stop            Stop the agent daemon"
        echo "  restart         Restart the agent daemon"
        echo "  status          Show agent status and configuration"
        echo "  logs            Show real-time agent logs"
        echo "  setup           Interactive configuration setup"
        echo "  config          Edit configuration file"
        echo "  test-connection Test hardware discovery and server connection"
        echo ""
        exit 1
        ;;
esac

exit $?
