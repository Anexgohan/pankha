"""
Pankha Mock Agents - Agent Module

Single mock agent WebSocket client.
Handles connection, registration, telemetry, and commands.
"""

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

_AGENTS_CONFIG = Path(__file__).parent.parent / "data" / "agents.json"

try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except ImportError:
    websockets = None
    ConnectionClosed = Exception

from logger import get_logger
from hardware import MockHardware


class MockAgent:
    """Single mock agent that connects to Pankha backend via WebSocket."""

    def __init__(self, config: Dict):
        """Initialize agent from config dictionary."""
        self.agent_id: str = config["agent_id"]
        self.name: str = config["agent_name"]
        self.platform: str = config.get("platform", "linux")
        self.fake_ip: str = config.get("fake_ip", "127.0.0.1")
        self.server_url: str = config["server_url"]
        self.update_interval: float = config.get("update_interval", 3.0)
        
        # Configuration values
        self.fan_step_percent: int = config.get("fan_step_percent", 5)
        self.hysteresis_temp: float = config.get("hysteresis_temp", 3.0)
        self.emergency_temp: float = config.get("emergency_temp", 85.0)
        self.failsafe_speed: int = config.get("failsafe_speed", 70)
        self.log_level: str = config.get("log_level", "INFO")
        self.enable_fan_control: bool = config.get("enable_fan_control", True)
        
        # Hardware simulation
        self.hardware = MockHardware(config)
        
        # Connection state
        self.connected: bool = False
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
        self.running: bool = True
        self.last_data_sent: Optional[datetime] = None
        self.reconnect_count: int = 0
        
        self.log = get_logger()

    @property
    def version(self) -> str:
        return f"2.0.0-{self.platform}"

    async def run(self):
        """Main agent loop with automatic reconnection."""
        while self.running:
            try:
                await self.connect_and_communicate()
                self.reconnect_count = 0  # Reset on successful connection
            except ConnectionClosed as e:
                self.log.warning(f"[{self.name}] Connection closed: {e}")
            except Exception as e:
                self.log.warning(f"[{self.name}] Error: {e}")
            
            self.connected = False
            
            if self.running:
                # Exponential backoff: 5s -> 7s -> 10s -> 15s max
                wait_time = min(5 * (1.4 ** self.reconnect_count), 15)
                self.reconnect_count = min(self.reconnect_count + 1, 3)
                self.log.debug(f"[{self.name}] Reconnecting in {wait_time:.1f}s...")
                await asyncio.sleep(wait_time)
    
    async def connect_and_communicate(self):
        """Connect to server and handle bidirectional communication."""
        self.log.info(f"[{self.name}] Connecting to {self.server_url}")
        
        async with websockets.connect(
            self.server_url,
            extra_headers={"X-Forwarded-For": self.fake_ip},
        ) as ws:
            self.websocket = ws
            self.connected = True
            self.log.info(f"[{self.name}] ✅ Connected")
            
            # Send registration
            await self.send_registration()
            
            # Start data sender task
            sender_task = asyncio.create_task(self.data_sender_loop())
            
            try:
                # Handle incoming messages
                async for message in ws:
                    await self.handle_message(message)
            finally:
                sender_task.cancel()
                try:
                    await sender_task
                except asyncio.CancelledError:
                    pass
    
    async def send_registration(self):
        """Send registration message to server."""
        registration = {
            "type": "register",
            "data": {
                "agentId": self.agent_id,
                "name": self.name,
                "agent_version": self.version,
                "platform": self.platform,
                "update_interval": self.update_interval,
                "fan_step_percent": self.fan_step_percent,
                "hysteresis_temp": self.hysteresis_temp,
                "emergency_temp": self.emergency_temp,
                "failsafe_speed": self.failsafe_speed,
                "log_level": self.log_level,
                "capabilities": {
                    "sensors": self.hardware.get_sensors_data(),
                    "fans": self.hardware.get_fans_data(),
                    "fan_control": self.enable_fan_control,
                }
            }
        }
        
        await self.websocket.send(json.dumps(registration))
        self.log.debug(f"[{self.name}] Registration sent")
    
    async def data_sender_loop(self):
        """Periodically send telemetry data."""
        while self.running and self.connected:
            try:
                # Update hardware simulation
                self.hardware.update()
                
                # Build data message
                data_message = {
                    "type": "data",
                    "data": {
                        "agentId": self.agent_id,
                        "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
                        "sensors": self.hardware.get_sensors_data(),
                        "fans": self.hardware.get_fans_data(),
                        "systemHealth": self.hardware.get_system_health(),
                    }
                }
                
                await self.websocket.send(json.dumps(data_message))
                self.last_data_sent = datetime.now(timezone.utc)
                
            except Exception as e:
                self.log.error(f"[{self.name}] Failed to send data: {e}")
                raise
            
            await asyncio.sleep(self.update_interval)
    
    async def handle_message(self, message: str):
        """Handle incoming WebSocket message."""
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "command":
                await self.handle_command(data.get("data", {}))
            elif msg_type == "registered":
                self.log.info(f"[{self.name}] ✅ Registration confirmed")
                # Apply any config from server
                if "configuration" in data:
                    self.apply_config(data["configuration"])
            elif msg_type == "ping":
                await self.send_pong()
            else:
                self.log.debug(f"[{self.name}] Received: {msg_type}")
                
        except Exception as e:
            self.log.error(f"[{self.name}] Failed to handle message: {e}")
    
    async def handle_command(self, cmd_data: Dict):
        """Handle command from server."""
        cmd_type = cmd_data.get("type")
        cmd_id = cmd_data.get("commandId", "")
        payload = cmd_data.get("payload", {})
        
        self.log.debug(f"[{self.name}] Command: {cmd_type}")
        
        success = True
        error_msg = None
        result_data = {}
        
        try:
            if cmd_type == "setFanSpeed":
                if not self.enable_fan_control:
                    result_data = {"message": "Fan control is disabled"}
                else:
                    fan_id = payload.get("fanId")
                    speed = payload.get("speed")
                    if fan_id and speed is not None:
                        if self.hardware.set_fan_speed(fan_id, int(speed)):
                            result_data = {"fanId": fan_id, "speed": speed}
                        else:
                            success = False
                            error_msg = f"Fan not found: {fan_id}"
                    else:
                        success = False
                        error_msg = "Missing fanId or speed"
            
            elif cmd_type == "emergencyStop":
                self.hardware.emergency_stop()
                result_data = {"message": "Emergency stop executed"}
            
            elif cmd_type == "setUpdateInterval":
                interval = payload.get("interval")
                if interval is not None:
                    self.update_interval = float(interval)
                    self._persist_config("update_interval", self.update_interval)
                    result_data = {"interval": interval}
                else:
                    success = False
                    error_msg = "Missing interval"

            elif cmd_type == "setFanStep":
                step = payload.get("step")
                if step is not None:
                    self.fan_step_percent = int(step)
                    self._persist_config("fan_step_percent", self.fan_step_percent)
                    result_data = {"step": step}
                else:
                    success = False
                    error_msg = "Missing step"

            elif cmd_type == "setHysteresis":
                hysteresis = payload.get("hysteresis")
                if hysteresis is not None:
                    self.hysteresis_temp = float(hysteresis)
                    self._persist_config("hysteresis_temp", self.hysteresis_temp)
                    result_data = {"hysteresis": hysteresis}
                else:
                    success = False
                    error_msg = "Missing hysteresis"

            elif cmd_type == "setEmergencyTemp":
                temp = payload.get("temp")
                if temp is not None:
                    self.emergency_temp = float(temp)
                    self._persist_config("emergency_temp", self.emergency_temp)
                    result_data = {"temp": temp}
                else:
                    success = False
                    error_msg = "Missing temp"

            elif cmd_type == "setLogLevel":
                level = payload.get("level")
                if level:
                    self.log_level = level.upper()
                    self._persist_config("log_level", self.log_level)
                    result_data = {"level": level}
                else:
                    success = False
                    error_msg = "Missing level"

            elif cmd_type == "setFailsafeSpeed":
                speed = payload.get("speed")
                if speed is not None:
                    self.failsafe_speed = int(speed)
                    self._persist_config("failsafe_speed", self.failsafe_speed)
                    result_data = {"speed": speed}
                else:
                    success = False
                    error_msg = "Missing speed"

            elif cmd_type == "setEnableFanControl":
                enabled = payload.get("enabled")
                if enabled is not None:
                    self.enable_fan_control = bool(enabled)
                    self._persist_config("enable_fan_control", self.enable_fan_control)
                    result_data = {"enabled": enabled}
                else:
                    success = False
                    error_msg = "Missing enabled"

            elif cmd_type == "setAgentName":
                name = payload.get("name")
                if name:
                    self.name = name.strip()
                    self._persist_config("agent_name", self.name)
                    result_data = {"name": name}
                else:
                    success = False
                    error_msg = "Missing name"
            
            elif cmd_type == "setProfile":
                profile_name = payload.get("profileName")
                if profile_name:
                    self.current_profile = profile_name
                    result_data = {"profileName": profile_name}
                else:
                    success = False
                    error_msg = "Missing profileName"

            elif cmd_type == "ping":
                result_data = {"pong": True}

            else:
                success = False
                error_msg = f"Unknown command: {cmd_type}"
        
        except Exception as e:
            success = False
            error_msg = str(e)
        
        # Send response
        response = {
            "type": "commandResponse",
            "commandId": cmd_id,
            "success": success,
            "data": result_data,
            "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
        }
        if error_msg:
            response["error"] = error_msg
        
        await self.websocket.send(json.dumps(response))
    
    async def send_pong(self):
        """Respond to ping."""
        pong = {
            "type": "pong",
            "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
        }
        await self.websocket.send(json.dumps(pong))
    
    def apply_config(self, config: Dict):
        """Apply configuration from server."""
        if "update_interval" in config:
            self.update_interval = float(config["update_interval"])
        if "fan_step_percent" in config:
            self.fan_step_percent = int(config["fan_step_percent"])
        if "hysteresis_temp" in config:
            self.hysteresis_temp = float(config["hysteresis_temp"])
        if "emergency_temp" in config:
            self.emergency_temp = float(config["emergency_temp"])
        if "log_level" in config:
            self.log_level = config["log_level"].upper()
        if "failsafe_speed" in config:
            self.failsafe_speed = int(config["failsafe_speed"])
    
    def _persist_config(self, key: str, value):
        """Persist a config change to agents.json."""
        try:
            if not _AGENTS_CONFIG.exists():
                return
            with open(_AGENTS_CONFIG, 'r') as f:
                config = json.load(f)
            for agent in config.get("agents", []):
                if agent.get("agent_id") == self.agent_id:
                    agent[key] = value
                    break
            with open(_AGENTS_CONFIG, 'w') as f:
                json.dump(config, f, indent=2)
            self.log.debug(f"[{self.name}] Persisted {key}={value}")
        except Exception as e:
            self.log.warning(f"[{self.name}] Failed to persist {key}: {e}")

    def get_status(self) -> Dict:
        """Get agent status for status file."""
        return {
            "connected": self.connected,
            "last_data": self.last_data_sent.isoformat() if self.last_data_sent else None,
            "sensors": len(self.hardware.sensors),
            "fans": len(self.hardware.fans),
        }
    
    def stop(self):
        """Stop the agent."""
        self.running = False
