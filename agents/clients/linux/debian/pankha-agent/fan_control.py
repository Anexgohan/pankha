#!/usr/bin/env python3
"""
Pankha Agent - Fan Control Module

Controls PWM fans via hwmon interfaces dynamically without hardcoded paths.
Provides safe fan speed control with validation and error handling.
"""

import os
import json
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple


class FanControl:
    """Dynamic fan control via hwmon PWM interfaces."""
    
    def __init__(self):
        self.hwmon_base = "/sys/class/hwmon"
        self.discovered_fans = {}
        self.pwm_min = 0      # Minimum PWM value (0%)
        self.pwm_max = 255    # Maximum PWM value (100%)
        
    def discover_fans(self) -> Dict[str, Any]:
        """Discover all controllable fans and their PWM interfaces."""
        fans = {}
        
        try:
            if not os.path.exists(self.hwmon_base):
                return {"error": "hwmon not available"}
                
            # Find all hwmon interfaces with PWM controls
            for hwmon_name in os.listdir(self.hwmon_base):
                if hwmon_name.startswith("hwmon"):
                    hwmon_path = f"{self.hwmon_base}/{hwmon_name}"
                    
                    # Get chip name
                    chip_name = self._read_file(f"{hwmon_path}/name", "unknown")
                    
                    # Find PWM controls
                    pwm_files = [f for f in os.listdir(hwmon_path) if f.startswith("pwm") and f.endswith("_enable") == False and "_" not in f]
                    
                    for pwm_file in sorted(pwm_files):
                        fan_num = pwm_file[3:]  # Remove "pwm" prefix
                        
                        fan_info = self._analyze_fan(hwmon_path, fan_num, chip_name)
                        if fan_info:
                            fan_id = f"{chip_name}_fan_{fan_num}".lower().replace(" ", "_")
                            fans[fan_id] = fan_info
                            
            self.discovered_fans = fans
            return {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "fans": fans,
                "fan_count": len(fans)
            }
            
        except Exception as e:
            return {
                "error": f"Fan discovery failed: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
    
    def set_fan_speed(self, fan_id: str, speed_percent: int) -> Dict[str, Any]:
        """Set fan speed as percentage (0-100%)."""
        try:
            # Validate speed percentage
            if not 0 <= speed_percent <= 100:
                return {
                    "status": "error",
                    "message": f"Invalid speed percentage: {speed_percent}. Must be 0-100.",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
                
            # Check if fan exists
            if fan_id not in self.discovered_fans:
                return {
                    "status": "error",
                    "message": f"Fan {fan_id} not found. Available fans: {list(self.discovered_fans.keys())}",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
                
            fan_info = self.discovered_fans[fan_id]
            
            # Check if fan has PWM control
            if not fan_info.get("has_pwm_control"):
                return {
                    "status": "error",
                    "message": f"Fan {fan_id} does not support PWM control",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
                
            # Convert percentage to PWM value
            pwm_value = int((speed_percent / 100.0) * self.pwm_max)
            pwm_value = max(self.pwm_min, min(pwm_value, self.pwm_max))  # Clamp to valid range
            
            # Set PWM enable to manual mode (1) if not already
            pwm_enable_file = fan_info.get("pwm_enable_file")
            if pwm_enable_file and os.path.exists(pwm_enable_file):
                current_enable = self._read_file(pwm_enable_file)
                if current_enable != "1":  # 1 = manual mode
                    success = self._write_file(pwm_enable_file, "1")
                    if not success:
                        return {
                            "status": "error",
                            "message": f"Failed to enable manual PWM control for fan {fan_id}",
                            "timestamp": datetime.utcnow().isoformat() + "Z"
                        }
                        
            # Set the PWM value
            pwm_file = fan_info.get("pwm_file")
            if not pwm_file or not os.path.exists(pwm_file):
                return {
                    "status": "error",
                    "message": f"PWM file not found for fan {fan_id}: {pwm_file}",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
                
            success = self._write_file(pwm_file, str(pwm_value))
            if not success:
                return {
                    "status": "error",
                    "message": f"Failed to write PWM value to {pwm_file}",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
                
            # Verify the setting
            actual_pwm = self._read_file(pwm_file)
            actual_percent = int(actual_pwm) / self.pwm_max * 100 if actual_pwm else 0
            
            return {
                "status": "success",
                "fan_id": fan_id,
                "requested_percent": speed_percent,
                "actual_percent": round(actual_percent, 1),
                "pwm_value": int(actual_pwm) if actual_pwm else None,
                "message": f"Fan {fan_id} set to {round(actual_percent, 1)}%",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Fan control error: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
    
    def get_fan_status(self, fan_id: Optional[str] = None) -> Dict[str, Any]:
        """Get current status of fan(s)."""
        try:
            if fan_id:
                # Get single fan status
                if fan_id not in self.discovered_fans:
                    return {
                        "status": "error",
                        "message": f"Fan {fan_id} not found",
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }
                    
                fan_info = self.discovered_fans[fan_id]
                status = self._get_single_fan_status(fan_info)
                status["fan_id"] = fan_id
                return status
            else:
                # Get all fan statuses
                all_statuses = {}
                for fan_id, fan_info in self.discovered_fans.items():
                    status = self._get_single_fan_status(fan_info)
                    all_statuses[fan_id] = status
                    
                return {
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "fans": all_statuses,
                    "fan_count": len(all_statuses)
                }
                
        except Exception as e:
            return {
                "status": "error",
                "message": f"Fan status error: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
    
    def emergency_stop(self) -> Dict[str, Any]:
        """Set all fans to maximum speed for emergency cooling."""
        results = {}
        
        try:
            for fan_id in self.discovered_fans.keys():
                result = self.set_fan_speed(fan_id, 100)
                results[fan_id] = result
                
            success_count = sum(1 for r in results.values() if r.get("status") == "success")
            
            return {
                "status": "success" if success_count == len(results) else "partial_success",
                "message": f"Emergency stop: {success_count}/{len(results)} fans set to maximum",
                "results": results,
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Emergency stop failed: {str(e)}",
                "results": results,
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
    
    def _analyze_fan(self, hwmon_path: str, fan_num: str, chip_name: str) -> Optional[Dict[str, Any]]:
        """Analyze individual fan and its capabilities."""
        try:
            # Check if fan input exists
            fan_input_file = f"{hwmon_path}/fan{fan_num}_input"
            if not os.path.exists(fan_input_file):
                return None
                
            # Check PWM files
            pwm_file = f"{hwmon_path}/pwm{fan_num}"
            pwm_enable_file = f"{hwmon_path}/pwm{fan_num}_enable"
            
            has_pwm = os.path.exists(pwm_file)
            has_pwm_enable = os.path.exists(pwm_enable_file)
            
            # Get current values
            current_rpm = self._read_file(fan_input_file)
            current_pwm = self._read_file(pwm_file) if has_pwm else None
            current_enable = self._read_file(pwm_enable_file) if has_pwm_enable else None
            
            fan_info = {
                "name": f"{chip_name} Fan {fan_num}",
                "chip": chip_name,
                "fan_number": int(fan_num),
                "fan_input_file": fan_input_file,
                "current_rpm": int(current_rpm) if current_rpm and current_rpm.isdigit() else None,
                "has_pwm_control": has_pwm,
                "pwm_file": pwm_file if has_pwm else None,
                "pwm_enable_file": pwm_enable_file if has_pwm_enable else None
            }
            
            # Add PWM info if available
            if has_pwm and current_pwm is not None:
                fan_info["current_pwm_value"] = int(current_pwm)
                fan_info["current_pwm_percent"] = round(int(current_pwm) / self.pwm_max * 100, 1)
                
            if has_pwm_enable and current_enable is not None:
                fan_info["pwm_enabled"] = int(current_enable)
                fan_info["pwm_mode"] = self._get_pwm_mode_description(int(current_enable))
                
            return fan_info
            
        except Exception as e:
            print(f"Error analyzing fan {fan_num}: {e}")
            return None
    
    def _get_single_fan_status(self, fan_info: Dict[str, Any]) -> Dict[str, Any]:
        """Get current status of a single fan."""
        try:
            # Read current RPM
            fan_input_file = fan_info.get("fan_input_file")
            current_rpm = self._read_file(fan_input_file) if fan_input_file else None
            
            # Read current PWM if available
            current_pwm = None
            current_percent = None
            if fan_info.get("has_pwm_control"):
                pwm_file = fan_info.get("pwm_file")
                if pwm_file:
                    current_pwm = self._read_file(pwm_file)
                    if current_pwm and current_pwm.isdigit():
                        current_percent = round(int(current_pwm) / self.pwm_max * 100, 1)
                        
            status = {
                "name": fan_info.get("name"),
                "rpm": int(current_rpm) if current_rpm and current_rpm.isdigit() else None,
                "has_pwm_control": fan_info.get("has_pwm_control", False),
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
            
            if current_pwm is not None:
                status["pwm_value"] = int(current_pwm)
                status["speed_percent"] = current_percent
                
            return status
            
        except Exception as e:
            return {
                "error": f"Status error: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
    
    def _get_pwm_mode_description(self, enable_value: int) -> str:
        """Get human-readable PWM mode description."""
        modes = {
            0: "no_fan_speed_control",
            1: "manual_pwm",
            2: "thermal_cruise",
            3: "fan_speed_cruise",
            4: "smart_fan_III",
            5: "smart_fan_IV"
        }
        return modes.get(enable_value, f"unknown_mode_{enable_value}")
    
    def _read_file(self, filepath: str, default: Optional[str] = None) -> Optional[str]:
        """Safely read a file and return its content."""
        try:
            if os.path.exists(filepath):
                with open(filepath, "r") as f:
                    content = f.read().strip()
                    return content if content else default
        except Exception:
            pass
        return default
    
    def _write_file(self, filepath: str, value: str) -> bool:
        """Safely write to a file."""
        try:
            if os.path.exists(filepath):
                with open(filepath, "w") as f:
                    f.write(value)
                    f.flush()
                return True
        except Exception as e:
            print(f"Error writing to {filepath}: {e}")
        return False


def main():
    """Test fan control functionality."""
    import sys
    
    fan_control = FanControl()
    
    if len(sys.argv) == 1:
        # Discover fans
        result = fan_control.discover_fans()
        print(json.dumps(result, indent=2))
    elif len(sys.argv) == 2 and sys.argv[1] == "status":
        # Get fan status
        result = fan_control.get_fan_status()
        print(json.dumps(result, indent=2))
    elif len(sys.argv) == 4 and sys.argv[1] == "set":
        # Set fan speed: python3 fan_control.py set fan_id speed_percent
        fan_id = sys.argv[2]
        speed_percent = int(sys.argv[3])
        
        # First discover fans
        fan_control.discover_fans()
        
        # Set speed
        result = fan_control.set_fan_speed(fan_id, speed_percent)
        print(json.dumps(result, indent=2))
    else:
        print("Usage:")
        print("  python3 fan_control.py                    # Discover fans")
        print("  python3 fan_control.py status             # Get fan status")
        print("  python3 fan_control.py set <fan_id> <%>  # Set fan speed")


if __name__ == "__main__":
    main()
