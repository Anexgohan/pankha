#!/bin/bash

# Pankha Mock Agents - Setup Script
# Handles venv creation and dependency installation for systems with PEP 668 (externally managed envs)

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_ROOT/venv"

echo -e "\033[1;34m======================================================================\033[0m"
echo -e "\033[1m  Pankha Mock Agents - Automated Setup\033[0m"
echo -e "\033[1;34m======================================================================\033[0m"

# 1. Check for python3-venv
if ! dpkg -l | grep -q "python3-venv"; then
    echo -e "\n\033[1;33m⚠️  Package 'python3-venv' is missing.\033[0m"
    echo -e "Trying to install it now (may require sudo)..."
    if command -v sudo >/dev/null 2>&1; then
        sudo apt update && sudo apt install python3-venv -y
    else
        apt update && apt install python3-venv -y
    fi
fi

# 2. Create Virtual Environment
if [ ! -d "$VENV_DIR" ]; then
    echo -e "\n\033[1;32m📦 Creating local virtual environment (venv)...\033[0m"
    python3 -m venv "$VENV_DIR"
else
    echo -e "\n\033[1;32m✅ Local virtual environment already exists.\033[0m"
fi

# 3. Install/Upgrade Dependencies
echo -e "\n\033[1;32m📦 Installing/Upgrading websockets library...\033[0m"
"$VENV_DIR/bin/python3" -m pip install --upgrade websockets

echo -e "\n\033[1;34m======================================================================\033[0m"
echo -e "\033[1;32m✅ Setup Complete!\033[0m"
echo -e "\033[1;34m======================================================================\033[0m"
echo -e "\nYou can now run the swarm using the portable wrapper:"
echo -e "\033[1m  ./mock-agents --status\033[0m\n"
