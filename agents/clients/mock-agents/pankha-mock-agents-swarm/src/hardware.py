"""
Pankha Mock Agents - Hardware Simulation

Generates realistic mock sensor and fan data.
Matches the exact data structures used by real Pankha agents.
Supports both Linux (sysfs/hwmon) and Windows (LibreHardwareMonitor) formats.
"""

import math
import random
import time
from typing import Dict, List, Tuple


# Hardware type to LibreHardwareMonitor type mapping (for Windows source paths)
_WIN_TYPE_MAP = {
    "cpu": "CPU",
    "gpu": "GpuNvidia",
    "nvme": "Storage",
    "motherboard": "SuperIO",
}


class MockHardware:
    """Generates realistic mock hardware data for a single agent."""

    # ── Linux chip groups (sysfs/hwmon naming) ──
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

    # ── Windows chip groups (LibreHardwareMonitor naming) ──
    # Format: (chip_id, hardware_name, sensor_type, [(sensor_name, base_temp, max_temp), ...])
    WIN_CHIP_GROUPS = [
        ("amdcpu", "AMD Ryzen 9 5900X", "cpu", [
            ("Tctl/Tdie", 35, 95),
            ("CCD1 (Tdie)", 30, 90),
            ("CCD2 (Tdie)", 30, 90),
        ]),
        ("intelcpu", "Intel Core i7-12700K", "cpu", [
            ("CPU Package", 35, 100),
            ("Core #0", 35, 100),
            ("Core #1", 35, 100),
            ("Core #2", 35, 100),
        ]),
        ("nvidiagpu", "NVIDIA GeForce RTX 3070", "gpu", [
            ("GPU Core", 30, 90),
            ("GPU Hot Spot", 35, 95),
            ("GPU Memory Junction", 30, 95),
        ]),
        ("amdgpu", "AMD Radeon RX 6800 XT", "gpu", [
            ("GPU Core", 30, 90),
            ("GPU Hot Spot", 35, 95),
        ]),
        ("nvmegeneric", "Samsung SSD 980 PRO 1TB", "nvme", [
            ("Temperature", 25, 70),
            ("Temperature 2", 25, 65),
        ]),
        ("superio", "Nuvoton NCT6798D", "motherboard", [
            ("CPU Core", 25, 60),
            ("System", 30, 70),
            ("Auxiliary", 25, 50),
            ("VRM MOS", 35, 100),
        ]),
    ]

    # Windows fan definitions: (label, chip_source)
    WIN_FAN_NAMES = [
        ("CPU_FAN", "superio"),
        ("SYS_FAN1", "superio"),
        ("SYS_FAN2", "superio"),
        ("CHA_FAN1", "superio"),
        ("CHA_FAN2", "superio"),
        ("AIO_PUMP", "superio"),
        ("GPU Fan", "nvidiagpu"),
        ("GPU Fan 2", "nvidiagpu"),
    ]

    def __init__(self, config: Dict):
        """Initialize hardware simulation from agent config.

        If config contains 'sensors' and 'fans' lists (persisted from a previous
        build), those definitions are loaded and only runtime simulation state is
        added.  Otherwise new hardware is generated from sensor_count/fan_count.
        """
        self.config = config
        self.platform: str = config.get("platform", "linux")
        self.start_time = time.time()

        # Extract ranges from config
        self.temp_range: Tuple[int, int] = tuple(config.get("temp_range", [25, 75]))
        self.speed_range: Tuple[int, int] = tuple(config.get("speed_range", [0, 100]))
        self.rpm_range: Tuple[int, int] = tuple(config.get("rpm_range", [0, 3000]))

        # Load persisted hardware or generate new
        if config.get("sensors") and isinstance(config["sensors"], list):
            self.sensors = self._load_sensors(config["sensors"])
        else:
            self.sensors = self._create_sensors(config.get("sensor_count", 8))

        if config.get("fans") and isinstance(config["fans"], list):
            self.fans = self._load_fans(config["fans"])
        else:
            self.fans = self._create_fans(config.get("fan_count", 4))

    def _load_sensors(self, defs: List[Dict]) -> List[Dict]:
        """Load persisted sensor definitions, adding runtime simulation state."""
        sensors = []
        for s in defs:
            sensor = dict(s)  # copy so we don't mutate config
            sensor["temperature"] = round(random.uniform(*self.temp_range), 1)
            sensor.setdefault("_base_temp", self._random_base_temp())
            sensor.setdefault("_variation", random.uniform(8, 20))
            sensor.setdefault("_phase", random.uniform(0, 2 * math.pi))
            sensor.setdefault("_max_cooling", random.uniform(12, 18))
            sensor.setdefault("_cooling_offset", 0.0)
            sensors.append(sensor)
        return sensors

    def _load_fans(self, defs: List[Dict]) -> List[Dict]:
        """Load persisted fan definitions, adding runtime simulation state."""
        fans = []
        for f in defs:
            fan = dict(f)
            speed = random.randint(30, 70)
            fan["rpm"] = self._speed_to_rpm(speed)
            fan["speed"] = speed
            fan["targetSpeed"] = speed
            fan["status"] = "ok"
            fans.append(fan)
        return fans

    def export_hardware(self) -> Dict:
        """Export sensor/fan definitions for persistence (no simulation state)."""
        sensor_keys = {"id", "name", "type", "max_temp", "crit_temp", "chip", "source", "hardwareName"}
        fan_keys = {"id", "name", "has_pwm_control", "pwm_file", "label", "_chip_source"}

        sensors = [{k: s[k] for k in sensor_keys if k in s} for s in self.sensors]
        fans = [{k: f[k] for k in fan_keys if k in f} for f in self.fans]
        return {"sensors": sensors, "fans": fans}
    
    def _create_sensors(self, count: int) -> List[Dict]:
        """Create mock temperature sensors grouped by chip type."""
        if self.platform == "windows":
            return self._create_sensors_windows(count)
        return self._create_sensors_linux(count)

    def _create_sensors_linux(self, count: int) -> List[Dict]:
        """Create Linux-style sensors (sysfs/hwmon paths)."""
        sensors = []
        created = 0
        group_idx = 0

        while created < count:
            chip_name, sensor_type, sensor_defs = self.CHIP_GROUPS[group_idx % len(self.CHIP_GROUPS)]
            hwmon_idx = group_idx

            for sensor_idx, (name, base_temp, max_temp) in enumerate(sensor_defs):
                if created >= count:
                    break

                random_base = self._random_base_temp()
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
                    "_base_temp": random_base,
                    "_variation": random.uniform(8, 20),
                    "_phase": random.uniform(0, 2 * math.pi),
                    "_max_cooling": random.uniform(12, 18),
                    "_cooling_offset": 0.0,
                }
                sensors.append(sensor)
                created += 1

            group_idx += 1

        return sensors

    def _create_sensors_windows(self, count: int) -> List[Dict]:
        """Create Windows-style sensors (LibreHardwareMonitor naming)."""
        sensors = []
        created = 0
        group_idx = 0

        while created < count:
            chip_id, hw_name, sensor_type, sensor_defs = self.WIN_CHIP_GROUPS[
                group_idx % len(self.WIN_CHIP_GROUPS)
            ]
            chip_index = group_idx // len(self.WIN_CHIP_GROUPS)

            for sensor_idx, (name, base_temp, max_temp) in enumerate(sensor_defs):
                if created >= count:
                    break

                random_base = self._random_base_temp()
                # Windows ID: {chip}_{chipIndex}_{sanitized_name}
                sanitized = name.lower().replace(" ", "_").replace("/", "_").replace("#", "").replace("(", "").replace(")", "")
                sensor_id = f"{chip_id}_{chip_index}_{sanitized}"
                # Windows source: {HardwareType}/{SensorName}
                hw_type = _WIN_TYPE_MAP.get(sensor_type, "Unknown")
                source = f"{hw_type}/{name}"

                sensor = {
                    "id": sensor_id,
                    "name": name,
                    "temperature": round(random.uniform(*self.temp_range), 1),
                    "type": sensor_type,
                    "max_temp": max_temp,
                    "crit_temp": max_temp + 10,
                    "chip": chip_id,
                    "source": source,
                    "hardwareName": hw_name,
                    "_base_temp": random_base,
                    "_variation": random.uniform(8, 20),
                    "_phase": random.uniform(0, 2 * math.pi),
                    "_max_cooling": random.uniform(12, 18),
                    "_cooling_offset": 0.0,
                }
                sensors.append(sensor)
                created += 1

            group_idx += 1

        return sensors

    def _random_base_temp(self) -> float:
        """Generate a random base temperature within the configured range."""
        min_temp, max_temp_config = self.temp_range
        range_size = max_temp_config - min_temp
        base_min = min_temp + (range_size * 0.2)
        base_max = max_temp_config - (range_size * 0.2)
        return random.uniform(base_min, base_max)
    
    def _create_fans(self, count: int) -> List[Dict]:
        """Create mock fans with PWM control."""
        if self.platform == "windows":
            return self._create_fans_windows(count)
        return self._create_fans_linux(count)

    def _create_fans_linux(self, count: int) -> List[Dict]:
        """Create Linux-style fans (sysfs pwm paths)."""
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

    def _create_fans_windows(self, count: int) -> List[Dict]:
        """Create Windows-style fans (LibreHardwareMonitor naming)."""
        fans = []

        for i in range(count):
            label, chip_source = self.WIN_FAN_NAMES[i % len(self.WIN_FAN_NAMES)]
            # Track per-chip fan index
            chip_fan_idx = sum(
                1 for f in fans
                if f.get("_chip_source") == chip_source
            )
            speed = random.randint(30, 70)

            fan = {
                "id": f"{chip_source}_0_fan_{chip_fan_idx}",
                "name": label,
                "rpm": self._speed_to_rpm(speed),
                "speed": speed,
                "targetSpeed": speed,
                "status": "ok",
                "has_pwm_control": True,
                "label": label,
                "_chip_source": chip_source,  # internal tracking
            }
            fans.append(fan)

        return fans
    
    def _speed_to_rpm(self, speed: int) -> int:
        """Convert speed percentage to RPM."""
        min_rpm, max_rpm = self.rpm_range
        return int(min_rpm + (max_rpm - min_rpm) * speed / 100)
    
    def update(self):
        """Update sensor temperatures and fan RPMs with realistic variation.

        Thermal coupling: fan speeds affect sensor temperatures.
        Higher fan speed → more cooling → lower temps (with thermal inertia).
        """
        current_time = time.time()

        # Compute average fan speed for cooling effect
        if self.fans:
            avg_fan_speed = sum(f["speed"] for f in self.fans) / len(self.fans)
        else:
            avg_fan_speed = 0.0
        cooling_factor = avg_fan_speed / 100.0  # 0.0 to 1.0

        # Update sensors with thermal coupling
        for sensor in self.sensors:
            base = sensor["_base_temp"]
            variation = sensor["_variation"]
            phase = sensor["_phase"]
            max_cooling = sensor["_max_cooling"]

            # Thermal inertia: cooling offset moves toward target at ~20% per tick
            target_cooling = cooling_factor * max_cooling
            sensor["_cooling_offset"] += (target_cooling - sensor["_cooling_offset"]) * 0.2

            # Slow sine wave + random noise for realistic thermal behavior
            time_factor = current_time / 60
            periodic = math.sin(time_factor + phase) * variation
            noise = random.uniform(-3, 3)

            new_temp = base + periodic + noise - sensor["_cooling_offset"]

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
        result = []
        for s in self.sensors:
            data = {
                "id": s["id"],
                "name": s["name"],
                "temperature": s["temperature"],
                "type": s["type"],
                "max_temp": s["max_temp"],
                "crit_temp": s["crit_temp"],
                "chip": s["chip"],
                "source": s["source"],
            }
            if self.platform == "windows" and "hardwareName" in s:
                data["hardwareName"] = s["hardwareName"]
            result.append(data)
        return result

    def get_fans_data(self) -> List[Dict]:
        """Get fan data for telemetry."""
        result = []
        for f in self.fans:
            data = {
                "id": f["id"],
                "name": f["name"],
                "rpm": f["rpm"],
                "speed": f["speed"],
                "targetSpeed": f["targetSpeed"],
                "status": f["status"],
                "has_pwm_control": f["has_pwm_control"],
            }
            if self.platform == "linux":
                data["pwm_file"] = f.get("pwm_file", "")
            if self.platform == "windows" and "label" in f:
                data["label"] = f["label"]
            result.append(data)
        return result
    
    def get_system_health(self) -> Dict:
        """Get mock system health metrics."""
        uptime = time.time() - self.start_time
        return {
            "cpuUsage": round(random.uniform(5, 45), 1),
            "memoryUsage": round(random.uniform(25, 65), 1),
            "agentUptime": round(uptime, 1),
        }
