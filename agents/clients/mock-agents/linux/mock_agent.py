#!/usr/bin/env python3
"""
Pankha Mock Agent - Individual Agent Process

Simulates a real Pankha agent with realistic but random sensor and fan data.
Communicates with the backend via WebSocket using the same protocol as real agents.
"""

import asyncio
import json
import logging
import random
import signal
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

try:
    import websockets
except ImportError:
    print("ERROR: websockets library not installed")
    print("Install with: pip3 install websockets")
    sys.exit(1)

# ============================================================================
# CONFIGURATION
# ============================================================================

class MockAgentConfig:
    """Configuration for a single mock agent"""

    def __init__(self, config_dict: Dict):
        self.agent_id = config_dict["agent_id"]
        self.agent_name = config_dict["agent_name"]
        self.server_url = config_dict["server_url"]
        self.update_interval = config_dict["update_interval"]
        self.sensor_count = config_dict["sensor_count"]
        self.fan_count = config_dict["fan_count"]
        self.temp_range = tuple(config_dict["temp_range"])
        self.speed_range = tuple(config_dict["speed_range"])
        self.rpm_range = tuple(config_dict["rpm_range"])
        self.log_file = config_dict.get("log_file", "agent.log")

        # Advanced settings
        self.filter_duplicate_sensors = config_dict.get("filter_duplicate_sensors", False)
        self.duplicate_sensor_tolerance = config_dict.get("duplicate_sensor_tolerance", 1.0)
        self.fan_step_percent = config_dict.get("fan_step_percent", 5)
        self.hysteresis_temp = config_dict.get("hysteresis_temp", 3.0)
        self.emergency_temp = config_dict.get("emergency_temp", 85.0)

# ============================================================================
# MOCK HARDWARE GENERATOR
# ============================================================================

class MockHardware:
    """Generates realistic mock hardware data"""

    def __init__(self, config: MockAgentConfig):
        self.config = config
        self.sensors = self._create_sensors()
        self.fans = self._create_fans()
        self.start_time = time.time()

    def _create_sensors(self) -> List[Dict]:
        """Create mock temperature sensors"""
        sensors = []
        sensor_types = [
            ("CPU Core", "cpu", 30, 85),
            ("CPU Package", "cpu", 35, 90),
            ("Motherboard", "motherboard", 25, 70),
            ("NVMe", "storage", 30, 80),
            ("GPU", "gpu", 30, 90),
            ("VRM", "motherboard", 40, 95),
            ("Chipset", "motherboard", 35, 75),
        ]

        for i in range(self.config.sensor_count):
            sensor_type, chip, base_temp, max_temp = random.choice(sensor_types)
            sensor_name = f"{sensor_type} {i % 4 + 1}" if i >= len(sensor_types) else f"{sensor_type} {i + 1}"

            # Generate random base temperature within user's configured range
            # Use middle 60% of range for base temp to allow variation in both directions
            min_temp, max_temp_config = self.config.temp_range
            range_size = max_temp_config - min_temp
            base_min = min_temp + (range_size * 0.2)
            base_max = max_temp_config - (range_size * 0.2)
            random_base_temp = random.uniform(base_min, base_max)

            sensor = {
                "id": f"sensor_{i:03d}",
                "name": sensor_name,
                "temperature": round(random.uniform(*self.config.temp_range), 1),
                "type": chip,
                "max_temp": max_temp,
                "crit_temp": max_temp + 10,
                "chip": f"mock_{chip}",
                "source": f"/sys/class/hwmon/hwmon{i}/temp{i+1}_input",
                # Store base temperature for realistic variation (now uses configured range)
                "_base_temp": random_base_temp,
                "_variation": random.uniform(5, 15),
            }
            sensors.append(sensor)

        return sensors

    def _create_fans(self) -> List[Dict]:
        """Create mock fans"""
        fans = []
        fan_names = [
            "CPU Fan",
            "System Fan 1",
            "System Fan 2",
            "Rear Exhaust",
            "Front Intake",
            "Top Exhaust",
            "Side Intake",
        ]

        for i in range(self.config.fan_count):
            fan_name = fan_names[i % len(fan_names)]
            if i >= len(fan_names):
                fan_name = f"{fan_name} {i // len(fan_names) + 1}"

            speed = random.randint(30, 70)
            fan = {
                "id": f"fan_{i:03d}",
                "name": fan_name,
                "rpm": self._speed_to_rpm(speed),
                "speed": speed,
                "targetSpeed": speed,
                "status": "ok",
                "has_pwm_control": True,
                "pwm_file": f"/sys/class/hwmon/hwmon0/pwm{i+1}",
            }
            fans.append(fan)

        return fans

    def _speed_to_rpm(self, speed: int) -> int:
        """Convert speed percentage to RPM"""
        min_rpm, max_rpm = self.config.rpm_range
        return int(min_rpm + (max_rpm - min_rpm) * speed / 100)

    def update_sensors(self):
        """Update sensor temperatures with realistic variation"""
        for sensor in self.sensors:
            # Add some random walk and periodic variation
            base = sensor["_base_temp"]
            variation = sensor["_variation"]

            # Sine wave for realistic thermal behavior + random noise
            time_factor = time.time() / 60  # Slow variation over minutes
            periodic = math.sin(time_factor + random.random()) * variation
            noise = random.uniform(-2, 2)

            new_temp = base + periodic + noise

            # Clamp to reasonable range
            min_temp, max_temp = self.config.temp_range
            new_temp = max(min_temp, min(max_temp, new_temp))

            sensor["temperature"] = round(new_temp, 1)

    def update_fans(self):
        """Update fan RPMs with slight variation"""
        for fan in self.fans:
            # Small RPM variation (+/- 5%)
            target_rpm = self._speed_to_rpm(fan["targetSpeed"])
            variation = int(target_rpm * 0.05)
            fan["rpm"] = target_rpm + random.randint(-variation, variation)

            # Gradually adjust current speed toward target
            if fan["speed"] != fan["targetSpeed"]:
                diff = fan["targetSpeed"] - fan["speed"]
                step = max(1, abs(diff) // 10)
                if diff > 0:
                    fan["speed"] = min(fan["speed"] + step, fan["targetSpeed"])
                else:
                    fan["speed"] = max(fan["speed"] - step, fan["targetSpeed"])

    def set_fan_speed(self, fan_id: str, speed: int) -> bool:
        """Set fan target speed"""
        for fan in self.fans:
            if fan["id"] == fan_id:
                fan["targetSpeed"] = speed
                logging.info(f"Set {fan['name']} target speed to {speed}%")
                return True
        return False

    def emergency_stop(self):
        """Set all fans to maximum speed"""
        for fan in self.fans:
            fan["targetSpeed"] = 100
            fan["speed"] = 100
        logging.warning("Emergency stop - all fans set to 100%")

    def get_system_health(self) -> Dict:
        """Get mock system health metrics"""
        uptime = time.time() - self.start_time
        return {
            "cpuUsage": round(random.uniform(10, 60), 1),
            "memoryUsage": round(random.uniform(30, 70), 1),
            "agentUptime": round(uptime, 1),
        }

# ============================================================================
# WEBSOCKET CLIENT
# ============================================================================

import math  # For sine wave calculation

class MockWebSocketClient:
    """WebSocket client for mock agent"""

    def __init__(self, config: MockAgentConfig):
        self.config = config
        self.hardware = MockHardware(config)
        self.running = False
        self.websocket = None

        # Setup logging
        self._setup_logging()

    def _setup_logging(self):
        """Setup logging to file and console with 15-minute retention"""
        from logging.handlers import TimedRotatingFileHandler

        log_path = Path(self.config.log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        # Create logger
        logger = logging.getLogger()
        logger.setLevel(logging.INFO)

        # Create formatter with standard logging format
        formatter = logging.Formatter(
            fmt='[%(asctime)s] [%(levelname)-8s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )

        # File handler with 15-minute rotation
        file_handler = TimedRotatingFileHandler(
            filename=log_path,
            when='M',  # Rotate by minutes
            interval=15,  # Every 15 minutes
            backupCount=1,  # Keep only 1 backup (previous 15 minutes)
            encoding='utf-8'
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(logging.DEBUG)  # File gets all levels

        # Console handler with INFO+ only
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        console_handler.setLevel(logging.INFO)  # Console only shows INFO+

        # Add handlers
        logger.addHandler(file_handler)
        logger.addHandler(console_handler)

    async def run(self):
        """Main run loop with reconnection"""
        self.running = True
        retry_count = 0

        logging.info(f"Pankha Mock Agent starting: {self.config.agent_name}")
        logging.info(f"Agent ID: {self.config.agent_id}")
        logging.info(f"Server: {self.config.server_url}")
        logging.info(f"Sensors: {self.config.sensor_count}, Fans: {self.config.fan_count}")

        while self.running:
            try:
                await self.connect_and_communicate()
                retry_count = 0  # Reset on successful connection
            except Exception as e:
                logging.error(f"WebSocket error: {e}")

            if self.running:
                # Exponential backoff (max 15s)
                wait_time = min(5 * (1.4 ** retry_count), 15)
                retry_count += 1
                logging.info(f"Reconnecting in {wait_time:.1f}s... (attempt {retry_count})")
                await asyncio.sleep(wait_time)

    async def connect_and_communicate(self):
        """Connect to server and handle communication"""
        logging.info(f"Connecting to WebSocket: {self.config.server_url}")

        async with websockets.connect(self.config.server_url) as websocket:
            self.websocket = websocket
            logging.info("✅ WebSocket connected")

            # Send registration
            await self.send_registration()

            # Start data sender task
            data_task = asyncio.create_task(self.data_sender_loop())

            # Handle incoming messages
            try:
                async for message in websocket:
                    await self.handle_message(message)
            except websockets.exceptions.ConnectionClosed:
                logging.info("Server closed connection")
            finally:
                data_task.cancel()
                try:
                    await data_task
                except asyncio.CancelledError:
                    pass

    async def send_registration(self):
        """Send registration message to server"""
        # Prepare sensor data for registration
        sensors = []
        for sensor in self.hardware.sensors:
            sensors.append({
                "id": sensor["id"],
                "name": sensor["name"],
                "temperature": sensor["temperature"],
                "type": sensor["type"],
                "max_temp": sensor["max_temp"],
                "crit_temp": sensor["crit_temp"],
                "chip": sensor["chip"],
                "source": sensor["source"],
            })

        # Prepare fan data for registration
        fans = []
        for fan in self.hardware.fans:
            fans.append({
                "id": fan["id"],
                "name": fan["name"],
                "rpm": fan["rpm"],
                "speed": fan["speed"],
                "targetSpeed": fan["targetSpeed"],
                "status": fan["status"],
                "has_pwm_control": fan["has_pwm_control"],
                "pwm_file": fan["pwm_file"],
            })

        registration = {
            "type": "register",
            "data": {
                "agentId": self.config.agent_id,
                "name": self.config.agent_name,
                "agent_version": "1.0.0-mock",
                "update_interval": int(self.config.update_interval * 1000),
                "filter_duplicate_sensors": self.config.filter_duplicate_sensors,
                "duplicate_sensor_tolerance": self.config.duplicate_sensor_tolerance,
                "fan_step_percent": self.config.fan_step_percent,
                "hysteresis_temp": self.config.hysteresis_temp,
                "emergency_temp": self.config.emergency_temp,
                "capabilities": {
                    "sensors": sensors,
                    "fans": fans,
                    "fan_control": True
                }
            }
        }

        await self.websocket.send(json.dumps(registration))
        logging.info(f"✅ Agent registered: {self.config.agent_id}")

    async def data_sender_loop(self):
        """Periodically send sensor data"""
        heartbeat_counter = 0

        while self.running:
            try:
                # Update hardware state
                self.hardware.update_sensors()
                self.hardware.update_fans()

                # Prepare sensor data
                sensors = []
                for sensor in self.hardware.sensors:
                    sensors.append({
                        "id": sensor["id"],
                        "name": sensor["name"],
                        "temperature": sensor["temperature"],
                        "type": sensor["type"],
                        "max_temp": sensor["max_temp"],
                        "crit_temp": sensor["crit_temp"],
                        "chip": sensor["chip"],
                        "source": sensor["source"],
                    })

                # Prepare fan data
                fans = []
                for fan in self.hardware.fans:
                    fans.append({
                        "id": fan["id"],
                        "name": fan["name"],
                        "rpm": fan["rpm"],
                        "speed": fan["speed"],
                        "targetSpeed": fan["targetSpeed"],
                        "status": fan["status"],
                        "has_pwm_control": fan["has_pwm_control"],
                        "pwm_file": fan["pwm_file"],
                    })

                # Send data message
                data_message = {
                    "type": "data",
                    "data": {
                        "agentId": self.config.agent_id,
                        "timestamp": int(datetime.utcnow().timestamp() * 1000),
                        "sensors": sensors,
                        "fans": fans,
                        "systemHealth": self.hardware.get_system_health()
                    }
                }

                await self.websocket.send(json.dumps(data_message))

                # Heartbeat logging
                heartbeat_counter += 1
                if heartbeat_counter % 20 == 0:
                    logging.info(f"Heartbeat: {heartbeat_counter} data transmissions completed")

                await asyncio.sleep(self.config.update_interval)

            except Exception as e:
                logging.error(f"Failed to send data: {e}")
                raise

    async def handle_message(self, message: str):
        """Handle incoming WebSocket message"""
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "command":
                await self.handle_command(data.get("data", {}))
            elif msg_type == "ping":
                # Respond to ping
                pong = {
                    "type": "pong",
                    "timestamp": int(datetime.utcnow().timestamp() * 1000)
                }
                await self.websocket.send(json.dumps(pong))
            elif msg_type == "registered":
                logging.info("Registration confirmed by server")
            else:
                logging.debug(f"Received message type: {msg_type}")

        except Exception as e:
            logging.error(f"Failed to handle message: {e}")

    async def handle_command(self, command_data: Dict):
        """Handle command from server"""
        command_type = command_data.get("type")
        command_id = command_data.get("commandId")
        payload = command_data.get("payload", {})

        logging.info(f"Processing command: {command_type}")

        success = False
        error_msg = None
        result_data = {}

        if command_type == "setFanSpeed":
            fan_id = payload.get("fanId")
            speed = payload.get("speed")

            if fan_id and speed is not None:
                success = self.hardware.set_fan_speed(fan_id, int(speed))
                if not success:
                    error_msg = f"Fan not found: {fan_id}"
            else:
                error_msg = "Missing fanId or speed in payload"

        elif command_type == "emergencyStop":
            self.hardware.emergency_stop()
            success = True

        else:
            error_msg = f"Unknown command type: {command_type}"

        # Send response
        response = {
            "type": "command_response",
            "data": {
                "commandId": command_id,
                "success": success,
                "error": error_msg,
                "result": result_data
            }
        }

        await self.websocket.send(json.dumps(response))

        if success:
            logging.info(f"Command {command_type} completed successfully")
        else:
            logging.error(f"Command {command_type} failed: {error_msg}")

    def stop(self):
        """Stop the agent"""
        logging.info("Stopping mock agent...")
        self.running = False

# ============================================================================
# MAIN
# ============================================================================

def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("ERROR: Config file path required")
        print(f"Usage: {sys.argv[0]} <config.json>")
        sys.exit(1)

    config_path = Path(sys.argv[1])
    if not config_path.exists():
        print(f"ERROR: Config file not found: {config_path}")
        sys.exit(1)

    # Load configuration
    with open(config_path, 'r') as f:
        config_dict = json.load(f)

    config = MockAgentConfig(config_dict)
    client = MockWebSocketClient(config)

    # Setup signal handlers
    def signal_handler(sig, frame):
        print("\nShutdown signal received")
        client.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Run the client
    try:
        asyncio.run(client.run())
    except KeyboardInterrupt:
        logging.info("Interrupted by user")
    except Exception as e:
        logging.error(f"Fatal error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
