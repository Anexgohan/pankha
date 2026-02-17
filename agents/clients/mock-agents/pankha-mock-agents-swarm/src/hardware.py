"""
Pankha Mock Agents - Hardware Simulation

Generates realistic mock sensor and fan data.
Matches the exact data structures used by real Pankha agents.
Supports both Linux (sysfs/hwmon) and Windows (LibreHardwareMonitor) formats.

Hardware is assembled from coherent system archetypes — each mock agent
represents a realistic machine with compatible components (no AMD+Intel
CPU mixing, no dual Super I/O chips, etc.).
"""

import random
import time
from typing import Dict, List, Tuple


# Hardware type to LibreHardwareMonitor type mapping (for Windows source paths)
_WIN_TYPE_MAP = {
    "cpu": "CPU",
    "gpu": "GpuNvidia",
    "gpu_amd": "GpuAti",
    "nvme": "Storage",
    "motherboard": "SuperIO",
}

# ─────────────────────────────────────────────────────────────────────
# Component Pools
#
# Each pool contains real hardware definitions for Linux (sysfs/hwmon)
# and Windows (LibreHardwareMonitor).  One entry per distinct hardware
# variant.  The archetype picker selects compatible components from
# these pools to assemble a coherent system.
# ─────────────────────────────────────────────────────────────────────

CPUS = {
    "linux": [
        # AMD Ryzen — k10temp driver
        {"chip": "k10temp", "type": "cpu", "brand": "amd",
         "hw_name": "AMD Ryzen 5 5600X", "sensors": [
            {"name": "Tctl", "max_temp": 95},
            {"name": "Tdie", "max_temp": 95},
            {"name": "Tccd1", "max_temp": 90},
        ]},
        {"chip": "k10temp", "type": "cpu", "brand": "amd",
         "hw_name": "AMD Ryzen 9 5900X", "sensors": [
            {"name": "Tctl", "max_temp": 95},
            {"name": "Tdie", "max_temp": 95},
            {"name": "Tccd1", "max_temp": 90},
            {"name": "Tccd2", "max_temp": 90},
        ]},
        # Intel Core — coretemp driver
        {"chip": "coretemp", "type": "cpu", "brand": "intel",
         "hw_name": "Intel Core i5-12600K", "sensors": [
            {"name": "Package id 0", "max_temp": 100},
            {"name": "Core 0", "max_temp": 100},
            {"name": "Core 1", "max_temp": 100},
            {"name": "Core 2", "max_temp": 100},
            {"name": "Core 3", "max_temp": 100},
        ]},
        {"chip": "coretemp", "type": "cpu", "brand": "intel",
         "hw_name": "Intel Core i7-13700K", "sensors": [
            {"name": "Package id 0", "max_temp": 100},
            {"name": "Core 0", "max_temp": 100},
            {"name": "Core 1", "max_temp": 100},
            {"name": "Core 2", "max_temp": 100},
            {"name": "Core 3", "max_temp": 100},
            {"name": "Core 4", "max_temp": 100},
            {"name": "Core 5", "max_temp": 100},
        ]},
        {"chip": "coretemp", "type": "cpu", "brand": "intel",
         "hw_name": "Intel Core i9-13900K", "sensors": [
            {"name": "Package id 0", "max_temp": 100},
            {"name": "Core 0", "max_temp": 100},
            {"name": "Core 1", "max_temp": 100},
            {"name": "Core 2", "max_temp": 100},
            {"name": "Core 3", "max_temp": 100},
            {"name": "Core 4", "max_temp": 100},
            {"name": "Core 5", "max_temp": 100},
            {"name": "Core 6", "max_temp": 100},
            {"name": "Core 7", "max_temp": 100},
        ]},
    ],
    "windows": [
        {"chip": "amdcpu", "type": "cpu", "brand": "amd",
         "hw_name": "AMD Ryzen 7 5800X", "sensors": [
            {"name": "Tctl/Tdie", "max_temp": 95},
            {"name": "CCD1 (Tdie)", "max_temp": 90},
        ]},
        {"chip": "amdcpu", "type": "cpu", "brand": "amd",
         "hw_name": "AMD Ryzen 9 5950X", "sensors": [
            {"name": "Tctl/Tdie", "max_temp": 95},
            {"name": "CCD1 (Tdie)", "max_temp": 90},
            {"name": "CCD2 (Tdie)", "max_temp": 90},
        ]},
        {"chip": "amdcpu", "type": "cpu", "brand": "amd",
         "hw_name": "AMD Ryzen 9 7950X", "sensors": [
            {"name": "Tctl/Tdie", "max_temp": 95},
            {"name": "CCD1 (Tdie)", "max_temp": 90},
            {"name": "CCD2 (Tdie)", "max_temp": 90},
        ]},
        {"chip": "intelcpu", "type": "cpu", "brand": "intel",
         "hw_name": "Intel Core i5-12600K", "sensors": [
            {"name": "CPU Package", "max_temp": 100},
            {"name": "Core #0", "max_temp": 100},
            {"name": "Core #1", "max_temp": 100},
            {"name": "Core #2", "max_temp": 100},
            {"name": "Core #3", "max_temp": 100},
        ]},
        {"chip": "intelcpu", "type": "cpu", "brand": "intel",
         "hw_name": "Intel Core i7-13700K", "sensors": [
            {"name": "CPU Package", "max_temp": 100},
            {"name": "Core #0", "max_temp": 100},
            {"name": "Core #1", "max_temp": 100},
            {"name": "Core #2", "max_temp": 100},
            {"name": "Core #3", "max_temp": 100},
            {"name": "Core #4", "max_temp": 100},
            {"name": "Core #5", "max_temp": 100},
        ]},
        {"chip": "intelcpu", "type": "cpu", "brand": "intel",
         "hw_name": "Intel Core i9-13900K", "sensors": [
            {"name": "CPU Package", "max_temp": 100},
            {"name": "Core #0", "max_temp": 100},
            {"name": "Core #1", "max_temp": 100},
            {"name": "Core #2", "max_temp": 100},
            {"name": "Core #3", "max_temp": 100},
            {"name": "Core #4", "max_temp": 100},
            {"name": "Core #5", "max_temp": 100},
            {"name": "Core #6", "max_temp": 100},
            {"name": "Core #7", "max_temp": 100},
        ]},
    ],
}

MOTHERBOARDS = {
    "linux": [
        # ASUS → Nuvoton NCT6798D
        {"chip": "nct6798", "type": "motherboard", "hw_name": "Nuvoton NCT6798D", "desc": "ASUS B550/X570",
         "sensors": [
            {"name": "SYSTIN", "max_temp": 60},
            {"name": "CPUTIN", "max_temp": 70},
            {"name": "AUXTIN0", "max_temp": 50},
            {"name": "AUXTIN1", "max_temp": 50},
         ],
         "fans": ["CPU Fan", "System Fan 1", "System Fan 2",
                  "Chassis Fan 1", "Chassis Fan 2", "AIO Pump"],
        },
        # Gigabyte → ITE IT8689E
        {"chip": "it8689e", "type": "motherboard", "hw_name": "ITE IT8689E", "desc": "Gigabyte Z690/B550",
         "sensors": [
            {"name": "System", "max_temp": 60},
            {"name": "Chipset", "max_temp": 70},
            {"name": "VRM", "max_temp": 100},
         ],
         "fans": ["CPU Fan", "System Fan 1", "System Fan 2",
                  "System Fan 3", "CPU OPT"],
        },
        # Gigabyte → ITE IT8686E
        {"chip": "it8686e", "type": "motherboard", "hw_name": "ITE IT8686E", "desc": "Gigabyte B660/B550M",
         "sensors": [
            {"name": "System", "max_temp": 60},
            {"name": "Chipset", "max_temp": 70},
            {"name": "VRM", "max_temp": 100},
         ],
         "fans": ["CPU Fan", "System Fan 1", "System Fan 2", "System Fan 3"],
        },
        # ASRock → Nuvoton NCT6796D
        {"chip": "nct6796d", "type": "motherboard", "hw_name": "Nuvoton NCT6796D", "desc": "ASRock B550/X670E",
         "sensors": [
            {"name": "SYSTIN", "max_temp": 60},
            {"name": "CPUTIN", "max_temp": 70},
            {"name": "AUXTIN0", "max_temp": 50},
         ],
         "fans": ["CPU Fan 1", "Chassis Fan 1", "Chassis Fan 2",
                  "Chassis Fan 3", "CPU Fan 2"],
        },
        # ASUS older/budget → Nuvoton NCT6775
        {"chip": "nct6775", "type": "motherboard", "hw_name": "Nuvoton NCT6775F", "desc": "ASUS B450/A520",
         "sensors": [
            {"name": "SYSTIN", "max_temp": 60},
            {"name": "CPUTIN", "max_temp": 70},
            {"name": "AUXTIN", "max_temp": 50},
         ],
         "fans": ["CPU Fan", "System Fan 1", "System Fan 2", "Chassis Fan"],
        },
        # Budget boards → ITE IT8628E
        {"chip": "it8628e", "type": "motherboard", "hw_name": "ITE IT8628E", "desc": "Budget B450/H410",
         "sensors": [
            {"name": "System", "max_temp": 60},
            {"name": "Chipset", "max_temp": 70},
            {"name": "VRM", "max_temp": 100},
         ],
         "fans": ["CPU Fan", "Rear Fan", "Front Fan 1"],
        },
    ],
    "windows": [
        {"chip": "superio", "type": "motherboard",
         "hw_name": "Nuvoton NCT6798D", "desc": "ASUS B550/X570",
         "sensors": [
            {"name": "CPU Core", "max_temp": 60},
            {"name": "System", "max_temp": 70},
            {"name": "Auxiliary", "max_temp": 50},
            {"name": "VRM MOS", "max_temp": 100},
         ],
         "fans": ["CPU_FAN", "SYS_FAN1", "SYS_FAN2",
                  "CHA_FAN1", "CHA_FAN2", "AIO_PUMP"],
        },
        {"chip": "superio", "type": "motherboard",
         "hw_name": "ITE IT8689E", "desc": "Gigabyte Z690/B550",
         "sensors": [
            {"name": "System", "max_temp": 60},
            {"name": "Chipset", "max_temp": 70},
            {"name": "VRM", "max_temp": 100},
         ],
         "fans": ["CPU_FAN", "SYS_FAN1", "SYS_FAN2", "SYS_FAN3", "CPU_OPT"],
        },
        {"chip": "superio", "type": "motherboard",
         "hw_name": "ITE IT8686E", "desc": "Gigabyte B660/B550M",
         "sensors": [
            {"name": "System", "max_temp": 60},
            {"name": "Chipset", "max_temp": 70},
            {"name": "VRM", "max_temp": 100},
         ],
         "fans": ["CPU_FAN", "SYS_FAN1", "SYS_FAN2", "SYS_FAN3"],
        },
        {"chip": "superio", "type": "motherboard",
         "hw_name": "Nuvoton NCT6796D", "desc": "ASRock B550/X670E",
         "sensors": [
            {"name": "CPU Core", "max_temp": 60},
            {"name": "System", "max_temp": 70},
            {"name": "Auxiliary", "max_temp": 50},
         ],
         "fans": ["CPU_FAN1", "CHA_FAN1", "CHA_FAN2", "CHA_FAN3", "CPU_FAN2"],
        },
        {"chip": "superio", "type": "motherboard",
         "hw_name": "Nuvoton NCT6775F", "desc": "ASUS B450/A520",
         "sensors": [
            {"name": "CPU Core", "max_temp": 60},
            {"name": "System", "max_temp": 70},
            {"name": "Auxiliary", "max_temp": 50},
         ],
         "fans": ["CPU_FAN", "SYS_FAN1", "SYS_FAN2", "CHA_FAN"],
        },
        {"chip": "superio", "type": "motherboard",
         "hw_name": "ITE IT8628E", "desc": "Budget B450/H410",
         "sensors": [
            {"name": "System", "max_temp": 60},
            {"name": "Chipset", "max_temp": 70},
            {"name": "VRM", "max_temp": 100},
         ],
         "fans": ["CPU_FAN", "REAR_FAN", "FRONT_FAN1"],
        },
    ],
}

GPUS = {
    "linux": [
        # NVIDIA (limited hwmon via proprietary driver)
        {"chip": "nvidia", "type": "gpu", "brand": "nvidia",
         "hw_name": "NVIDIA GeForce RTX 3060", "sensors": [
            {"name": "GPU Core", "max_temp": 90},
        ]},
        {"chip": "nvidia", "type": "gpu", "brand": "nvidia",
         "hw_name": "NVIDIA GeForce RTX 3070", "sensors": [
            {"name": "GPU Core", "max_temp": 90},
            {"name": "GPU Hot Spot", "max_temp": 95},
        ]},
        # AMD (full hwmon via amdgpu driver)
        {"chip": "amdgpu", "type": "gpu", "brand": "amd",
         "hw_name": "AMD Radeon RX 6700 XT", "sensors": [
            {"name": "edge", "max_temp": 90},
            {"name": "junction", "max_temp": 95},
        ]},
        {"chip": "amdgpu", "type": "gpu", "brand": "amd",
         "hw_name": "AMD Radeon RX 7800 XT", "sensors": [
            {"name": "edge", "max_temp": 90},
        ]},
    ],
    "windows": [
        {"chip": "nvidiagpu", "type": "gpu", "brand": "nvidia",
         "hw_name": "NVIDIA GeForce RTX 3060", "sensors": [
            {"name": "GPU Core", "max_temp": 90},
            {"name": "GPU Hot Spot", "max_temp": 95},
        ]},
        {"chip": "nvidiagpu", "type": "gpu", "brand": "nvidia",
         "hw_name": "NVIDIA GeForce RTX 3070", "sensors": [
            {"name": "GPU Core", "max_temp": 90},
            {"name": "GPU Hot Spot", "max_temp": 95},
            {"name": "GPU Memory Junction", "max_temp": 95},
        ]},
        {"chip": "nvidiagpu", "type": "gpu", "brand": "nvidia",
         "hw_name": "NVIDIA GeForce RTX 4070", "sensors": [
            {"name": "GPU Core", "max_temp": 90},
            {"name": "GPU Hot Spot", "max_temp": 95},
        ]},
        {"chip": "nvidiagpu", "type": "gpu", "brand": "nvidia",
         "hw_name": "NVIDIA GeForce RTX 4080", "sensors": [
            {"name": "GPU Core", "max_temp": 90},
            {"name": "GPU Hot Spot", "max_temp": 95},
        ]},
        {"chip": "amdgpu", "type": "gpu", "brand": "amd",
         "hw_name": "AMD Radeon RX 6700 XT", "sensors": [
            {"name": "GPU Core", "max_temp": 90},
            {"name": "GPU Hot Spot", "max_temp": 95},
        ]},
        {"chip": "amdgpu", "type": "gpu", "brand": "amd",
         "hw_name": "AMD Radeon RX 7800 XT", "sensors": [
            {"name": "GPU Core", "max_temp": 90},
            {"name": "GPU Hot Spot", "max_temp": 95},
        ]},
    ],
}

NVME_DRIVES = {
    "linux": [
        {"chip": "nvme", "type": "nvme", "hw_name": "Samsung 980 PRO 1TB", "sensors": [
            {"name": "Composite", "max_temp": 70},
            {"name": "Sensor 1", "max_temp": 65},
        ]},
        {"chip": "nvme", "type": "nvme", "hw_name": "WD Black SN850X 1TB", "sensors": [
            {"name": "Composite", "max_temp": 70},
        ]},
        {"chip": "nvme", "type": "nvme", "hw_name": "Kingston NV2 500GB", "sensors": [
            {"name": "Composite", "max_temp": 70},
        ]},
        {"chip": "nvme", "type": "nvme", "hw_name": "Crucial P3 Plus 1TB", "sensors": [
            {"name": "Composite", "max_temp": 70},
        ]},
        {"chip": "nvme", "type": "nvme", "hw_name": "Sabrent Rocket 4 Plus 2TB", "sensors": [
            {"name": "Composite", "max_temp": 70},
            {"name": "Sensor 1", "max_temp": 65},
        ]},
    ],
    "windows": [
        {"chip": "nvmegeneric", "type": "nvme",
         "hw_name": "Samsung SSD 980 PRO 1TB", "sensors": [
            {"name": "Temperature", "max_temp": 70},
            {"name": "Temperature 2", "max_temp": 65},
        ]},
        {"chip": "nvmegeneric", "type": "nvme",
         "hw_name": "WD Black SN850X 1TB", "sensors": [
            {"name": "Temperature", "max_temp": 70},
        ]},
        {"chip": "nvmegeneric", "type": "nvme",
         "hw_name": "Kingston NV2 500GB", "sensors": [
            {"name": "Temperature", "max_temp": 70},
        ]},
        {"chip": "nvmegeneric", "type": "nvme",
         "hw_name": "Crucial P3 Plus 1TB", "sensors": [
            {"name": "Temperature", "max_temp": 70},
        ]},
        {"chip": "nvmegeneric", "type": "nvme",
         "hw_name": "Sabrent Rocket 4 Plus 2TB", "sensors": [
            {"name": "Temperature", "max_temp": 70},
            {"name": "Temperature 2", "max_temp": 65},
        ]},
    ],
}


class MockHardware:
    """Generates realistic mock hardware data for a single agent.

    Each agent is assembled from a coherent system archetype: one CPU,
    one motherboard (Super I/O chip), zero to two GPUs, and zero to two
    NVMe drives.  No impossible combinations (e.g. AMD + Intel CPU).
    """

    # Thermal profiles per sensor type
    #   idle_offset: deg C above temp_range min at idle
    #   load_peak: deg C above idle during a load event
    #   event_freq: probability of new event per tick when idle (0-1)
    #   event_dur: (min_ticks, max_ticks) — at 3s/tick: CPU 9s-5min, GPU 2.5-20min, etc.
    #   ramp_up: approach factor per tick when heating (0-1, higher = faster)
    #   ramp_down: approach factor per tick when cooling (0-1, lower = slower)
    THERMAL_PROFILES = {
        "cpu":         {"idle_offset": 8,  "load_peak": 35, "event_freq": 0.08, "event_dur": (3, 100),  "ramp_up": 0.4,  "ramp_down": 0.12, "max_cooling": (10, 16)},
        "gpu":         {"idle_offset": 5,  "load_peak": 40, "event_freq": 0.03, "event_dur": (50, 400), "ramp_up": 0.25, "ramp_down": 0.08, "max_cooling": (10, 16)},
        "nvme":        {"idle_offset": 3,  "load_peak": 15, "event_freq": 0.05, "event_dur": (30, 200), "ramp_up": 0.18, "ramp_down": 0.07, "max_cooling": (0.2, 0.8)},
        "motherboard": {"idle_offset": 5,  "load_peak": 12, "event_freq": 0.04, "event_dur": (40, 300), "ramp_up": 0.15, "ramp_down": 0.06, "max_cooling": (0.2, 0.6)},
    }

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

        # ── System health simulation state ──
        self._cpu_usage = random.uniform(5, 15)       # current value
        self._cpu_usage_idle = random.uniform(5, 12)   # baseline when no load
        self._mem_usage = random.uniform(30, 55)       # mostly stable
        self._mem_target = self._mem_usage              # target for gentle drift

    # ── Persistence helpers ──────────────────────────────────────────

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

    # ── System archetype assembly ────────────────────────────────────

    def _pick_system_archetype(self, sensor_count: int) -> Dict:
        """Select a coherent set of hardware components for this agent.

        Builds a realistic system by picking non-CPU components first
        (motherboard, GPU, NVMe) scaled to the sensor budget, then
        selecting a CPU that fills the remaining slots.  This prevents
        a large CPU from monopolizing all sensor slots.

        Returns a dict with keys: cpu, motherboard, gpus, nvmes.
        """
        pool_key = self.platform if self.platform == "windows" else "linux"

        def _copy(c):
            return {**c, "sensors": list(c["sensors"]),
                    "fans": list(c.get("fans", []))}

        def _sample(pool, n):
            items = random.sample(pool, min(n, len(pool)))
            return [_copy(c) for c in items]

        # ── 1. Motherboard (always present) ──
        mobo = _copy(random.choice(MOTHERBOARDS[pool_key]))

        # ── 2. Optional devices — scale with sensor budget ──
        # Small systems (≤6):  CPU + mobo only, maybe 1 GPU or NVMe
        # Medium systems (7-9):  usually 1 GPU or NVMe, sometimes both
        # Large systems (10+):  GPU + NVMe, occasionally multiples
        if sensor_count >= 10:
            gpu_count = 2 if random.random() < 0.15 else 1
            nvme_count = 2 if random.random() < 0.30 else 1
        elif sensor_count >= 7:
            if random.random() < 0.35:
                gpu_count, nvme_count = 1, 1
            elif random.random() < 0.55:
                gpu_count, nvme_count = 1, 0
            else:
                gpu_count, nvme_count = 0, 1
        elif sensor_count >= 5:
            if random.random() < 0.45:
                gpu_count, nvme_count = 1, 0
            elif random.random() < 0.35:
                gpu_count, nvme_count = 0, 1
            else:
                gpu_count, nvme_count = 0, 0
        else:
            gpu_count, nvme_count = 0, 0

        gpus = _sample(GPUS[pool_key], gpu_count)
        nvmes = _sample(NVME_DRIVES[pool_key], nvme_count)

        # ── 3. CPU — sized to fill remaining budget ──
        non_cpu_total = sum(
            len(c["sensors"]) for c in [mobo] + gpus + nvmes
        )
        cpu_budget = max(2, sensor_count - non_cpu_total)

        # Pick a CPU whose sensor count fits within budget.
        # Among fitting CPUs, prefer larger ones (more cores = more realistic
        # for the sensor count).
        cpu_pool = CPUS[pool_key]
        fitting = [c for c in cpu_pool if len(c["sensors"]) <= cpu_budget]
        if fitting:
            best_size = max(len(c["sensors"]) for c in fitting)
            # Random pick from CPUs within 1 sensor of the best fit
            top = [c for c in fitting if len(c["sensors"]) >= best_size - 1]
            cpu = _copy(random.choice(top))
        else:
            # All CPUs are too big — pick the smallest, trimming below
            cpu = _copy(min(cpu_pool, key=lambda c: len(c["sensors"])))

        # ── 4. Safety trim (handles edge cases) ──
        MIN_CPU = 2
        MIN_MOBO = 1
        total = sum(len(c["sensors"]) for c in [cpu, mobo] + gpus + nvmes)

        if sensor_count < total:
            excess = total - sensor_count
            # Trim: NVMe → GPU → mobo → CPU
            for comp in reversed(nvmes + gpus):
                if excess <= 0:
                    break
                trim = min(excess, len(comp["sensors"]))
                if trim > 0:
                    comp["sensors"] = comp["sensors"][:len(comp["sensors"]) - trim]
                    excess -= trim
            if excess > 0:
                can_trim = max(0, len(mobo["sensors"]) - MIN_MOBO)
                trim = min(excess, can_trim)
                if trim > 0:
                    mobo["sensors"] = mobo["sensors"][:len(mobo["sensors"]) - trim]
                    excess -= trim
            if excess > 0:
                can_trim = max(0, len(cpu["sensors"]) - MIN_CPU)
                trim = min(excess, can_trim)
                if trim > 0:
                    cpu["sensors"] = cpu["sensors"][:len(cpu["sensors"]) - trim]
                    excess -= trim

        # Drop fully-trimmed optional devices (and their fans)
        gpus = [g for g in gpus if g["sensors"]]
        nvmes = [n for n in nvmes if n["sensors"]]

        return {
            "cpu": cpu,
            "motherboard": mobo,
            "gpus": gpus,
            "nvmes": nvmes,
        }

    # ── Sensor creation ──────────────────────────────────────────────

    def _create_sensors(self, count: int) -> List[Dict]:
        """Create mock temperature sensors from a coherent system archetype."""
        if self.platform == "windows":
            return self._create_sensors_windows(count)
        return self._create_sensors_linux(count)

    def _sanitize_id(self, name: str) -> str:
        """Sanitize a sensor name into an ID segment (lowercase, special chars → _)."""
        return (name.lower()
                .replace(" ", "_")
                .replace("/", "_")
                .replace("#", "")
                .replace("(", "")
                .replace(")", ""))

    def _create_sensors_linux(self, count: int) -> List[Dict]:
        """Create Linux-style sensors (sysfs/hwmon paths) from archetype."""
        arch = self._pick_system_archetype(count)
        # Store archetype for fan creation
        self._archetype = arch

        sensors = []
        hwmon_idx = 0
        # Track chip instances for unique IDs (e.g. 2 NVMe drives both use chip "nvme")
        chip_instances: Dict[str, int] = {}

        # Order: CPU, motherboard, GPUs, NVMe drives
        # Each component gets its own hwmon index
        components = [arch["cpu"], arch["motherboard"]] + arch["gpus"] + arch["nvmes"]

        for comp in components:
            chip = comp["chip"]
            instance = chip_instances.get(chip, 0)
            chip_instances[chip] = instance + 1

            for sensor_idx, sdef in enumerate(comp["sensors"]):
                if len(sensors) >= count:
                    break

                sanitized = self._sanitize_id(sdef["name"])
                # Append instance index when multiple components share a chip
                if instance > 0:
                    sensor_id = f"{chip}{instance}_{sanitized}"
                else:
                    sensor_id = f"{chip}_{sanitized}"

                sensor = {
                    "id": sensor_id,
                    "name": sdef["name"],
                    "type": comp["type"],
                    "max_temp": sdef["max_temp"],
                    "crit_temp": sdef["max_temp"] + 10,
                    "chip": chip,
                    "source": f"/sys/class/hwmon/hwmon{hwmon_idx}/temp{sensor_idx + 1}_input",
                }
                hw_name = comp.get("hw_name", "")
                if hw_name:
                    sensor["hardwareName"] = hw_name
                self._init_sim_state(sensor)
                sensors.append(sensor)

            hwmon_idx += 1
            if len(sensors) >= count:
                break

        return sensors

    def _create_sensors_windows(self, count: int) -> List[Dict]:
        """Create Windows-style sensors (LibreHardwareMonitor naming) from archetype."""
        arch = self._pick_system_archetype(count)
        # Store archetype for fan creation
        self._archetype = arch

        sensors = []
        # Track chip_index per chip type (for multiple GPUs or NVMe)
        chip_indices: Dict[str, int] = {}

        components = [arch["cpu"], arch["motherboard"]] + arch["gpus"] + arch["nvmes"]

        for comp in components:
            chip = comp["chip"]
            chip_index = chip_indices.get(chip, 0)
            chip_indices[chip] = chip_index + 1

            hw_name = comp.get("hw_name", "")
            hw_type_key = comp["type"]
            # AMD GPUs use GpuAti in LHM
            if hw_type_key == "gpu" and comp.get("brand") == "amd":
                hw_type_key = "gpu_amd"
            hw_type = _WIN_TYPE_MAP.get(hw_type_key, "Unknown")

            for sdef in comp["sensors"]:
                if len(sensors) >= count:
                    break

                sanitized = self._sanitize_id(sdef["name"])
                sensor_id = f"{chip}_{chip_index}_{sanitized}"
                source = f"{hw_type}/{sdef['name']}"

                sensor = {
                    "id": sensor_id,
                    "name": sdef["name"],
                    "type": comp["type"],
                    "max_temp": sdef["max_temp"],
                    "crit_temp": sdef["max_temp"] + 10,
                    "chip": chip,
                    "source": source,
                    "hardwareName": hw_name,
                }
                self._init_sim_state(sensor)
                sensors.append(sensor)

            if len(sensors) >= count:
                break

        return sensors

    # ── Fan creation ─────────────────────────────────────────────────

    def _create_fans(self, count: int) -> List[Dict]:
        """Create mock fans with PWM control."""
        if self.platform == "windows":
            return self._create_fans_windows(count)
        return self._create_fans_linux(count)

    def _create_fans_linux(self, count: int) -> List[Dict]:
        """Create Linux-style fans (sysfs pwm paths) using mobo chip name."""
        fans = []
        arch = getattr(self, "_archetype", None)

        if arch is None:
            # Fallback if called without sensors being created first
            # (shouldn't happen in normal flow)
            arch = self._pick_system_archetype(8)
            self._archetype = arch

        mobo = arch["motherboard"]
        mobo_chip = mobo["chip"]
        mobo_fan_names = mobo["fans"]
        gpus = arch["gpus"]

        # Motherboard hwmon index: CPU is hwmon0, mobo is hwmon1
        mobo_hwmon_idx = 1

        # GPU hwmon indices: after CPU(0), mobo(1)
        gpu_hwmon_base = 2

        # Mobo fans first
        fan_idx = 0
        for i, fan_name in enumerate(mobo_fan_names):
            if fan_idx >= count:
                break
            speed = random.randint(30, 70)
            fan = {
                "id": f"{mobo_chip}_fan_{i + 1}",
                "name": fan_name,
                "rpm": self._speed_to_rpm(speed),
                "speed": speed,
                "targetSpeed": speed,
                "status": "ok",
                "has_pwm_control": True,
                "pwm_file": f"/sys/class/hwmon/hwmon{mobo_hwmon_idx}/pwm{i + 1}",
            }
            fans.append(fan)
            fan_idx += 1

        # GPU fans: 1 fan per GPU (use instance index for unique IDs)
        for gpu_i, gpu in enumerate(gpus):
            if fan_idx >= count:
                break
            gpu_chip = gpu["chip"]
            gpu_hwmon = gpu_hwmon_base + gpu_i
            chip_instance = gpu.get("_instance", gpu_i)
            speed = random.randint(30, 70)
            fan = {
                "id": f"{gpu_chip}{chip_instance}_fan_1" if chip_instance > 0 else f"{gpu_chip}_fan_1",
                "name": f"GPU Fan{f' {chip_instance + 1}' if chip_instance > 0 else ''}",
                "rpm": self._speed_to_rpm(speed),
                "speed": speed,
                "targetSpeed": speed,
                "status": "ok",
                "has_pwm_control": True,
                "pwm_file": f"/sys/class/hwmon/hwmon{gpu_hwmon}/pwm1",
            }
            fans.append(fan)
            fan_idx += 1

        return fans

    def _create_fans_windows(self, count: int) -> List[Dict]:
        """Create Windows-style fans (LibreHardwareMonitor naming)."""
        fans = []
        arch = getattr(self, "_archetype", None)

        if arch is None:
            arch = self._pick_system_archetype(8)
            self._archetype = arch

        mobo = arch["motherboard"]
        mobo_fan_names = mobo["fans"]
        gpus = arch["gpus"]

        # Mobo fans (chip = superio)
        fan_idx = 0
        superio_fan_idx = 0
        for fan_name in mobo_fan_names:
            if fan_idx >= count:
                break
            speed = random.randint(30, 70)
            fan = {
                "id": f"superio_0_fan_{superio_fan_idx}",
                "name": fan_name,
                "rpm": self._speed_to_rpm(speed),
                "speed": speed,
                "targetSpeed": speed,
                "status": "ok",
                "has_pwm_control": True,
                "label": fan_name,
                "_chip_source": "superio",
            }
            fans.append(fan)
            fan_idx += 1
            superio_fan_idx += 1

        # GPU fans: 1 fan per GPU, chip matches the actual GPU
        for gpu_i, gpu in enumerate(gpus):
            if fan_idx >= count:
                break
            gpu_chip = gpu["chip"]  # "nvidiagpu" or "amdgpu"
            speed = random.randint(30, 70)
            fan = {
                "id": f"{gpu_chip}_{gpu_i}_fan_0",
                "name": "GPU Fan",
                "rpm": self._speed_to_rpm(speed),
                "speed": speed,
                "targetSpeed": speed,
                "status": "ok",
                "has_pwm_control": True,
                "label": "GPU Fan",
                "_chip_source": gpu_chip,
            }
            fans.append(fan)
            fan_idx += 1

        return fans

    # ── Simulation state ─────────────────────────────────────────────

    def _init_sim_state(self, sensor: Dict):
        """Initialize runtime simulation state on a sensor dict."""
        profile = self.THERMAL_PROFILES.get(sensor.get("type", "cpu"), self.THERMAL_PROFILES["cpu"])
        min_temp = self.temp_range[0]

        sensor["_idle_temp"] = min_temp + profile["idle_offset"] + random.uniform(-2, 2)
        sensor["_current_temp"] = sensor["_idle_temp"] + random.uniform(-1, 1)
        sensor["_profile"] = profile
        cooling_range = profile.get("max_cooling", (10, 16))
        sensor["_max_cooling"] = random.uniform(*cooling_range)
        sensor["_cooling_offset"] = 0.0
        # Load event state
        sensor["_event_active"] = False
        sensor["_event_target"] = 0.0
        sensor["_event_ticks_left"] = 0
        sensor["temperature"] = round(sensor["_current_temp"], 1)

    def _speed_to_rpm(self, speed: int) -> int:
        """Convert speed percentage to RPM."""
        min_rpm, max_rpm = self.rpm_range
        return int(min_rpm + (max_rpm - min_rpm) * speed / 100)

    # ── Runtime update ───────────────────────────────────────────────

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
        # Check if CPU or GPU currently have active load events.
        # Motherboard and NVMe temps correlate with CPU/GPU activity:
        # VRM heats up under CPU load, storage is busy when system is busy.
        cpu_gpu_active = any(
            s["_event_active"] for s in self.sensors
            if s["type"] in ("cpu", "gpu")
        )

        # Decide per-chip whether a new load event starts this tick
        chip_events: Dict[str, bool] = {}
        for sensor in self.sensors:
            chip = sensor["chip"]
            if chip not in chip_events:
                profile = sensor["_profile"]
                freq = profile["event_freq"]
                # When CPU/GPU are under load, mobo and NVMe very likely to
                # also start heating — VRM from CPU power, NVMe from I/O
                if cpu_gpu_active and sensor["type"] in ("motherboard", "nvme"):
                    freq = min(freq * 6, 0.5)
                chip_events[chip] = random.random() < freq

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
        # Apply target speed immediately — the backend's FanProfileController
        # already handles gradual stepping via fan_step_percent, so mock
        # hardware should not add its own ramping on top.
        for fan in self.fans:
            fan["speed"] = fan["targetSpeed"]
            target_rpm = self._speed_to_rpm(fan["speed"])
            variation = int(target_rpm * 0.03)
            fan["rpm"] = max(0, target_rpm + random.randint(-variation, variation))

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

    # ── Telemetry output ─────────────────────────────────────────────

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
            if "hardwareName" in s:
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
        """Get mock system health metrics with event-driven simulation.

        CPU usage correlates with active CPU thermal events (same load events
        that drive temperature spikes).  Memory is mostly stable with small
        random drift, simulating long-running processes.
        """
        uptime = time.time() - self.start_time

        # ── CPU usage: correlate with CPU sensor load events ──
        cpu_under_load = any(
            s["_event_active"] for s in self.sensors if s["type"] == "cpu"
        )
        if cpu_under_load:
            # Ramp toward a load target (45-85%)
            load_target = random.uniform(45, 85)
            self._cpu_usage += (load_target - self._cpu_usage) * 0.3
        else:
            # Cool down toward idle baseline
            self._cpu_usage += (self._cpu_usage_idle - self._cpu_usage) * 0.15
        # Add small jitter
        self._cpu_usage += random.uniform(-1.5, 1.5)
        self._cpu_usage = max(1.0, min(99.0, self._cpu_usage))

        # ── Memory: stable with slow drift ──
        if random.random() < 0.05:  # ~5% chance per tick to shift target
            self._mem_target += random.uniform(-3, 3)
            self._mem_target = max(20.0, min(80.0, self._mem_target))
        self._mem_usage += (self._mem_target - self._mem_usage) * 0.1
        self._mem_usage += random.uniform(-0.3, 0.3)
        self._mem_usage = max(10.0, min(95.0, self._mem_usage))

        return {
            "cpuUsage": round(self._cpu_usage, 1),
            "memoryUsage": round(self._mem_usage, 1),
            "agentUptime": round(uptime, 1),
        }
