"""
Pankha Mock Agents - CLI Module

Command-line interface for managing mock agent swarm.
Supports: --build, --start, --stop, --status, --restart, --check-deps
"""

import argparse
import json
import os
import random
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ============================================================================
# CONSTANTS
# ============================================================================

SCRIPT_DIR = Path(__file__).parent.parent.absolute()
DATA_DIR = SCRIPT_DIR / "data"
LOGS_DIR = SCRIPT_DIR / "logs"
RUNTIME_DIR = SCRIPT_DIR / "runtime"

AGENTS_CONFIG_FILE = DATA_DIR / "agents.json"
STATUS_FILE = DATA_DIR / "status.json"
PID_FILE = RUNTIME_DIR / "swarm.pid"

DEFAULT_SERVER = "ws://192.168.100.237:3000/websocket"

# ============================================================================
# COLORS
# ============================================================================

class Colors:
    """ANSI color codes for terminal output."""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    GRAY = "\033[90m"


def colorize(text: str, color: str) -> str:
    """Add color to text."""
    return f"{color}{text}{Colors.RESET}"


# ============================================================================
# DEPENDENCY CHECK
# ============================================================================

def check_dependencies() -> bool:
    """Check and optionally install required dependencies."""
    print(colorize("\n🔍 Checking dependencies...\n", Colors.CYAN))
    
    # Check Python version
    py_version = sys.version_info
    if py_version < (3, 7):
        print(colorize(f"❌ Python 3.7+ required (found {py_version.major}.{py_version.minor})", Colors.RED))
        return False
    
    print(f"  ✅ Python {py_version.major}.{py_version.minor}.{py_version.micro}: {colorize(sys.executable, Colors.GREEN)}")
    
    # Check websockets
    try:
        import websockets
        print(f"  ✅ websockets library: {colorize('installed', Colors.GREEN)}")
    except ImportError:
        print(f"  ❌ websockets library: {colorize('not installed', Colors.RED)}")
        
        # Offer to install
        print()
        install = input(colorize("Install websockets now? [Y/n]: ", Colors.BOLD)).strip().lower()
        if install and install != 'y':
            print(colorize("\n⚠️  Please install manually: pip3 install websockets\n", Colors.YELLOW))
            return False
        
        print(colorize("\n📦 Installing websockets...", Colors.CYAN))
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "websockets"],
                capture_output=True,
                text=True,
                timeout=60
            )
            if result.returncode == 0:
                print(colorize("  ✅ websockets installed successfully\n", Colors.GREEN))
            else:
                print(colorize(f"  ❌ Installation failed: {result.stderr}\n", Colors.RED))
                return False
        except Exception as e:
            print(colorize(f"  ❌ Installation error: {e}\n", Colors.RED))
            return False
    
    print(colorize("\n✅ All dependencies satisfied\n", Colors.GREEN))
    return True


# ============================================================================
# CONFIG MANAGEMENT
# ============================================================================

def load_config() -> Dict:
    """Load agents configuration."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    if not AGENTS_CONFIG_FILE.exists():
        return {"agents": [], "default_server": DEFAULT_SERVER}
    
    with open(AGENTS_CONFIG_FILE, 'r') as f:
        return json.load(f)


def save_config(config: Dict):
    """Save agents configuration."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(AGENTS_CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)


def create_agents(
    amount: int,
    name_prefix: str,
    sensors: Tuple[int, int],
    fans: Tuple[int, int],
    temp: Tuple[int, int],
    rpm: Tuple[int, int],
    server_url: str
) -> List[Dict]:
    """Create agent configurations."""
    config = load_config()
    config["default_server"] = server_url
    config["agents"] = []
    
    for i in range(1, amount + 1):
        agent_name = f"{name_prefix}{i:02d}"
        agent_id = f"mock-{agent_name}-{uuid.uuid4().hex[:8]}"
        
        sensor_count = random.randint(sensors[0], sensors[1])
        fan_count = random.randint(fans[0], fans[1])
        
        agent_config = {
            "agent_id": agent_id,
            "agent_name": agent_name,
            "server_url": server_url,
            "update_interval": 3.0,
            "sensor_count": sensor_count,
            "fan_count": fan_count,
            "temp_range": list(temp),
            "speed_range": [0, 100],
            "rpm_range": list(rpm),
            "fan_step_percent": 5,
            "hysteresis_temp": 3.0,
            "emergency_temp": 85.0,
            "failsafe_speed": 70,
            "log_level": "INFO",
            "enable_fan_control": True,
        }
        config["agents"].append(agent_config)
    
    save_config(config)
    return config["agents"]


# ============================================================================
# PROCESS MANAGEMENT
# ============================================================================

def is_swarm_running() -> Tuple[bool, Optional[int]]:
    """Check if swarm process is running."""
    if not PID_FILE.exists():
        return False, None
    
    try:
        pid = int(PID_FILE.read_text().strip())
        
        # Check if process exists
        try:
            os.kill(pid, 0)
            return True, pid
        except OSError:
            # Stale PID file
            PID_FILE.unlink()
            return False, None
    
    except (ValueError, IOError):
        return False, None


def start_swarm() -> bool:
    """Start the swarm process as a daemon."""
    running, pid = is_swarm_running()
    if running:
        print(colorize(f"⚠️  Swarm already running (PID: {pid})", Colors.YELLOW))
        return False
    
    config = load_config()
    agents = config.get("agents", [])
    
    if not agents:
        print(colorize("⚠️  No agents configured. Run --build first.", Colors.YELLOW))
        return False
    
    print(colorize(f"\n🚀 Starting swarm with {len(agents)} agents...\n", Colors.BOLD))
    
    # Ensure directories exist
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    
    # Start swarm process
    try:
        # Import and run swarm
        swarm_script = SCRIPT_DIR / "src" / "swarm.py"
        
        process = subprocess.Popen(
            [sys.executable, "-c", f"""
import sys
sys.path.insert(0, '{SCRIPT_DIR / "src"}')
from swarm import run_swarm
from pathlib import Path
run_swarm(Path('{SCRIPT_DIR}'))
"""],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
        
        # Wait a moment for startup
        time.sleep(1.0)
        
        # Check if started successfully
        if process.poll() is not None:
            print(colorize("❌ Swarm failed to start", Colors.RED))
            return False
        
        print(colorize(f"✅ Swarm started (PID: {process.pid})", Colors.GREEN))
        print(colorize(f"   {len(agents)} agents connecting...\n", Colors.GRAY))
        print(f"Use {colorize('--status', Colors.CYAN)} to check connection status")
        print(f"Use {colorize('--stop', Colors.CYAN)} to stop all agents\n")
        return True
    
    except Exception as e:
        print(colorize(f"❌ Failed to start swarm: {e}", Colors.RED))
        return False


def stop_swarm() -> bool:
    """Stop the running swarm."""
    running, pid = is_swarm_running()
    
    if not running:
        print(colorize("⚠️  Swarm is not running", Colors.YELLOW))
        return False
    
    print(colorize(f"🛑 Stopping swarm (PID: {pid})...", Colors.BOLD))
    
    try:
        import signal
        os.kill(pid, signal.SIGTERM)
        
        # Wait for graceful shutdown
        for i in range(50):  # 5 seconds max
            try:
                os.kill(pid, 0)
                time.sleep(0.1)
            except OSError:
                break
        else:
            # Force kill
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        
        # Clean up PID file
        if PID_FILE.exists():
            PID_FILE.unlink()
        
        print(colorize("✅ Swarm stopped\n", Colors.GREEN))
        return True
    
    except Exception as e:
        print(colorize(f"❌ Failed to stop: {e}", Colors.RED))
        return False


def show_status():
    """Show swarm status."""
    running, pid = is_swarm_running()
    config = load_config()
    agents = config.get("agents", [])
    server_url = config.get("default_server", "N/A")
    
    print(colorize("\n" + "=" * 70, Colors.BLUE))
    print(colorize("  Pankha Mock Agents - Swarm Status", Colors.BOLD))
    print(colorize("=" * 70 + "\n", Colors.BLUE))
    
    print(f"  Server URL: {colorize(server_url, Colors.CYAN)}")
    print(f"  Configured Agents: {colorize(str(len(agents)), Colors.CYAN)}")
    
    if running:
        print(f"  Process: {colorize(f'RUNNING (PID: {pid})', Colors.GREEN)}")
        
        # Read status file
        if STATUS_FILE.exists():
            try:
                with open(STATUS_FILE, 'r') as f:
                    status = json.load(f)
                
                connected = status.get("connected", 0)
                total = status.get("total", 0)
                
                conn_color = Colors.GREEN if connected == total else Colors.YELLOW
                print(f"  Connections: {colorize(f'{connected}/{total} connected', conn_color)}")
                
                if status.get("started_at"):
                    print(f"  Started: {colorize(status['started_at'][:19], Colors.GRAY)}")
                
            except Exception:
                pass
    else:
        print(f"  Process: {colorize('STOPPED', Colors.RED)}")
    
    print(colorize("\n  Configured Agents:", Colors.BOLD))
    print(colorize("  " + "-" * 66, Colors.GRAY))
    
    # Show agent list (max 20)
    for i, agent in enumerate(agents[:20]):
        name = agent["agent_name"]
        sensors = agent["sensor_count"]
        fans = agent["fan_count"]
        hw_info = colorize(f"S:{sensors} F:{fans}", Colors.GRAY)
        print(f"  {name:20s}  {hw_info}")
    
    if len(agents) > 20:
        print(colorize(f"  ... and {len(agents) - 20} more agents", Colors.GRAY))
    
    print(colorize("  " + "-" * 66, Colors.GRAY))
    
    print(f"\n  Log File: {colorize(str(LOGS_DIR / 'swarm.log'), Colors.GRAY)}\n")
    print(colorize("=" * 70 + "\n", Colors.BLUE))


# ============================================================================
# INTERACTIVE BUILD
# ============================================================================

def interactive_build():
    """Interactive agent configuration wizard."""
    print(colorize("\n" + "=" * 70, Colors.CYAN))
    print(colorize("  Pankha Mock Agent Builder - Swarm Mode", Colors.BOLD))
    print(colorize("=" * 70 + "\n", Colors.CYAN))
    
    print("This wizard will configure mock agents for scaled testing.\n")
    
    # Server URL
    config = load_config()
    default_server = config.get("default_server", DEFAULT_SERVER)
    server_input = input(f"Server WebSocket URL [{default_server}]: ").strip()
    server_url = server_input if server_input else default_server
    
    # Number of agents
    while True:
        try:
            amount = int(input("\nHow many mock agents? [5]: ").strip() or "5")
            if amount < 1 or amount > 1000:
                print(colorize("  ⚠️  Please enter 1-1000", Colors.YELLOW))
                continue
            break
        except ValueError:
            print(colorize("  ⚠️  Please enter a valid number", Colors.YELLOW))
    
    # Name prefix
    name_prefix = input("\nAgent name prefix [client_]: ").strip() or "client_"
    
    # Sensor range
    while True:
        try:
            sensors_input = input("Sensor count range (min,max) [5,15]: ").strip() or "5,15"
            sensors = tuple(map(int, sensors_input.split(',')))
            if len(sensors) != 2 or sensors[0] < 1 or sensors[1] < sensors[0]:
                print(colorize("  ⚠️  Invalid range. Use: min,max", Colors.YELLOW))
                continue
            break
        except ValueError:
            print(colorize("  ⚠️  Invalid format. Use: min,max", Colors.YELLOW))
    
    # Temperature range
    while True:
        try:
            temp_input = input("Sensor temperature range °C (min,max) [25,95]: ").strip() or "25,95"
            temp = tuple(map(int, temp_input.split(',')))
            if len(temp) != 2 or temp[0] < 0 or temp[1] < temp[0]:
                print(colorize("  ⚠️  Invalid range", Colors.YELLOW))
                continue
            break
        except ValueError:
            print(colorize("  ⚠️  Invalid format", Colors.YELLOW))
    
    # Fan range
    while True:
        try:
            fans_input = input("Fan count range (min,max) [3,7]: ").strip() or "3,7"
            fans = tuple(map(int, fans_input.split(',')))
            if len(fans) != 2 or fans[0] < 1 or fans[1] < fans[0]:
                print(colorize("  ⚠️  Invalid range", Colors.YELLOW))
                continue
            break
        except ValueError:
            print(colorize("  ⚠️  Invalid format", Colors.YELLOW))
    
    # RPM range
    while True:
        try:
            rpm_input = input("Fan RPM range (min,max) [0,5000]: ").strip() or "0,5000"
            rpm = tuple(map(int, rpm_input.split(',')))
            if len(rpm) != 2 or rpm[0] < 0 or rpm[1] < rpm[0]:
                print(colorize("  ⚠️  Invalid range", Colors.YELLOW))
                continue
            break
        except ValueError:
            print(colorize("  ⚠️  Invalid format", Colors.YELLOW))
    
    # Summary
    print(colorize("\n" + "=" * 70, Colors.CYAN))
    print(colorize("  Configuration Summary", Colors.BOLD))
    print(colorize("=" * 70 + "\n", Colors.CYAN))
    print(f"  Server URL:        {colorize(server_url, Colors.CYAN)}")
    print(f"  Agent Count:       {colorize(str(amount), Colors.CYAN)}")
    print(f"  Name Prefix:       {colorize(name_prefix, Colors.CYAN)}")
    print(f"  Sensor Range:      {colorize(f'{sensors[0]}-{sensors[1]}', Colors.CYAN)}")
    print(f"  Temperature Range: {colorize(f'{temp[0]}-{temp[1]}°C', Colors.CYAN)}")
    print(f"  Fan Range:         {colorize(f'{fans[0]}-{fans[1]}', Colors.CYAN)}")
    print(f"  RPM Range:         {colorize(f'{rpm[0]}-{rpm[1]}', Colors.CYAN)}")
    print()
    
    # Confirm
    confirm = input("Create these agents? [Y/n]: ").strip().lower()
    if confirm and confirm != 'y':
        print(colorize("\n❌ Cancelled\n", Colors.RED))
        return
    
    # Stop existing swarm if running
    running, _ = is_swarm_running()
    if running:
        print(colorize("\n⚠️  Stopping existing swarm first...", Colors.YELLOW))
        stop_swarm()
    
    # Create agents
    print(colorize("\n✨ Creating agents...\n", Colors.GREEN))
    agents = create_agents(amount, name_prefix, sensors, fans, temp, rpm, server_url)
    print(colorize(f"✅ Created {len(agents)} mock agents\n", Colors.GREEN))
    
    # Offer to start
    start_now = input("Start swarm now? [Y/n]: ").strip().lower()
    if not start_now or start_now == 'y':
        start_swarm()


# ============================================================================
# HELP
# ============================================================================

def show_help():
    """Show help message."""
    help_text = f"""
{colorize('=' * 70, Colors.CYAN)}
{colorize('  Pankha Mock Agents - Swarm Mode (v2.0)', Colors.BOLD)}
{colorize('=' * 70, Colors.CYAN)}

{colorize('DESCRIPTION:', Colors.BOLD)}
  Run multiple mock Pankha agents in a single process for scaled testing.
  Agents connect via WebSocket and behave identically to real agents.

{colorize('USAGE:', Colors.BOLD)}
  mock-agents [OPTIONS]

{colorize('COMMANDS:', Colors.BOLD)}
  -b, --build        Interactive configuration wizard
  --start            Start the agent swarm (background daemon)
  --stop             Stop the running swarm
  --status           Show swarm status
  --restart          Restart the swarm
  --check-deps       Check and install dependencies
  -h, --help         Show this help message

{colorize('EXAMPLES:', Colors.BOLD)}
  # Configure and start 25 agents
  mock-agents --build

  # Check status
  mock-agents --status

  # Stop all agents
  mock-agents --stop

{colorize('FILES:', Colors.BOLD)}
  Config:    {DATA_DIR / 'agents.json'}
  Status:    {DATA_DIR / 'status.json'}
  Log:       {LOGS_DIR / 'swarm.log'}
  PID:       {RUNTIME_DIR / 'swarm.pid'}

{colorize('=' * 70, Colors.CYAN)}
"""
    print(help_text)


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('-h', '--help', action='store_true')
    parser.add_argument('-b', '--build', action='store_true')
    parser.add_argument('--start', action='store_true')
    parser.add_argument('--stop', action='store_true')
    parser.add_argument('--status', action='store_true')
    parser.add_argument('--restart', action='store_true')
    parser.add_argument('--check-deps', action='store_true')
    
    args = parser.parse_args()
    
    # Help
    if args.help or len(sys.argv) == 1:
        show_help()
        return
    
    # Check deps only
    if args.check_deps:
        sys.exit(0 if check_dependencies() else 1)
    
    # Build
    if args.build:
        if not check_dependencies():
            print(colorize("\n⚠️  Please install dependencies first\n", Colors.YELLOW))
            sys.exit(1)
        interactive_build()
        return
    
    # Start
    if args.start:
        if not start_swarm():
            sys.exit(1)
        return
    
    # Stop
    if args.stop:
        if not stop_swarm():
            sys.exit(1)
        return
    
    # Status
    if args.status:
        show_status()
        return
    
    # Restart
    if args.restart:
        stop_swarm()
        time.sleep(1)
        start_swarm()
        return
    
    # Unknown
    print(colorize("⚠️  Unknown command. Use --help for usage.\n", Colors.YELLOW))
    sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(colorize("\n\n❌ Interrupted\n", Colors.YELLOW))
        sys.exit(1)
