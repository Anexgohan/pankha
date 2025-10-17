#!/usr/bin/env python3
"""
Pankha Agent - Dynamic Sensor Discovery Module

Discovers temperature sensors, fans, and hardware monitoring interfaces
across different Linux systems without hardcoded paths.
"""

import os
import glob
import json
from datetime import datetime
from typing import Dict, List, Optional, Any


class SensorDiscovery:
    """Dynamic sensor discovery for Linux hardware monitoring."""

    # Chip priority ranking (higher = preferred)
    CHIP_PRIORITY = {
        'k10temp': 100,      # AMD CPU sensors (native)
        'coretemp': 100,     # Intel CPU sensors (native)
        'it8628': 90,        # Motherboard chip sensors (native)
        'it87': 90,          # Motherboard chip sensors (native)
        'nvme': 80,          # NVMe drive sensors
        'gigabyte_wmi': 50,  # WMI sensors (often duplicate motherboard sensors)
        'asus_wmi': 50,      # WMI sensors (often duplicate)
        'acpitz': 40,        # ACPI thermal zones (often duplicate)
    }

    def __init__(self, filter_duplicate_sensors: bool = True, duplicate_sensor_tolerance: float = 0.5):
        self.hwmon_base = "/sys/class/hwmon"
        self.thermal_base = "/sys/class/thermal"
        self.discovered_sensors = {}
        self.discovered_fans = {}
        self.filter_duplicate_sensors = filter_duplicate_sensors
        self.duplicate_sensor_tolerance = duplicate_sensor_tolerance
        self._sensor_identity_cache = {}  # Cache to maintain stable sensor list
        
    def discover_all(self) -> Dict[str, Any]:
        """Discover all available sensors and fans on the system."""
        try:
            # Discover temperature sensors
            hwmon_sensors = self._discover_hwmon_sensors()
            thermal_sensors = self._discover_thermal_zones()

            # Combine all sensors
            all_sensors = hwmon_sensors + thermal_sensors

            import os
            if os.getenv('DEBUG_DEDUP') == '1':
                print(f"\n=== BEFORE DEDUPLICATION ===")
                print(f"Discovered {len(all_sensors)} total sensors")

            # Apply deduplication if enabled
            if self.filter_duplicate_sensors:
                all_sensors = self._deduplicate_sensors(all_sensors)

                if os.getenv('DEBUG_DEDUP') == '1':
                    print(f"\n=== AFTER DEDUPLICATION ===")
                    print(f"Kept {len(all_sensors)} sensors")

            # Discover fans and PWM controls
            fans = self._discover_fans()

            # Combine all discoveries
            discovery_data = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "sensors": all_sensors,  # Unified sensor list
                "hwmon_sensors": hwmon_sensors,  # Keep original for debugging
                "thermal_sensors": thermal_sensors,  # Keep original for debugging
                "fans": fans,
                "sensor_count": len(all_sensors),
                "fan_count": len(fans),
                "deduplication_enabled": self.filter_duplicate_sensors
            }

            return discovery_data

        except Exception as e:
            return {
                "error": f"Discovery failed: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }

    def _deduplicate_sensors(self, sensors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Remove duplicate temperature sensors using chip priority with fallback.

        Strategy:
        1. Group sensors by temperature (within tolerance)
        2. For each temperature group:
           - If all sensors are from the same chip → keep ALL (different physical locations)
           - If sensors are from different chips → keep ALL sensors from the highest priority chip
           - Lower priority chips act as fallback when high priority chips aren't present

        Chip Priority (defined in CHIP_PRIORITY):
        - k10temp (AMD CPU) = 100
        - it8628/nct6798d (motherboard chips) = 90
        - nvme (NVMe drives) = 80
        - coretemp (Intel CPU) = 70
        - gigabyte_wmi/asus_wmi (WMI - usually duplicates) = 50
        - acpitz (ACPI thermal zones) = 40

        This ensures real hwmon sensors are kept, with WMI as fallback for systems without hwmon.
        """
        if not sensors:
            return sensors

        import os
        debug = os.getenv('DEBUG_DEDUP') == '1'
        TEMP_TOLERANCE = self.duplicate_sensor_tolerance

        # For cross-chip deduplication, use tighter tolerance to avoid grouping non-duplicates
        # E.g., nvme at 50.9°C and k10temp at 51.2°C are NOT duplicates
        CROSS_CHIP_TOLERANCE = 0.1  # Very tight - only group if temps are nearly identical

        # Group sensors by temperature (within tolerance)
        temp_groups = {}

        for sensor in sensors:
            temp = sensor.get('value', 0)
            sensor_id = sensor.get('id', 'unknown')
            chip = sensor.get('chip', sensor.get('zone_type', 'unknown'))

            # Find matching temperature group
            matched_group = None
            for group_temp, group_sensors in temp_groups.items():
                # Check if sensor matches this group
                # Use tight tolerance for cross-chip matching
                temp_diff = abs(temp - group_temp)

                # Check if this group has sensors from the same chip
                group_chips = set(s.get('chip', s.get('zone_type', 'unknown')) for s in group_sensors)
                same_chip_in_group = chip in group_chips

                # Decide tolerance based on whether it's same-chip or cross-chip
                if same_chip_in_group:
                    # Same chip - use regular tolerance
                    tolerance = TEMP_TOLERANCE
                else:
                    # Different chip - use tight tolerance to avoid false grouping
                    tolerance = CROSS_CHIP_TOLERANCE

                if temp_diff <= tolerance:
                    matched_group = group_temp
                    if debug:
                        print(f"  {sensor_id:30s} {temp:5.1f}°C matches group {group_temp:5.1f}°C (diff={temp_diff:.2f}, tolerance={tolerance})")
                    break

            # Add to group
            if matched_group is not None:
                temp_groups[matched_group].append(sensor)
            else:
                if debug:
                    print(f"  {sensor_id:30s} {temp:5.1f}°C creates new group")
                temp_groups[temp] = [sensor]

        # Process each temperature group
        deduplicated = []

        for temp, group_sensors in temp_groups.items():
            if debug:
                print(f"\nProcessing temp group ~{temp}°C with {len(group_sensors)} sensors")
                for s in group_sensors:
                    chip = s.get('chip', s.get('zone_type', 'unknown'))
                    print(f"    {chip:15s} {s['id']:30s} {s['value']}°C")

            if len(group_sensors) == 1:
                # Single sensor, keep it
                deduplicated.append(group_sensors[0])
            else:
                # Multiple sensors - group by chip
                chip_groups = {}
                for sensor in group_sensors:
                    chip = sensor.get('chip', sensor.get('zone_type', 'unknown'))
                    if chip not in chip_groups:
                        chip_groups[chip] = []
                    chip_groups[chip].append(sensor)

                if len(chip_groups) == 1:
                    # All from same chip - keep ALL (different physical sensors)
                    if debug:
                        chip_name = list(chip_groups.keys())[0]
                        print(f"  Single chip ({chip_name}) - keeping all {len(group_sensors)} sensors")
                    deduplicated.extend(group_sensors)
                else:
                    # Multiple chips - select highest priority chip
                    # Get one sensor from each chip to determine priority
                    chip_samples = {chip: sensors_list[0] for chip, sensors_list in chip_groups.items()}
                    best_sensor = self._select_best_sensor(list(chip_samples.values()))
                    selected_chip = best_sensor.get('chip', best_sensor.get('zone_type', 'unknown'))

                    # Keep ALL sensors from the selected chip
                    selected_sensors = chip_groups[selected_chip]
                    deduplicated.extend(selected_sensors)

                    if debug:
                        print(f"  Multi-chip ({len(chip_groups)} chips) - selected {selected_chip}, kept {len(selected_sensors)} sensors")

        return deduplicated

    def _select_best_sensor(self, sensors: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Select the best sensor from a group of duplicate sensors.

        Priority rules:
        1. Prefer sensors from higher priority chips (e.g., k10temp over WMI)
        2. Prefer sensors with more metadata (max/crit values)
        3. Prefer hwmon over thermal zones
        """
        def get_priority(sensor: Dict[str, Any]) -> int:
            chip = sensor.get('chip', sensor.get('zone_type', 'unknown'))

            # Get base priority from chip type
            base_priority = self.CHIP_PRIORITY.get(chip, 30)

            # Bonus for having temperature limits
            has_limits = 'max_value' in sensor or 'critical_value' in sensor
            limits_bonus = 10 if has_limits else 0

            # Bonus for hwmon over thermal zones
            hwmon_bonus = 5 if 'hwmon' in sensor else 0

            return base_priority + limits_bonus + hwmon_bonus

        # Sort by priority (descending) and return the best one
        sorted_sensors = sorted(sensors, key=get_priority, reverse=True)
        return sorted_sensors[0]

    def _discover_hwmon_sensors(self) -> List[Dict[str, Any]]:
        """Discover hardware monitoring sensors via /sys/class/hwmon."""
        sensors = []
        
        if not os.path.exists(self.hwmon_base):
            return sensors
            
        # Find all hwmon interfaces
        hwmon_dirs = glob.glob(f"{self.hwmon_base}/hwmon*")
        
        for hwmon_dir in sorted(hwmon_dirs):
            hwmon_name = os.path.basename(hwmon_dir)
            
            # Get hwmon chip name
            chip_name = self._read_file(f"{hwmon_dir}/name", "unknown")
            
            # Find all temperature inputs
            temp_files = glob.glob(f"{hwmon_dir}/temp*_input")
            
            for temp_file in sorted(temp_files):
                sensor_info = self._parse_hwmon_sensor(hwmon_dir, temp_file, chip_name)
                if sensor_info:
                    sensors.append(sensor_info)
                    
        return sensors
    
    def _discover_thermal_zones(self) -> List[Dict[str, Any]]:
        """Discover thermal zones via /sys/class/thermal."""
        sensors = []
        
        if not os.path.exists(self.thermal_base):
            return sensors
            
        # Find all thermal zones
        thermal_dirs = glob.glob(f"{self.thermal_base}/thermal_zone*")
        
        for thermal_dir in sorted(thermal_dirs):
            zone_name = os.path.basename(thermal_dir)
            
            # Get thermal zone type
            zone_type = self._read_file(f"{thermal_dir}/type", "unknown")
            
            # Get current temperature
            temp_file = f"{thermal_dir}/temp"
            if os.path.exists(temp_file):
                sensor_info = self._parse_thermal_sensor(thermal_dir, temp_file, zone_type)
                if sensor_info:
                    sensors.append(sensor_info)
                    
        return sensors
    
    def _discover_fans(self) -> List[Dict[str, Any]]:
        """Discover fans and PWM controls."""
        fans = []
        
        if not os.path.exists(self.hwmon_base):
            return fans
            
        # Find all hwmon interfaces
        hwmon_dirs = glob.glob(f"{self.hwmon_base}/hwmon*")
        
        for hwmon_dir in sorted(hwmon_dirs):
            hwmon_name = os.path.basename(hwmon_dir)
            chip_name = self._read_file(f"{hwmon_dir}/name", "unknown")
            
            # Find all fan inputs
            fan_files = glob.glob(f"{hwmon_dir}/fan*_input")
            
            for fan_file in sorted(fan_files):
                fan_info = self._parse_fan(hwmon_dir, fan_file, chip_name)
                if fan_info:
                    fans.append(fan_info)
                    
        return fans
    
    def _parse_hwmon_sensor(self, hwmon_dir: str, temp_file: str, chip_name: str) -> Optional[Dict[str, Any]]:
        """Parse individual hwmon temperature sensor."""
        try:
            # Extract sensor number from filename (temp1_input -> 1)
            temp_num = os.path.basename(temp_file).split("_")[0][4:]  # Remove "temp" prefix
            
            # Read current temperature (in millidegrees)
            temp_raw = self._read_file(temp_file)
            if temp_raw is None:
                return None
                
            temp_celsius = float(temp_raw) / 1000.0
            
            # Try to get sensor label
            label_file = f"{hwmon_dir}/temp{temp_num}_label"
            sensor_label = self._read_file(label_file, f"Sensor {temp_num}")
            
            # Try to get limits
            max_file = f"{hwmon_dir}/temp{temp_num}_max"
            crit_file = f"{hwmon_dir}/temp{temp_num}_crit"
            
            max_temp = self._read_file(max_file)
            crit_temp = self._read_file(crit_file)
            
            # Generate unique sensor ID
            sensor_id = f"{chip_name}_{temp_num}".lower().replace(" ", "_")
            
            sensor_info = {
                "id": sensor_id,
                "name": f"{chip_name} {sensor_label}",
                "type": "temperature",
                "value": round(temp_celsius, 1),
                "unit": "celsius",
                "source": temp_file,
                "chip": chip_name,
                "hwmon": os.path.basename(hwmon_dir)
            }
            
            # Add limits if available
            if max_temp is not None:
                sensor_info["max_value"] = float(max_temp) / 1000.0
            if crit_temp is not None:
                sensor_info["critical_value"] = float(crit_temp) / 1000.0
                
            return sensor_info
            
        except Exception as e:
            print(f"Error parsing hwmon sensor {temp_file}: {e}")
            return None
    
    def _parse_thermal_sensor(self, thermal_dir: str, temp_file: str, zone_type: str) -> Optional[Dict[str, Any]]:
        """Parse individual thermal zone sensor."""
        try:
            # Read current temperature (in millidegrees)
            temp_raw = self._read_file(temp_file)
            if temp_raw is None:
                return None
                
            temp_celsius = float(temp_raw) / 1000.0
            
            zone_name = os.path.basename(thermal_dir)
            sensor_id = f"thermal_{zone_name}_{zone_type}".lower().replace(" ", "_")
            
            sensor_info = {
                "id": sensor_id,
                "name": f"Thermal Zone {zone_type}",
                "type": "temperature", 
                "value": round(temp_celsius, 1),
                "unit": "celsius",
                "source": temp_file,
                "thermal_zone": zone_name,
                "zone_type": zone_type
            }
            
            return sensor_info
            
        except Exception as e:
            print(f"Error parsing thermal sensor {temp_file}: {e}")
            return None
    
    def _parse_fan(self, hwmon_dir: str, fan_file: str, chip_name: str) -> Optional[Dict[str, Any]]:
        """Parse individual fan sensor."""
        try:
            # Extract fan number from filename (fan1_input -> 1)
            fan_num = os.path.basename(fan_file).split("_")[0][3:]  # Remove "fan" prefix
            
            # Read current RPM
            rpm_raw = self._read_file(fan_file)
            if rpm_raw is None:
                return None
                
            rpm = int(rpm_raw)
            
            # Check for corresponding PWM control
            pwm_file = f"{hwmon_dir}/pwm{fan_num}"
            pwm_enable_file = f"{hwmon_dir}/pwm{fan_num}_enable"
            
            has_pwm_control = os.path.exists(pwm_file)
            pwm_value = None
            pwm_enabled = None
            
            if has_pwm_control:
                pwm_value = self._read_file(pwm_file)
                pwm_enabled = self._read_file(pwm_enable_file)
            
            # Generate unique fan ID
            fan_id = f"{chip_name}_fan_{fan_num}".lower().replace(" ", "_")
            
            fan_info = {
                "id": fan_id,
                "name": f"{chip_name} Fan {fan_num}",
                "type": "fan",
                "rpm": rpm,
                "source": fan_file,
                "chip": chip_name,
                "hwmon": os.path.basename(hwmon_dir),
                "fan_number": int(fan_num),
                "has_pwm_control": has_pwm_control
            }
            
            # Add PWM info if available
            if has_pwm_control:
                fan_info["pwm_file"] = pwm_file
                fan_info["pwm_enable_file"] = pwm_enable_file
                if pwm_value is not None:
                    fan_info["pwm_value"] = int(pwm_value)
                if pwm_enabled is not None:
                    fan_info["pwm_enabled"] = int(pwm_enabled)
                    
            return fan_info
            
        except Exception as e:
            print(f"Error parsing fan {fan_file}: {e}")
            return None
    
    def _read_file(self, filepath: str, default: Optional[str] = None) -> Optional[str]:
        """Safely read a file and return its content."""
        try:
            if not os.path.exists(filepath):
                return default
                
            with open(filepath, "r") as f:
                content = f.read().strip()
                return content if content else default
                
        except Exception:
            return default


def main():
    """Test sensor discovery functionality."""
    discovery = SensorDiscovery()
    result = discovery.discover_all()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
