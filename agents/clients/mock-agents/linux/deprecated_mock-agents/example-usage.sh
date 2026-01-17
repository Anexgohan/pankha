#!/bin/bash
# Example Usage Script for Pankha Mock Agents

echo "========================================"
echo "  Pankha Mock Agents - Example Usage"
echo "========================================"
echo

# Check if websockets is installed
echo "1. Checking dependencies..."
if ! python3 -c "import websockets" 2>/dev/null; then
    echo "   ⚠️  websockets not installed"
    echo "   Installing: pip3 install websockets"
    pip3 install websockets
else
    echo "   ✅ Dependencies OK"
fi
echo

# Example 1: Interactive Mode
echo "2. Example: Interactive Mode"
echo "   Run: ./mock-agents --build"
echo "   (Guided wizard for configuration)"
echo

# Example 2: Quick Setup
echo "3. Example: Quick Setup (5 agents)"
echo "   Run: ./mock-agents --amount 5 --name client_ --sensors 5,9 --fans 3,7"
./mock-agents --amount 5 --name client_ --sensors 5,9 --fans 3,7
echo

# Example 3: Start agents
echo "4. Example: Start all agents"
echo "   Run: ./mock-agents --start"
./mock-agents --start
echo

# Example 4: Check status
echo "5. Example: Check status"
echo "   Run: ./mock-agents --status"
./mock-agents --status
echo

# Example 5: View logs
echo "6. Example: View logs"
echo "   Run: tail -20 logs/client_01.log"
if [ -f logs/client_01.log ]; then
    tail -20 logs/client_01.log
else
    echo "   (No logs yet - agents need to run first)"
fi
echo

# Example 6: Stop agents
echo "7. Example: Stop all agents"
echo "   Run: ./mock-agents --stop"
read -p "   Press Enter to stop agents (or Ctrl+C to keep running)..."
./mock-agents --stop
echo

echo "========================================"
echo "  Examples Complete!"
echo "========================================"
echo
echo "Next steps:"
echo "  - ./mock-agents --help     (Show all options)"
echo "  - ./mock-agents --status   (Check agent status)"
echo "  - tail -f logs/*.log       (Monitor all logs)"
echo
