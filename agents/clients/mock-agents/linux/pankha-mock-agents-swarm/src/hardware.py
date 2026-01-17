"""
Pankha Mock Agents - Hardware Simulation

Generates realistic mock sensor and fan data.
Matches the exact data structures used by real Pankha agents.
"""

import math
import random
import time
from typing import Dict, List, Tuple


class MockHardware:
    """Generates realistic mock hardware data for a single agent."""
    
    # Chip groups with sensor definitions (mimics real hardware)
    CHIP_GROUPS = [
        ("k10temp", "cpu", [
            ("Tctl", 35, 95),
            ("Tdie", 35, 95),
            ("Tccd1", 30, 90),
        ]),
        ("coretemp", "cpu", [
            ("Core 0", 35, 100),
            ("Core 1", 35, 100),
            ("Core 2", 35, 100),
            ("Core 3", 35, 100),
        ]),
        ("nvidia", "gpu", [
            ("GPU Core", 30, 90),
            ("GPU Hot Spot", 35, 95),
        ]),
        ("amdgpu", "gpu", [
            ("edge", 30, 90),
            ("junction", 35, 95),
        ]),
        ("nvme", "nvme", [
            ("Composite", 25, 70),
            ("Sensor 1", 25, 65),
        ]),
        ("it8628", "motherboard", [
            ("System", 25, 60),
            ("Chipset", 30, 70),
            ("VRM", 35, 100),
        ]),
        ("nct6798", "motherboard", [
            ("SYSTIN", 25, 60),
            ("CPUTIN", 30, 70),
            ("AUXTIN", 25, 50),
        ]),
    ]
    
    FAN_NAMES = [
        "CPU Fan",
        "System Fan 1",
        "System Fan 2",
        "Rear Exhaust",
        "Front Intake",
        "Top Exhaust",
        "Side Intake",
        "Chassis Fan",
    ]
    
    def __init__(self, config: Dict):
        """Initialize hardware simulation from agent config."""
        self.config = config
        self.start_time = time.time()
        
        # Extract ranges from config
        self.temp_range: Tuple[int, int] = tuple(config.get("temp_range", [25, 75]))
        self.speed_range: Tuple[int, int] = tuple(config.get("speed_range", [0, 100]))
        self.rpm_range: Tuple[int, int] = tuple(config.get("rpm_range", [0, 3000]))
        
        # Create sensors and fans
        self.sensors = self._create_sensors(config.get("sensor_count", 8))
        self.fans = self._create_fans(config.get("fan_count", 4))
    
    def _create_sensors(self, count: int) -> List[Dict]:
        """Create mock temperature sensors grouped by chip type."""
        sensors = []
        created = 0
        group_idx = 0
        
        while created < count:
            chip_name, sensor_type, sensor_defs = self.CHIP_GROUPS[group_idx % len(self.CHIP_GROUPS)]
            hwmon_idx = group_idx
            
            for sensor_idx, (name, base_temp, max_temp) in enumerate(sensor_defs):
                if created >= count:
                    break
                
                # Generate base temperature within configured range
                min_temp, max_temp_config = self.temp_range
                range_size = max_temp_config - min_temp
                base_min = min_temp + (range_size * 0.2)
                base_max = max_temp_config - (range_size * 0.2)
                random_base = random.uniform(base_min, base_max)
                
                # Create sensor ID like real agents
                sensor_id = f"{chip_name}_{name.lower().replace(' ', '_')}"
                
                sensor = {
                    "id": sensor_id,
                    "name": name,
                    "temperature": round(random.uniform(*self.temp_range), 1),
                    "type": sensor_type,
                    "max_temp": max_temp,
                    "crit_temp": max_temp + 10,
                    "chip": chip_name,
                    "source": f"/sys/class/hwmon/hwmon{hwmon_idx}/temp{sensor_idx + 1}_input",
                    # Internal simulation state
                    "_base_temp": random_base,
                    "_variation": random.uniform(8, 20),  # Larger variation for visible graphs
                    "_phase": random.uniform(0, 2 * math.pi),
                }
                sensors.append(sensor)
                created += 1
            
            group_idx += 1
        
        return sensors
    
    def _create_fans(self, count: int) -> List[Dict]:
        """Create mock fans with PWM control."""
        fans = []
        
        for i in range(count):
            fan_name = self.FAN_NAMES[i % len(self.FAN_NAMES)]
            if i >= len(self.FAN_NAMES):
                fan_name = f"{fan_name} {i // len(self.FAN_NAMES) + 1}"
            
            speed = random.randint(30, 70)
            
            fan = {
                "id": f"fan_{i + 1:03d}",
                "name": fan_name,
                "rpm": self._speed_to_rpm(speed),
                "speed": speed,
                "targetSpeed": speed,
                "status": "ok",
                "has_pwm_control": True,
                "pwm_file": f"/sys/class/hwmon/hwmon0/pwm{i + 1}",
            }
            fans.append(fan)
        
        return fans
    
    def _speed_to_rpm(self, speed: int) -> int:
        """Convert speed percentage to RPM."""
        min_rpm, max_rpm = self.rpm_range
        return int(min_rpm + (max_rpm - min_rpm) * speed / 100)
    
    def update(self):
        """Update sensor temperatures and fan RPMs with realistic variation."""
        current_time = time.time()
        
        # Update sensors
        for sensor in self.sensors:
            base = sensor["_base_temp"]
            variation = sensor["_variation"]
            phase = sensor["_phase"]
            
            # Slow sine wave + random noise for realistic thermal behavior
            time_factor = current_time / 60  # Period of ~1 minute (faster changes)
            periodic = math.sin(time_factor + phase) * variation
            noise = random.uniform(-3, 3)  # Larger noise
            
            new_temp = base + periodic + noise
            
            # Clamp to configured range
            min_temp, max_temp = self.temp_range
            new_temp = max(min_temp, min(max_temp, new_temp))
            
            sensor["temperature"] = round(new_temp, 1)
        
        # Update fans
        for fan in self.fans:
            # Small RPM variation (+/- 3%)
            target_rpm = self._speed_to_rpm(fan["targetSpeed"])
            variation = int(target_rpm * 0.03)
            fan["rpm"] = max(0, target_rpm + random.randint(-variation, variation))
            
            # Gradually adjust current speed toward target
            if fan["speed"] != fan["targetSpeed"]:
                diff = fan["targetSpeed"] - fan["speed"]
                step = max(1, abs(diff) // 5)
                if diff > 0:
                    fan["speed"] = min(fan["speed"] + step, fan["targetSpeed"])
                else:
                    fan["speed"] = max(fan["speed"] - step, fan["targetSpeed"])
    
    def set_fan_speed(self, fan_id: str, speed: int) -> bool:
        """Set fan target speed (0-100%)."""
        speed = max(0, min(100, speed))
        for fan in self.fans:
            if fan["id"] == fan_id:
                fan["targetSpeed"] = speed
                return True
        return False
    
    def emergency_stop(self):
        """Set all fans to 100%."""
        for fan in self.fans:
            fan["targetSpeed"] = 100
            fan["speed"] = 100
            fan["rpm"] = self._speed_to_rpm(100)
    
    def get_sensors_data(self) -> List[Dict]:
        """Get sensor data for telemetry (without internal state)."""
        return [
            {
                "id": s["id"],
                "name": s["name"],
                "temperature": s["temperature"],
                "type": s["type"],
                "max_temp": s["max_temp"],
                "crit_temp": s["crit_temp"],
                "chip": s["chip"],
                "source": s["source"],
            }
            for s in self.sensors
        ]
    
    def get_fans_data(self) -> List[Dict]:
        """Get fan data for telemetry."""
        return [
            {
                "id": f["id"],
                "name": f["name"],
                "rpm": f["rpm"],
                "speed": f["speed"],
                "targetSpeed": f["targetSpeed"],
                "status": f["status"],
                "has_pwm_control": f["has_pwm_control"],
                "pwm_file": f["pwm_file"],
            }
            for f in self.fans
        ]
    
    def get_system_health(self) -> Dict:
        """Get mock system health metrics."""
        uptime = time.time() - self.start_time
        return {
            "cpuUsage": round(random.uniform(5, 45), 1),
            "memoryUsage": round(random.uniform(25, 65), 1),
            "agentUptime": round(uptime, 1),
        }
