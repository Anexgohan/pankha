#!/usr/bin/env python3
"""
Pankha Agent - HTTP Backend Communication Module

Handles HTTP communication with Pankha backend server using only standard library.
Configurable update frequency, automatic retry logic, and command processing.
"""

import os
import json
import time
import socket
import threading
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable

# Import our modules
from sensor_discovery import SensorDiscovery
from system_info import SystemInfo
from fan_control import FanControl


class BackendClient:
    """HTTP client for Pankha backend communication using standard library only."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        
        # Parse server URL - convert WebSocket URL to HTTP if needed
        server_url = config.get("server_url", "http://192.168.100.237:3000")
        if server_url.startswith("ws://"):
            server_url = server_url.replace("ws://", "http://").replace("/websocket", "")
        elif server_url.startswith("wss://"):
            server_url = server_url.replace("wss://", "https://").replace("/websocket", "")
            
        self.base_url = server_url.rstrip('/')
        self.agent_id = config.get("agent_id", f"linux-agent-{socket.gethostname()}")
        self.update_interval = config.get("update_interval", 10.0)  # User configurable
        self.connection_timeout = config.get("connection_timeout", 10.0)
        self.max_retries = config.get("max_retries", 3)
        self.retry_delay = config.get("retry_delay", 5.0)
        
        # Connection state
        self.running = False
        self.registered = False
        
        # Hardware modules
        self.sensor_discovery = SensorDiscovery()
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

        # Threading
        self.main_thread = None
        self.lock = threading.Lock()
        
        # Logging callback
        self.log_callback = None
    
    def set_log_callback(self, callback: Callable[[str, str], None]):
        """Set logging callback function: callback(level, message)"""
        self.log_callback = callback
    
    def _log(self, level: str, message: str):
        """Internal logging method."""
        if self.log_callback:
            self.log_callback(level, message)
        else:
            print(f"[{level}] {message}")
    
    def _make_request(self, endpoint: str, data: Dict[str, Any] = None, method: str = "GET") -> Optional[Dict[str, Any]]:
        """Make HTTP request with retry logic."""
        url = f"{self.base_url}{endpoint}"
        
        for attempt in range(self.max_retries):
            try:
                # Prepare request
                if data and method in ["POST", "PUT"]:
                    json_data = json.dumps(data).encode('utf-8')
                    req = urllib.request.Request(
                        url,
                        data=json_data,
                        headers={
                            'Content-Type': 'application/json',
                            'User-Agent': f'pankha-agent/{self.agent_id}'
                        }
                    )
                    if method == "PUT":
                        req.get_method = lambda: "PUT"
                else:
                    req = urllib.request.Request(
                        url,
                        headers={'User-Agent': f'pankha-agent/{self.agent_id}'}
                    )
                
                # Make request
                with urllib.request.urlopen(req, timeout=self.connection_timeout) as response:
                    if response.getcode() in [200, 201]:
                        response_data = response.read().decode('utf-8')
                        if response_data.strip():
                            return json.loads(response_data)
                        else:
                            return {}
                    else:
                        self._log("WARNING", f"HTTP {response.getcode()} from {endpoint}")
                        
            except urllib.error.HTTPError as e:
                self._log("ERROR", f"HTTP {e.code} error on {endpoint}: {e.reason}")
                if e.code in [400, 401, 403, 404]:  # Don't retry client errors
                    break
            except urllib.error.URLError as e:
                self._log("ERROR", f"Connection error to {endpoint}: {e.reason}")
            except json.JSONDecodeError as e:
                self._log("ERROR", f"Invalid JSON response from {endpoint}: {e}")
            except Exception as e:
                self._log("ERROR", f"Request error to {endpoint}: {e}")
            
            if attempt < self.max_retries - 1:
                self._log("INFO", f"Retrying {endpoint} in {self.retry_delay}s (attempt {attempt + 1}/{self.max_retries})")
                time.sleep(self.retry_delay)
        
        return None
    
    def register_with_backend(self) -> bool:
        """Register agent with backend server."""
        try:
            # Discover hardware capabilities
            sensor_data = self.sensor_discovery.discover_all()
            system_data = self.system_info.gather_all()
            
            # Registration payload - matching backend expectations
            registration_data = {
                "name": self.config.get("name", socket.gethostname()),
                "agent_id": self.agent_id,
                "ip_address": self._get_local_ip(),
                "api_endpoint": f"http://{self._get_local_ip()}:8080",  # Mock API endpoint
                "websocket_endpoint": f"ws://{self._get_local_ip()}:8081",  # Mock WS endpoint
                "auth_token": "linux-agent-token",
                "agent_version": "1.0.0-linux",
                "capabilities": {
                    "sensors": sensor_data.get("hwmon_sensors", []) + sensor_data.get("thermal_sensors", []),
                    "fans": sensor_data.get("fans", []),
                    "fan_control": self.config.get("enable_fan_control", True)
                }
            }
            
            # Try different registration endpoints
            endpoints_to_try = ["/api/agent/register", "/api/systems"]
            
            for endpoint in endpoints_to_try:
                self._log("INFO", f"Attempting registration at {endpoint}")
                response = self._make_request(endpoint, registration_data, "POST")
                
                if response:
                    self._log("INFO", "✅ Agent registered successfully")
                    self.registered = True
                    return True
            
            self._log("ERROR", "Registration failed on all endpoints")
            return False
            
        except Exception as e:
            self._log("ERROR", f"Registration error: {e}")
            return False
    
    def _get_local_ip(self) -> str:
        """Get local IP address."""
        try:
            # Extract host from URL
            if "://" in self.base_url:
                host = self.base_url.split("://")[1].split(":")[0].split("/")[0]
            else:
                host = self.base_url.split(":")[0]
                
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((host, 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except:
            return "127.0.0.1"
    
    def send_sensor_data(self) -> bool:
        """Send current sensor and fan data to backend."""
        try:
            # Get current data
            sensor_data = self.sensor_discovery.discover_all()
            system_data = self.system_info.gather_all()
            
            # Format for backend (compatible with WebSocket format)
            message = {
                "type": "data",
                "data": {
                    "agentId": self.agent_id,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "sensors": [],
                    "fans": [],
                    "systemHealth": {
                        "cpuUsage": system_data.get("cpu", {}).get("load_average", {}).get("1_minute", 0),
                        "memoryUsage": system_data.get("memory", {}).get("usage", {}).get("usage_percent", 0),
                        "agentUptime": system_data.get("uptime", {}).get("uptime_seconds", 0)
                    }
                }
            }
            
            # Process sensors
            for sensor in sensor_data.get("hwmon_sensors", []):
                message["data"]["sensors"].append({
                    "id": sensor["id"],
                    "temperature": sensor["value"],
                    "type": sensor.get("chip", "unknown"),
                    "max_temp": sensor.get("max_value", 85),
                    "crit_temp": sensor.get("critical_value", 95)
                })
            
            # Process fans
            for fan in sensor_data.get("fans", []):
                speed_percent = int((fan.get("pwm_value", 128) / 255.0) * 100)
                message["data"]["fans"].append({
                    "id": fan["id"],
                    "speed": speed_percent,
                    "rpm": fan["rpm"],
                    "targetSpeed": speed_percent,
                    "status": "ok" if fan["rpm"] > 0 else "stopped"
                })
            
            # Try different data endpoints
            endpoints_to_try = [
                f"/api/systems/{self.agent_id}/data",
                "/api/agent/data",
                "/api/data"
            ]
            
            for endpoint in endpoints_to_try:
                response = self._make_request(endpoint, message, "POST")
                if response:
                    self._log("DEBUG", f"Data sent: {len(message['data']['sensors'])} sensors, {len(message['data']['fans'])} fans")
                    return True
            
            self._log("WARNING", "Failed to send data to any endpoint")
            return False
            
        except Exception as e:
            self._log("ERROR", f"Error sending sensor data: {e}")
            return False
    
    def check_for_commands(self) -> List[Dict[str, Any]]:
        """Check for pending commands from backend."""
        try:
            endpoints_to_try = [
                f"/api/systems/{self.agent_id}/commands",
                f"/api/agent/{self.agent_id}/commands",
                "/api/commands"
            ]
            
            for endpoint in endpoints_to_try:
                response = self._make_request(endpoint)
                if response:
                    # Handle different response formats
                    if isinstance(response, list):
                        return response
                    elif isinstance(response, dict) and "commands" in response:
                        return response["commands"]
                    elif isinstance(response, dict) and "type" in response:
                        return [response]  # Single command
            
            return []
            
        except Exception as e:
            self._log("ERROR", f"Error checking commands: {e}")
            return []
    
    def process_command(self, command: Dict[str, Any]) -> bool:
        """Process a command from the backend."""
        try:
            command_type = command.get("command", command.get("type"))
            command_data = command.get("data", command)
            
            if command_type == "set_fan_speed":
                fan_id = command_data.get("fanId")
                speed = command_data.get("speed")
                return self._set_fan_speed(fan_id, speed)
            elif command_type == "emergency_stop":
                return self._emergency_stop()
            elif command_type == "ping":
                self._log("DEBUG", "Received ping command")
                return True
            else:
                self._log("WARNING", f"Unknown command: {command_type}")
                return False
                
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
    
    def start(self) -> bool:
        """Start the backend communication loop."""
        self.running = True
        
        # Register with backend
        if not self.register_with_backend():
            self._log("ERROR", "Failed to register with backend")
            return False
        
        # Start main communication loop
        self.main_thread = threading.Thread(target=self._main_loop, daemon=True)
        self.main_thread.start()
        
        self._log("INFO", f"Backend client started (update interval: {self.update_interval}s)")
        return True
    
    def stop(self):
        """Stop the backend communication."""
        self.running = False
        if self.main_thread and self.main_thread.is_alive():
            self.main_thread.join(timeout=5.0)
        self._log("INFO", "Backend client stopped")
    
    def _main_loop(self):
        """Main communication loop."""
        last_data_send = 0
        
        while self.running:
            try:
                current_time = time.time()
                
                # Send sensor data at configured interval
                if current_time - last_data_send >= self.update_interval:
                    if self.send_sensor_data():
                        last_data_send = current_time
                
                # Check for commands (every loop iteration for responsiveness)
                commands = self.check_for_commands()
                for command in commands:
                    self.process_command(command)
                
                # Sleep for a short interval to avoid busy-waiting
                time.sleep(min(1.0, self.update_interval / 10))
                
            except KeyboardInterrupt:
                break
            except Exception as e:
                self._log("ERROR", f"Error in main loop: {e}")
                time.sleep(5.0)  # Wait before retrying
        
        self._log("INFO", "Main communication loop stopped")


# Test functionality if run directly
if __name__ == "__main__":
    import logging
    
    # Test configuration
    test_config = {
        "server_url": "http://192.168.100.237:3000",
        "agent_id": "test-linux-agent",
        "name": "Test Linux Agent",
        "update_interval": 5.0,
        "connection_timeout": 10.0,
        "max_retries": 3,
        "enable_fan_control": False  # Safe for testing
    }
    
    # Create client
    client = BackendClient(test_config)
    
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    client.set_log_callback(lambda level, msg: logging.log(getattr(logging, level), msg))
    
    # Test connection and registration
    print("Testing backend connection...")
    if client.register_with_backend():
        print("Registration successful!")
        
        print("Testing data transmission...")
        if client.send_sensor_data():
            print("Data transmission successful!")
        else:
            print("Data transmission failed")
    else:
        print("Registration failed")
