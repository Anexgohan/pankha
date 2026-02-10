"""
Pankha Mock Agents - Swarm Manager

Orchestrates multiple mock agents in a single process.
Handles startup, shutdown, status tracking, and signal handling.
"""

import asyncio
import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from logger import setup_logger, get_logger
from agent import MockAgent


class SwarmManager:
    """Manages all mock agents in a single async process."""
    
    def __init__(self, base_dir: Path):
        """Initialize swarm manager."""
        self.base_dir = base_dir
        self.data_dir = base_dir / "data"
        self.logs_dir = base_dir / "logs"
        self.runtime_dir = base_dir / "runtime"
        
        # Ensure directories exist
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        
        self.agents_config_file = self.data_dir / "agents.json"
        self.status_file = self.data_dir / "status.json"
        self.pid_file = self.runtime_dir / "swarm.pid"
        
        # Agent management
        self.agents: List[MockAgent] = []
        self.stagger_seconds: float = 0.1  # 100ms between agent starts
        self.running: bool = False
        self.start_time: Optional[datetime] = None
        
        # Setup logger
        self.log = setup_logger(self.logs_dir)
    
    def load_agents_config(self) -> List[Dict]:
        """Load agent configurations from agents.json."""
        if not self.agents_config_file.exists():
            self.log.error(f"Config file not found: {self.agents_config_file}")
            return []
        
        with open(self.agents_config_file, 'r') as f:
            config = json.load(f)
        
        return config.get("agents", [])
    
    def write_pid(self):
        """Write current process PID to file."""
        self.pid_file.write_text(str(os.getpid()))
    
    def remove_pid(self):
        """Remove PID file on shutdown."""
        if self.pid_file.exists():
            self.pid_file.unlink()
    
    async def update_status(self):
        """Periodically update status.json for CLI --status command.
        
        Only writes to disk when connectivity state changes or every 30s
        as a heartbeat to prevent stale-file false alarms.
        """
        prev_connected = -1
        ticks_since_write = 0
        heartbeat_ticks = 15  # 15 × 2s = 30s
        
        while self.running:
            try:
                connected = sum(1 for a in self.agents if a.connected)
                ticks_since_write += 1
                
                # Only write on state change or heartbeat
                if connected != prev_connected or ticks_since_write >= heartbeat_ticks:
                    status = {
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "started_at": self.start_time.isoformat() if self.start_time else None,
                        "pid": os.getpid(),
                        "total": len(self.agents),
                        "connected": connected,
                        "disconnected": len(self.agents) - connected,
                        "agents": {
                            a.name: a.get_status() for a in self.agents
                        }
                    }
                    
                    self.status_file.write_text(json.dumps(status, indent=2))
                    prev_connected = connected
                    ticks_since_write = 0
                
            except Exception as e:
                self.log.error(f"Failed to write status: {e}")
            
            await asyncio.sleep(2)  # Check every 2 seconds
    
    def setup_signal_handlers(self):
        """Setup graceful shutdown on SIGTERM/SIGINT."""
        def handler(signum, frame):
            self.log.info(f"Received signal {signum}, shutting down...")
            self.running = False
            for agent in self.agents:
                agent.stop()
        
        signal.signal(signal.SIGTERM, handler)
        signal.signal(signal.SIGINT, handler)
    
    async def start(self):
        """Start all agents as async tasks."""
        self.running = True
        self.start_time = datetime.now(timezone.utc)
        
        # Load configurations
        configs = self.load_agents_config()
        if not configs:
            self.log.error("No agents configured. Run --build first.")
            return
        
        self.log.info(f"Starting {len(configs)} mock agents...")
        
        # Create agents
        for config in configs:
            agent = MockAgent(config)
            self.agents.append(agent)
        
        # Write PID file
        self.write_pid()
        
        # Setup signal handlers
        self.setup_signal_handlers()
        
        # Start agents with stagger to avoid thundering herd
        tasks = []
        for i, agent in enumerate(self.agents):
            task = asyncio.create_task(agent.run())
            tasks.append(task)
            self.log.info(f"  [{i+1}/{len(self.agents)}] {agent.name} started")
            await asyncio.sleep(self.stagger_seconds)
        
        # Start status writer
        status_task = asyncio.create_task(self.update_status())
        tasks.append(status_task)
        
        self.log.info(f"✅ All {len(self.agents)} agents started")
        
        # Wait for all tasks (until shutdown)
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        except asyncio.CancelledError:
            pass
        finally:
            self.log.info("Swarm shutdown complete")
            self.remove_pid()
    
    def get_status(self) -> Optional[Dict]:
        """Read current status from status file (for CLI)."""
        if not self.status_file.exists():
            return None
        
        try:
            with open(self.status_file, 'r') as f:
                return json.load(f)
        except Exception:
            return None
    
    def is_running(self) -> tuple[bool, Optional[int]]:
        """Check if swarm is running by PID file."""
        if not self.pid_file.exists():
            return False, None
        
        try:
            pid = int(self.pid_file.read_text().strip())
            
            # Check if process exists
            try:
                os.kill(pid, 0)  # Signal 0 just checks existence
                return True, pid
            except OSError:
                # Process doesn't exist, remove stale PID
                self.pid_file.unlink()
                return False, None
        
        except (ValueError, IOError):
            return False, None
    
    def stop(self) -> bool:
        """Stop running swarm by sending SIGTERM."""
        running, pid = self.is_running()
        
        if not running:
            return False
        
        try:
            os.kill(pid, signal.SIGTERM)
            
            # Wait for graceful shutdown (up to 10 seconds)
            for _ in range(100):
                try:
                    os.kill(pid, 0)
                    time.sleep(0.1)
                except OSError:
                    break
            else:
                # Force kill if still running
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass
            
            # Clean up PID file
            if self.pid_file.exists():
                self.pid_file.unlink()
            
            return True
        
        except Exception:
            return False


def run_swarm(base_dir: Path):
    """Entry point to run the swarm (called from CLI)."""
    manager = SwarmManager(base_dir)
    asyncio.run(manager.start())
