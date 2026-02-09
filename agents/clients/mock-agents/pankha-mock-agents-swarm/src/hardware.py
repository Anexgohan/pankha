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
            self._init_sim_state(sensor)
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

                sensor_id = f"{chip_name}_{name.lower().replace(' ', '_')}"

                sensor = {
                    "id": sensor_id,
                    "name": name,
                    "type": sensor_type,
                    "max_temp": max_temp,
                    "crit_temp": max_temp + 10,
                    "chip": chip_name,
                    "source": f"/sys/class/hwmon/hwmon{hwmon_idx}/temp{sensor_idx + 1}_input",
                }
                self._init_sim_state(sensor)
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

                # Windows ID: {chip}_{chipIndex}_{sanitized_name}
                sanitized = name.lower().replace(" ", "_").replace("/", "_").replace("#", "").replace("(", "").replace(")", "")
                sensor_id = f"{chip_id}_{chip_index}_{sanitized}"
                # Windows source: {HardwareType}/{SensorName}
                hw_type = _WIN_TYPE_MAP.get(sensor_type, "Unknown")
                source = f"{hw_type}/{name}"

                sensor = {
                    "id": sensor_id,
                    "name": name,
                    "type": sensor_type,
                    "max_temp": max_temp,
                    "crit_temp": max_temp + 10,
                    "chip": chip_id,
                    "source": source,
                    "hardwareName": hw_name,
                }
                self._init_sim_state(sensor)
                sensors.append(sensor)
                created += 1

            group_idx += 1

        return sensors

    # Thermal profiles per sensor type
    #   idle_offset: °C above temp_range min at idle
    #   load_peak: °C above idle during a load event
    #   event_freq: probability of new event per tick when idle (0-1)
    #   event_dur: (min_ticks, max_ticks) — at 3s/tick: CPU 9s-5min, GPU 2.5-20min, etc.
    #   ramp_up: approach factor per tick when heating (0-1, higher = faster)
    #   ramp_down: approach factor per tick when cooling (0-1, lower = slower)
    THERMAL_PROFILES = {
        "cpu":         {"idle_offset": 8,  "load_peak": 35, "event_freq": 0.08, "event_dur": (3, 100),  "ramp_up": 0.4,  "ramp_down": 0.12},
        "gpu":         {"idle_offset": 5,  "load_peak": 40, "event_freq": 0.03, "event_dur": (50, 400), "ramp_up": 0.25, "ramp_down": 0.08},
        "nvme":        {"idle_offset": 3,  "load_peak": 12, "event_freq": 0.02, "event_dur": (30, 200), "ramp_up": 0.1,  "ramp_down": 0.05},
        "motherboard": {"idle_offset": 5,  "load_peak": 10, "event_freq": 0.015,"event_dur": (40, 300), "ramp_up": 0.08, "ramp_down": 0.04},
    }

    def _init_sim_state(self, sensor: Dict):
        """Initialize runtime simulation state on a sensor dict."""
        profile = self.THERMAL_PROFILES.get(sensor.get("type", "cpu"), self.THERMAL_PROFILES["cpu"])
        min_temp = self.temp_range[0]

        sensor["_idle_temp"] = min_temp + profile["idle_offset"] + random.uniform(-2, 2)
        sensor["_current_temp"] = sensor["_idle_temp"] + random.uniform(-1, 1)
        sensor["_profile"] = profile
        sensor["_max_cooling"] = random.uniform(10, 16)
        sensor["_cooling_offset"] = 0.0
        # Load event state
        sensor["_event_active"] = False
        sensor["_event_target"] = 0.0
        sensor["_event_ticks_left"] = 0
        sensor["temperature"] = round(sensor["_current_temp"], 1)
    
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
        """Update sensor temperatures and fan RPMs with event-driven simulation.

        Sensors experience random load events that cause realistic temperature
        spikes, with asymmetric ramp-up (fast) and cooldown (slow).  Fan speeds
        provide a cooling effect that reduces temperatures with thermal inertia.

        Sensors of the same chip share load events (correlated).
        """
        # ── Cooling from fans ──
        if self.fans:
            avg_fan_speed = sum(f["speed"] for f in self.fans) / len(self.fans)
        else:
            avg_fan_speed = 0.0
        cooling_factor = avg_fan_speed / 100.0

        # ── Chip-correlated load events ──
        # Decide per-chip whether a new load event starts this tick
        chip_events: Dict[str, bool] = {}
        for sensor in self.sensors:
            chip = sensor["chip"]
            if chip not in chip_events:
                profile = sensor["_profile"]
                chip_events[chip] = random.random() < profile["event_freq"]

        # ── Update each sensor ──
        min_temp, max_temp = self.temp_range
        for sensor in self.sensors:
            profile = sensor["_profile"]
            idle = sensor["_idle_temp"]
            current = sensor["_current_temp"]

            # Start new load event (chip-correlated)
            if not sensor["_event_active"] and chip_events.get(sensor["chip"], False):
                sensor["_event_active"] = True
                # Random intensity: 40-100% of load_peak, per-sensor variation
                intensity = random.uniform(0.4, 1.0)
                sensor["_event_target"] = idle + profile["load_peak"] * intensity
                dur_min, dur_max = profile["event_dur"]
                sensor["_event_ticks_left"] = random.randint(dur_min, dur_max)

            # Tick down active event
            if sensor["_event_active"]:
                sensor["_event_ticks_left"] -= 1
                if sensor["_event_ticks_left"] <= 0:
                    sensor["_event_active"] = False

            # Compute target temperature
            if sensor["_event_active"]:
                target = sensor["_event_target"]
                approach = profile["ramp_up"]
            else:
                target = idle
                approach = profile["ramp_down"]

            # Cooling effect (thermal inertia)
            target_cooling = cooling_factor * sensor["_max_cooling"]
            sensor["_cooling_offset"] += (target_cooling - sensor["_cooling_offset"]) * 0.2

            # Asymmetric approach toward target
            current += (target - current) * approach

            # Small noise for realism
            current += random.uniform(-0.5, 0.5)

            # Apply cooling
            current -= sensor["_cooling_offset"]

            # Clamp
            current = max(min_temp, min(max_temp, current))

            sensor["_current_temp"] = current
            sensor["temperature"] = round(current, 1)

        # ── Update fans ──
        for fan in self.fans:
            target_rpm = self._speed_to_rpm(fan["targetSpeed"])
            variation = int(target_rpm * 0.03)
            fan["rpm"] = max(0, target_rpm + random.randint(-variation, variation))

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
