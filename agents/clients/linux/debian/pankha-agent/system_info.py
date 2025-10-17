#!/usr/bin/env python3
"""
Pankha Agent - Dynamic System Information Module

Gathers CPU, GPU, RAM, OS and hardware information across different Linux systems
without hardcoded values or external dependencies.
"""

import os
import re
import json
import subprocess
from datetime import datetime
from typing import Dict, List, Optional, Any


class SystemInfo:
    """Dynamic system information discovery for Linux systems."""
    
    def __init__(self):
        self.proc_base = "/proc"
        self.sys_base = "/sys"
        
    def gather_all(self) -> Dict[str, Any]:
        """Gather all system information."""
        try:
            system_data = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "cpu": self._get_cpu_info(),
                "memory": self._get_memory_info(),
                "os": self._get_os_info(),
                "gpu": self._get_gpu_info(),
                "storage": self._get_storage_info(),
                "network": self._get_network_info(),
                "uptime": self._get_uptime()
            }
            
            return system_data
            
        except Exception as e:
            return {
                "error": f"System info gathering failed: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
    
    def _get_cpu_info(self) -> Dict[str, Any]:
        """Get CPU information from /proc/cpuinfo."""
        cpu_info = {}
        
        try:
            with open(f"{self.proc_base}/cpuinfo", "r") as f:
                lines = f.readlines()
                
            # Parse first processor entry for basic info
            for line in lines:
                if line.strip():
                    key, _, value = line.partition(":")
                    key = key.strip()
                    value = value.strip()
                    
                    if key == "processor" and value == "0":
                        # Starting first processor
                        continue
                    elif key == "processor" and value != "0":
                        # Hit second processor, stop parsing
                        break
                    elif key in ["model name", "vendor_id", "cpu family", "model", "stepping"]:
                        cpu_info[key.replace(" ", "_")] = value
                    elif key in ["cpu cores", "siblings"]:
                        cpu_info[key.replace(" ", "_")] = int(value) if value.isdigit() else value
                    elif key == "cpu MHz":
                        cpu_info["cpu_mhz"] = float(value) if value.replace(".", "").isdigit() else value
                    elif key == "cache size":
                        cpu_info["cache_size"] = value
                        
            # Count total processors
            processor_count = sum(1 for line in lines if line.startswith("processor"))
            cpu_info["processor_count"] = processor_count
            
            # Get current CPU frequencies
            cpu_freq = self._get_cpu_frequencies()
            if cpu_freq:
                cpu_info["current_frequencies"] = cpu_freq
                
            # Get CPU load averages
            loadavg = self._get_load_average()
            if loadavg:
                cpu_info["load_average"] = loadavg
                
        except Exception as e:
            cpu_info["error"] = f"CPU info error: {str(e)}"
            
        return cpu_info
    
    def _get_memory_info(self) -> Dict[str, Any]:
        """Get memory information from /proc/meminfo."""
        memory_info = {}
        
        try:
            with open(f"{self.proc_base}/meminfo", "r") as f:
                lines = f.readlines()
                
            for line in lines:
                if ":" in line:
                    key, value = line.split(":", 1)
                    key = key.strip().lower()
                    value = value.strip()
                    
                    # Convert kB values to bytes and MB
                    if "kB" in value:
                        kb_value = int(value.replace("kB", "").strip())
                        memory_info[key] = {
                            "kb": kb_value,
                            "mb": round(kb_value / 1024, 1),
                            "gb": round(kb_value / 1024 / 1024, 2)
                        }
                    else:
                        memory_info[key] = value
                        
            # Calculate memory usage percentages
            if "memtotal" in memory_info and "memavailable" in memory_info:
                total_mb = memory_info["memtotal"]["mb"]
                available_mb = memory_info["memavailable"]["mb"]
                used_mb = total_mb - available_mb
                
                memory_info["usage"] = {
                    "total_mb": total_mb,
                    "used_mb": round(used_mb, 1),
                    "available_mb": available_mb,
                    "usage_percent": round((used_mb / total_mb) * 100, 1)
                }
                
        except Exception as e:
            memory_info["error"] = f"Memory info error: {str(e)}"
            
        return memory_info
    
    def _get_os_info(self) -> Dict[str, Any]:
        """Get OS information from multiple sources."""
        os_info = {}
        
        try:
            # Get kernel info from /proc/version
            kernel_info = self._read_file(f"{self.proc_base}/version")
            if kernel_info:
                os_info["kernel_version"] = kernel_info.split()[2]
                os_info["kernel_full"] = kernel_info.strip()
                
            # Get uptime
            uptime_info = self._read_file(f"{self.proc_base}/uptime")
            if uptime_info:
                uptime_seconds = float(uptime_info.split()[0])
                os_info["uptime_seconds"] = uptime_seconds
                os_info["uptime_days"] = round(uptime_seconds / 86400, 1)
                
            # Get hostname
            hostname = self._read_file(f"{self.proc_base}/sys/kernel/hostname")
            if hostname:
                os_info["hostname"] = hostname
                
            # Try to get distribution info from /etc/os-release
            os_release = self._parse_os_release()
            if os_release:
                os_info.update(os_release)
                
            # Get architecture
            arch_info = self._run_command(["uname", "-m"])
            if arch_info:
                os_info["architecture"] = arch_info.strip()
                
        except Exception as e:
            os_info["error"] = f"OS info error: {str(e)}"
            
        return os_info
    
    def _get_gpu_info(self) -> List[Dict[str, Any]]:
        """Get GPU information using lspci and nvidia-smi if available."""
        gpu_list = []
        
        try:
            # Try lspci for basic GPU detection
            lspci_output = self._run_command(["lspci"])
            if lspci_output:
                gpu_lines = [line for line in lspci_output.split("\n") if "VGA compatible controller" in line or "3D controller" in line]
                
                for line in gpu_lines:
                    gpu_info = {}
                    # Parse PCI address and device name
                    if ":" in line:
                        pci_addr = line.split()[0]
                        device_info = line.split(":", 2)[-1].strip()
                        gpu_info["pci_address"] = pci_addr
                        gpu_info["name"] = device_info
                        gpu_info["source"] = "lspci"
                        
                    gpu_list.append(gpu_info)
                    
            # Try nvidia-smi for NVIDIA GPUs
            nvidia_info = self._run_command(["nvidia-smi", "--query-gpu=name,temperature.gpu,memory.total,driver_version", "--format=csv,noheader,nounits"])
            if nvidia_info and not "command not found" in nvidia_info.lower():
                for i, line in enumerate(nvidia_info.strip().split("\n")):
                    if line.strip():
                        parts = [p.strip() for p in line.split(",")]
                        if len(parts) >= 4:
                            nvidia_gpu = {
                                "name": parts[0],
                                "temperature": int(parts[1]) if parts[1].isdigit() else None,
                                "memory_mb": int(parts[2]) if parts[2].isdigit() else None,
                                "driver_version": parts[3],
                                "source": "nvidia-smi"
                            }
                            
                            # Update existing entry or add new one
                            if i < len(gpu_list):
                                gpu_list[i].update(nvidia_gpu)
                            else:
                                gpu_list.append(nvidia_gpu)
                                
        except Exception as e:
            gpu_list.append({"error": f"GPU info error: {str(e)}"})
            
        return gpu_list if gpu_list else [{"status": "no_gpu_detected"}]
    
    def _get_storage_info(self) -> List[Dict[str, Any]]:
        """Get storage device information."""
        storage_list = []
        
        try:
            # Use lsblk for storage information
            lsblk_output = self._run_command(["lsblk", "-J", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE"])
            if lsblk_output:
                try:
                    lsblk_data = json.loads(lsblk_output)
                    if "blockdevices" in lsblk_data:
                        for device in lsblk_data["blockdevices"]:
                            if device.get("type") == "disk":
                                storage_info = {
                                    "name": device.get("name", "unknown"),
                                    "size": device.get("size", "unknown"),
                                    "type": device.get("type", "unknown"),
                                    "fstype": device.get("fstype"),
                                    "mountpoint": device.get("mountpoint")
                                }
                                storage_list.append(storage_info)
                except json.JSONDecodeError:
                    # Fallback to simple parsing
                    pass
                    
            # If JSON parsing failed, try simple df for mounted filesystems
            if not storage_list:
                df_output = self._run_command(["df", "-h"])
                if df_output:
                    lines = df_output.split("\n")[1:]  # Skip header
                    for line in lines:
                        if line.strip() and not line.startswith("tmpfs"):
                            parts = line.split()
                            if len(parts) >= 6:
                                storage_info = {
                                    "filesystem": parts[0],
                                    "size": parts[1],
                                    "used": parts[2],
                                    "available": parts[3],
                                    "use_percent": parts[4],
                                    "mountpoint": parts[5]
                                }
                                storage_list.append(storage_info)
                                
        except Exception as e:
            storage_list.append({"error": f"Storage info error: {str(e)}"})
            
        return storage_list if storage_list else [{"status": "no_storage_detected"}]
    
    def _get_network_info(self) -> List[Dict[str, Any]]:
        """Get network interface information."""
        network_list = []
        
        try:
            # Get network interfaces from /sys/class/net
            net_dir = f"{self.sys_base}/class/net"
            if os.path.exists(net_dir):
                for interface in os.listdir(net_dir):
                    if interface != "lo":  # Skip loopback
                        iface_info = {
                            "interface": interface,
                            "type": self._read_file(f"{net_dir}/{interface}/type"),
                            "mtu": self._read_file(f"{net_dir}/{interface}/mtu"),
                            "operstate": self._read_file(f"{net_dir}/{interface}/operstate"),
                            "address": self._read_file(f"{net_dir}/{interface}/address")
                        }
                        
                        # Get IP address if available
                        ip_output = self._run_command(["ip", "addr", "show", interface])
                        if ip_output:
                            # Simple IP extraction
                            for line in ip_output.split("\n"):
                                if "inet " in line and not "127.0.0.1" in line:
                                    ip_match = re.search(r"inet ([0-9\.]+)", line)
                                    if ip_match:
                                        iface_info["ip_address"] = ip_match.group(1)
                                        break
                                        
                        network_list.append(iface_info)
                        
        except Exception as e:
            network_list.append({"error": f"Network info error: {str(e)}"})
            
        return network_list if network_list else [{"status": "no_network_detected"}]
    
    def _get_uptime(self) -> Optional[Dict[str, Any]]:
        """Get system uptime information."""
        try:
            uptime_raw = self._read_file(f"{self.proc_base}/uptime")
            if uptime_raw:
                uptime_seconds = float(uptime_raw.split()[0])
                idle_seconds = float(uptime_raw.split()[1])
                
                return {
                    "uptime_seconds": uptime_seconds,
                    "idle_seconds": idle_seconds,
                    "uptime_days": round(uptime_seconds / 86400, 2),
                    "uptime_hours": round(uptime_seconds / 3600, 1)
                }
        except Exception:
            pass
            
        return None
    
    def _get_cpu_frequencies(self) -> Optional[List[float]]:
        """Get current CPU frequencies from /proc/cpuinfo."""
        try:
            frequencies = []
            with open(f"{self.proc_base}/cpuinfo", "r") as f:
                for line in f:
                    if line.startswith("cpu MHz"):
                        freq = line.split(":")[1].strip()
                        if freq.replace(".", "").isdigit():
                            frequencies.append(round(float(freq), 1))
            return frequencies if frequencies else None
        except Exception:
            return None
    
    def _get_load_average(self) -> Optional[Dict[str, float]]:
        """Get system load averages."""
        try:
            loadavg_raw = self._read_file(f"{self.proc_base}/loadavg")
            if loadavg_raw:
                loads = loadavg_raw.split()[:3]
                return {
                    "1_minute": float(loads[0]),
                    "5_minutes": float(loads[1]),
                    "15_minutes": float(loads[2])
                }
        except Exception:
            return None
    
    def _parse_os_release(self) -> Dict[str, str]:
        """Parse /etc/os-release file."""
        os_release = {}
        
        try:
            with open("/etc/os-release", "r") as f:
                for line in f:
                    if "=" in line and not line.strip().startswith("#"):
                        key, value = line.strip().split("=", 1)
                        # Remove quotes
                        value = value.strip("\"\"")
                        os_release[key.lower()] = value
                        
        except Exception:
            pass
            
        return os_release
    
    def _read_file(self, filepath: str) -> Optional[str]:
        """Safely read a file and return its content."""
        try:
            if os.path.exists(filepath):
                with open(filepath, "r") as f:
                    return f.read().strip()
        except Exception:
            pass
        return None
    
    def _run_command(self, cmd: List[str]) -> Optional[str]:
        """Run a command safely and return output."""
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                return result.stdout
        except Exception:
            pass
        return None


def main():
    """Test system information gathering."""
    sys_info = SystemInfo()
    result = sys_info.gather_all()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
