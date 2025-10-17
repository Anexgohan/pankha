#!/usr/bin/env python3
"""
Pankha Agent - WebSocket Backend Communication Module

Handles WebSocket communication with Pankha backend server for real-time bidirectional communication.
Supports agent registration and data transmission over WebSocket.
"""

import os
import json
import time
import socket
import asyncio
import threading
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable

try:
    import websockets
except ImportError:
    print("ERROR: websockets library not found. Install with: pip install websockets")
    exit(1)

# Import our modules
from sensor_discovery import SensorDiscovery
from system_info import SystemInfo
from fan_control import FanControl


class WebSocketClient:
    """WebSocket client for Pankha backend communication."""
    
    def __init__(self, config: Dict[str, Any], config_manager=None):
        self.config = config
        self.config_manager = config_manager  # For saving config changes

        # Logging callback (initialize early for use during __init__)
        self.log_callback = None

        # Parse WebSocket URL - backend WebSocket runs on port 3002
        server_url = config.get("server_url", "ws://192.168.100.237:3002")
        if server_url.startswith("http://"):
            # Convert HTTP to WebSocket URL, use port 3002 for WebSocket
            server_url = server_url.replace("http://", "ws://").replace(":3000", ":3002")
        elif server_url.startswith("https://"):
            server_url = server_url.replace("https://", "wss://").replace(":3000", ":3002")
        
        # Backend WebSocket doesn't need /websocket path
        self.websocket_url = server_url
        self.agent_id = config.get("agent_id", f"linux-agent-{socket.gethostname()}")
        self.update_interval = config.get("update_interval", 3.0)  # 3 seconds as per Task 05
        self.connection_timeout = config.get("connection_timeout", 10.0)
        self.max_retries = config.get("max_retries", -1)  # Infinite retries
        self.retry_delay = config.get("retry_delay", 5.0)
        
        # Connection state
        self.running = False
        self.registered = False
        self.websocket = None
        
        # Hardware modules with config
        filter_duplicates = config.get("filter_duplicate_sensors", True)
        duplicate_tolerance = config.get("duplicate_sensor_tolerance", 0.5)
        self.sensor_discovery = SensorDiscovery(
            filter_duplicate_sensors=filter_duplicates,
            duplicate_sensor_tolerance=duplicate_tolerance
        )
        self.system_info = SystemInfo()
        self.fan_control = FanControl()

        # Discover fans if fan control is enabled
        if config.get("enable_fan_control", True):
            fan_discovery_result = self.fan_control.discover_fans()
            if "error" not in fan_discovery_result:
                discovered_count = len(self.fan_control.discovered_fans)
                self._log("INFO", f"FanControl initialized: {discovered_count} fans discovered")
                for fan_id in self.fan_control.discovered_fans.keys():
                    self._log("INFO", f"  - {fan_id}")
            else:
                self._log("WARNING", f"Fan discovery failed: {fan_discovery_result.get('error')}")

        # Threading and async
        self.loop = None
        self.thread = None
        self.lock = threading.Lock()
    
    def set_log_callback(self, callback: Callable[[str, str], None]):
        """Set logging callback function: callback(level, message)"""
        self.log_callback = callback
    
    def _log(self, level: str, message: str):
        """Internal logging method."""
        if self.log_callback:
            self.log_callback(level, message)
        else:
            print(f"[{level}] {message}")
    
    async def connect(self) -> bool:
        """Connect to WebSocket server with retry logic."""
        retries = 0
        
        while self.running and (self.max_retries < 0 or retries < self.max_retries):
            try:
                self._log("INFO", f"Connecting to WebSocket: {self.websocket_url}")
                
                # Connect to WebSocket
                self.websocket = await websockets.connect(
                    self.websocket_url,
                    timeout=self.connection_timeout
                )
                
                self._log("INFO", "✅ WebSocket connected")
                return True
                
            except Exception as e:
                retries += 1
                self._log("ERROR", f"WebSocket connection failed (attempt {retries}): {e}")
                
                if self.running and (self.max_retries < 0 or retries < self.max_retries):
                    self._log("INFO", f"Retrying connection in {self.retry_delay}s...")
                    await asyncio.sleep(self.retry_delay)
                    # Exponential backoff (max 30s)
                    self.retry_delay = min(self.retry_delay * 1.5, 30.0)
        
        return False
    
    async def register_with_backend(self) -> bool:
        """Register agent with backend via WebSocket."""
        try:
            # Discover hardware capabilities
            sensor_data = self.sensor_discovery.discover_all()
            system_data = self.system_info.gather_all()
            
            # Registration message (matching WebSocketHub expectations)
            registration_message = {
                "type": "register",
                "data": {
                    "agentId": self.agent_id,
                    "name": self.config.get("name", socket.gethostname()),
                    "ip_address": self._get_local_ip(),
                    "agent_version": "1.0.0-linux-websocket",
                    "update_interval": int(self.update_interval * 1000),  # Convert to milliseconds
                    "auth_token": "websocket-agent-token",
                    "filter_duplicate_sensors": self.config.get("filter_duplicate_sensors", True),
                    "duplicate_sensor_tolerance": self.config.get("duplicate_sensor_tolerance", 0.5),
                    "capabilities": {
                        "sensors": sensor_data.get("sensors", sensor_data.get("hwmon_sensors", []) + sensor_data.get("thermal_sensors", [])),
                        "fans": sensor_data.get("fans", []),
                        "fan_control": self.config.get("enable_fan_control", True)
                    },
                    "system_info": {
                        "hostname": system_data.get("hostname", "unknown"),
                        "os": f"{system_data.get('os', {}).get('distribution', 'Linux')} {system_data.get('os', {}).get('version', '')}",
                        "kernel": system_data.get("os", {}).get("kernel_release", "unknown"),
                        "cpu": system_data.get("cpu", {}).get("model", "unknown"),
                        "memory": system_data.get("memory", {}).get("total", {}).get("total_gb", 0)
                    }
                }
            }
            
            self._log("INFO", f"Registering agent: {self.agent_id}")
            await self.websocket.send(json.dumps(registration_message))
            
            # Wait for registration confirmation (timeout after 10 seconds)
            try:
                response = await asyncio.wait_for(self.websocket.recv(), timeout=10.0)
                response_data = json.loads(response)
                
                if response_data.get("type") == "registered" or "registered" in response.lower():
                    self._log("INFO", "✅ Agent registered successfully via WebSocket")
                    self.registered = True
                    return True
                else:
                    self._log("WARNING", f"Unexpected registration response: {response_data}")
            except asyncio.TimeoutError:
                self._log("WARNING", "Registration confirmation timeout - proceeding anyway")
                self.registered = True  # Assume success if no error
                return True
            
        except Exception as e:
            self._log("ERROR", f"Registration error: {e}")
            return False
    
    def _get_local_ip(self) -> str:
        """Get local IP address."""
        try:
            # Extract host from WebSocket URL
            host = self.websocket_url.replace("ws://", "").replace("wss://", "").split(":")[0].split("/")[0]
            
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((host, 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except:
            return "127.0.0.1"
    
    async def send_sensor_data(self) -> bool:
        """Send current sensor and fan data to backend via WebSocket."""
        try:
            if not self.websocket or self.websocket.closed:
                return False
                
            # Get current data
            sensor_data = self.sensor_discovery.discover_all()
            system_data = self.system_info.gather_all()
            
            # Format for backend (matching mock agent format)
            message = {
                "type": "data",
                "data": {
                    "agentId": self.agent_id,
                    "timestamp": int(datetime.utcnow().timestamp() * 1000),  # Milliseconds
                    "sensors": [],
                    "fans": [],
                    "systemHealth": {
                        "cpuUsage": system_data.get("cpu", {}).get("load_average", {}).get("1_minute", 0) * 100,
                        "memoryUsage": system_data.get("memory", {}).get("usage", {}).get("usage_percent", 0),
                        "agentUptime": system_data.get("uptime", {}).get("uptime_seconds", 0)
                    }
                }
            }
            
            # Process sensors (use deduplicated list if available, otherwise combine hwmon + thermal)
            all_sensors = sensor_data.get("sensors", sensor_data.get("hwmon_sensors", []) + sensor_data.get("thermal_sensors", []))
            for sensor in all_sensors:
                message["data"]["sensors"].append({
                    "id": sensor["id"],
                    "temperature": sensor["value"],
                    "type": self._get_sensor_type(sensor.get("chip", sensor.get("zone_type", "unknown"))),
                    "max_temp": sensor.get("max_value", 85),
                    "crit_temp": sensor.get("critical_value", 95)
                })
            
            # Process fans (matching mock agent format)
            for fan in sensor_data.get("fans", []):
                speed_percent = int((fan.get("pwm_value", 128) / 255.0) * 100)
                message["data"]["fans"].append({
                    "id": fan["id"],
                    "speed": speed_percent,
                    "rpm": fan["rpm"],
                    "targetSpeed": speed_percent,
                    "status": "ok" if fan["rpm"] > 0 else "stopped"
                })
            
            # Send data
            await self.websocket.send(json.dumps(message))
            self._log("DEBUG", f"Data sent: {len(message['data']['sensors'])} sensors, {len(message['data']['fans'])} fans")
            return True
            
        except Exception as e:
            self._log("ERROR", f"Error sending sensor data: {e}")
            return False
    
    def _get_sensor_type(self, chip: str) -> str:
        """Map chip name to sensor type."""
        chip = chip.lower()
        if "coretemp" in chip or "cpu" in chip or "k10temp" in chip:
            return "cpu"
        elif "nvidia" in chip or "gpu" in chip:
            return "gpu"
        elif "nvme" in chip or "storage" in chip:
            return "nvme"
        elif "acpi" in chip or "thermal" in chip:
            return "acpi"
        elif "it8628" in chip or "it87" in chip or "nct" in chip or "w83" in chip:
            return "motherboard"
        else:
            return "other"
    
    async def handle_command(self, message: Dict[str, Any]) -> bool:
        """Handle command from backend."""
        try:
            command_data = message.get("data", {})
            command_type = command_data.get("type")  # Backend sends command type in data.type
            command_id = command_data.get("commandId")  # For response tracking
            payload = command_data.get("payload", {})
            
            self._log("DEBUG", f"Processing command: {command_type} with payload: {payload}")
            
            success = False
            error_msg = None
            result_data = {}
            
            try:
                if command_type == "setFanSpeed":
                    fan_id = payload.get("fanId")
                    speed = payload.get("speed")
                    success = self._set_fan_speed(fan_id, speed)
                    result_data = {"fanId": fan_id, "speed": speed}
                elif command_type == "emergencyStop":
                    success = self._emergency_stop()
                    result_data = {"message": "Emergency stop executed"}
                elif command_type == "setUpdateInterval":
                    interval = payload.get("interval")
                    success = self._set_update_interval(interval)
                    result_data = {"interval": interval}
                elif command_type == "setSensorDeduplication":
                    enabled = payload.get("enabled")
                    success = self._set_sensor_deduplication(enabled)
                    result_data = {"enabled": enabled}
                elif command_type == "setSensorTolerance":
                    tolerance = payload.get("tolerance")
                    success = self._set_sensor_tolerance(tolerance)
                    result_data = {"tolerance": tolerance}
                elif command_type == "ping":
                    self._log("DEBUG", "Received ping command")
                    success = True
                    result_data = {"pong": True}
                else:
                    self._log("WARNING", f"Unknown command: {command_type}")
                    success = False
                    error_msg = f"Unknown command: {command_type}"
            except Exception as cmd_error:
                success = False
                error_msg = str(cmd_error)
                self._log("ERROR", f"Command execution error: {cmd_error}")
            
            # Send response back to backend
            if command_id and self.websocket and not self.websocket.closed:
                response = {
                    "type": "commandResponse",
                    "commandId": command_id,
                    "success": success,
                    "data": result_data,
                    "timestamp": int(time.time() * 1000)
                }
                if not success and error_msg:
                    response["error"] = error_msg
                
                await self.websocket.send(json.dumps(response))
                self._log("DEBUG", f"Sent command response: {command_id}, success: {success}")
            
            return success
                
        except Exception as e:
            self._log("ERROR", f"Error processing command: {e}")
            return False
    
    def _set_fan_speed(self, fan_id: str, speed: int) -> bool:
        """Set fan speed via fan control module."""
        try:
            if self.config.get("enable_fan_control", True):
                result = self.fan_control.set_fan_speed(fan_id, speed)
                # fan_control.set_fan_speed() returns a dict with 'status' key
                if isinstance(result, dict) and result.get("status") == "success":
                    self._log("INFO", f"Set {fan_id} to {speed}% (actual: {result.get('actual_percent')}%)")
                    return True
                else:
                    error_msg = result.get("message", "Unknown error") if isinstance(result, dict) else str(result)
                    self._log("ERROR", f"Failed to set {fan_id} speed: {error_msg}")
                    return False
            else:
                self._log("WARNING", "Fan control disabled in configuration")
                return False
        except Exception as e:
            self._log("ERROR", f"Error setting fan speed: {e}")
            return False
    
    def _emergency_stop(self) -> bool:
        """Emergency stop - set all fans to maximum speed."""
        try:
            if self.config.get("enable_fan_control", True):
                self.fan_control.emergency_stop()
                self._log("WARNING", "EMERGENCY STOP: All fans set to 100%")
                return True
            else:
                self._log("WARNING", "Emergency stop requested but fan control disabled")
                return False
        except Exception as e:
            self._log("ERROR", f"Error during emergency stop: {e}")
            return False

    def _set_update_interval(self, interval: float) -> bool:
        """Set agent update interval dynamically."""
        try:
            if interval is None:
                self._log("ERROR", "No interval provided for set_update_interval command")
                return False
                
            # Validate interval range (0.5-30 seconds)
            if not isinstance(interval, (int, float)) or interval < 0.5 or interval > 30:
                self._log("ERROR", f"Invalid interval: {interval}. Must be between 0.5 and 30 seconds")
                return False
            
            old_interval = self.update_interval
            self.update_interval = float(interval)
            
            # Update the config and save it to file
            if self.config_manager:
                self.config_manager.config['agent']['update_interval'] = float(interval)
                if self.config_manager.save_config():
                    self._log("INFO", f"Update interval changed: {old_interval}s → {interval}s (saved to config)")
                else:
                    self._log("WARNING", f"Update interval changed: {old_interval}s → {interval}s (failed to save to config)")
            else:
                self._log("INFO", f"Update interval changed: {old_interval}s → {interval}s (not persisted)")
            
            return True
            
        except Exception as e:
            self._log("ERROR", f"Error setting update interval: {e}")
            return False

    def _set_sensor_deduplication(self, enabled: bool) -> bool:
        """Set sensor deduplication setting dynamically."""
        try:
            if enabled is None:
                self._log("ERROR", "No enabled value provided for setSensorDeduplication command")
                return False

            if not isinstance(enabled, bool):
                self._log("ERROR", f"Invalid enabled value: {enabled}. Must be boolean")
                return False

            old_value = self.sensor_discovery.filter_duplicate_sensors
            self.sensor_discovery.filter_duplicate_sensors = enabled

            # Update the config and save it to file
            if self.config_manager:
                self.config_manager.config['hardware']['filter_duplicate_sensors'] = enabled
                if self.config_manager.save_config():
                    self._log("INFO", f"Sensor deduplication changed: {old_value} → {enabled} (saved to config)")
                else:
                    self._log("WARNING", f"Sensor deduplication changed: {old_value} → {enabled} (failed to save to config)")
            else:
                self._log("INFO", f"Sensor deduplication changed: {old_value} → {enabled} (not persisted)")

            return True

        except Exception as e:
            self._log("ERROR", f"Error setting sensor deduplication: {e}")
            return False

    def _set_sensor_tolerance(self, tolerance: float) -> bool:
        """Set sensor tolerance dynamically."""
        try:
            if tolerance is None:
                self._log("ERROR", "No tolerance provided for setSensorTolerance command")
                return False

            # Validate tolerance range (0.25-5.0°C)
            if not isinstance(tolerance, (int, float)) or tolerance < 0.25 or tolerance > 5.0:
                self._log("ERROR", f"Invalid tolerance: {tolerance}. Must be between 0.25 and 5.0°C")
                return False

            old_value = self.sensor_discovery.duplicate_sensor_tolerance
            self.sensor_discovery.duplicate_sensor_tolerance = float(tolerance)

            # Update the config and save it to file
            if self.config_manager:
                self.config_manager.config['hardware']['duplicate_sensor_tolerance'] = float(tolerance)
                if self.config_manager.save_config():
                    self._log("INFO", f"Sensor tolerance changed: {old_value}°C → {tolerance}°C (saved to config)")
                else:
                    self._log("WARNING", f"Sensor tolerance changed: {old_value}°C → {tolerance}°C (failed to save to config)")
            else:
                self._log("INFO", f"Sensor tolerance changed: {old_value}°C → {tolerance}°C (not persisted)")

            return True

        except Exception as e:
            self._log("ERROR", f"Error setting sensor tolerance: {e}")
            return False

    async def message_handler(self):
        """Handle incoming WebSocket messages."""
        try:
            while self.running and self.websocket and not self.websocket.closed:
                try:
                    message = await asyncio.wait_for(self.websocket.recv(), timeout=1.0)
                    message_data = json.loads(message)
                    
                    message_type = message_data.get("type")
                    if message_type == "command":
                        await self.handle_command(message_data)
                    elif message_type == "ping":
                        # Respond to ping
                        pong = {"type": "pong", "timestamp": int(time.time() * 1000)}
                        await self.websocket.send(json.dumps(pong))
                    else:
                        self._log("DEBUG", f"Received message: {message_type}")
                        
                except asyncio.TimeoutError:
                    continue  # Normal timeout, keep listening
                except Exception as e:
                    self._log("ERROR", f"Error handling message: {e}")
                    # Close the websocket to trigger reconnection
                    if self.websocket and not self.websocket.closed:
                        try:
                            await self.websocket.close()
                        except:
                            pass
                    raise  # Re-raise to exit the loop and trigger reconnection
                    
        except Exception as e:
            self._log("ERROR", f"Message handler error: {e}")
            # Ensure websocket is properly closed
            if self.websocket and not self.websocket.closed:
                try:
                    await self.websocket.close()
                except:
                    pass
    
    async def data_sender(self):
        """Send sensor data at regular intervals."""
        try:
            while self.running and self.registered:
                try:
                    if not self.websocket or self.websocket.closed:
                        self._log("WARNING", "WebSocket closed in data sender")
                        break
                    
                    await self.send_sensor_data()
                    await asyncio.sleep(self.update_interval)
                except Exception as e:
                    self._log("ERROR", f"Error in data sender: {e}")
                    # If websocket error, close and trigger reconnection
                    if "websocket" in str(e).lower() or "connection" in str(e).lower():
                        if self.websocket and not self.websocket.closed:
                            try:
                                await self.websocket.close()
                            except:
                                pass
                        raise  # Re-raise to exit and trigger reconnection
                    await asyncio.sleep(5.0)
        except Exception as e:
            self._log("ERROR", f"Data sender error: {e}")
            # Ensure websocket is properly closed
            if self.websocket and not self.websocket.closed:
                try:
                    await self.websocket.close()
                except:
                    pass
    
    async def main_loop(self):
        """Main WebSocket communication loop."""
        while self.running:
            try:
                # Reset connection state
                self.websocket = None
                self.registered = False
                
                # Connect to WebSocket
                if await self.connect():
                    # Register agent
                    if await self.register_with_backend():
                        self._log("INFO", "Starting WebSocket communication handlers")
                        try:
                            # Start message handler and data sender
                            await asyncio.gather(
                                self.message_handler(),
                                self.data_sender()
                            )
                        except Exception as e:
                            self._log("ERROR", f"Communication handler error: {e}")
                    else:
                        self._log("ERROR", "Failed to register with backend")
                    
                    # Connection lost, will retry
                    self._log("WARNING", "WebSocket connection lost")
                else:
                    self._log("ERROR", "Failed to connect to WebSocket")
                    
            except Exception as e:
                self._log("ERROR", f"Main loop error: {e}")
            
            # Clean up connection
            if self.websocket and not self.websocket.closed:
                try:
                    await self.websocket.close()
                except:
                    pass
            
            if self.running:
                self._log("INFO", f"Reconnecting in {self.retry_delay}s...")
                await asyncio.sleep(self.retry_delay)
                # Reset retry delay to minimum for next attempt
                self.retry_delay = self.config.get("retry_delay", 5.0)
    
    def start(self) -> bool:
        """Start the WebSocket client."""
        self.running = True
        
        def run_async():
            try:
                self.loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self.loop)
                self.loop.run_until_complete(self.main_loop())
            except Exception as e:
                self._log("ERROR", f"Async loop error: {e}")
            finally:
                if self.loop:
                    self.loop.close()
        
        self.thread = threading.Thread(target=run_async, daemon=True)
        self.thread.start()
        
        self._log("INFO", f"WebSocket client started (update interval: {self.update_interval}s)")
        return True
    
    def stop(self):
        """Stop the WebSocket client."""
        self.running = False
        
        # Close WebSocket if connected
        if self.websocket and not self.websocket.closed:
            asyncio.run_coroutine_threadsafe(self.websocket.close(), self.loop)
        
        # Wait for thread to finish
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=5.0)
            
        self._log("INFO", "WebSocket client stopped")


# Test functionality if run directly
if __name__ == "__main__":
    import logging
    
    # Test configuration
    test_config = {
        "server_url": "ws://192.168.100.237:3000/websocket",
        "agent_id": "test-websocket-agent",
        "name": "Test WebSocket Agent",
        "update_interval": 3.0,
        "connection_timeout": 10.0,
        "enable_fan_control": False  # Safe for testing
    }
    
    # Create client
    client = WebSocketClient(test_config)
    
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    client.set_log_callback(lambda level, msg: logging.log(getattr(logging, level), msg))
    
    # Start client
    print("Starting WebSocket client...")
    if client.start():
        print("WebSocket client started successfully!")
        try:
            # Keep running until interrupted
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopping client...")
            client.stop()
    else:
        print("Failed to start WebSocket client")