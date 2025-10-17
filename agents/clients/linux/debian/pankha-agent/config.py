#!/usr/bin/env python3
"""
Pankha Agent - Configuration Management Module

Handles YAML configuration files, default settings, and runtime configuration
for the Linux client agent.
"""

import os
import json
import socket
from typing import Dict, Any, Optional


class Config:
    """Configuration management for Pankha Agent."""
    
    # Default configuration
    DEFAULT_CONFIG = {
        "agent": {
            "id": f"linux-agent-{socket.gethostname()}",
            "name": f"Linux System ({socket.gethostname()})",
            "update_interval": 10.0,  # seconds (configurable!)
            "log_level": "INFO"
        },
        "backend": {
            "server_url": "ws://192.168.100.237:3000/websocket",
            "reconnect_interval": 30.0,
            "max_reconnect_attempts": -1,  # -1 = infinite
            "connection_timeout": 10.0
        },
        "hardware": {
            "enable_fan_control": True,
            "enable_sensor_monitoring": True,
            "fan_safety_minimum": 30,  # minimum fan speed % (30=safe default, 0=allow stop)
            "temperature_critical": 85.0,  # celsius
            "duplicate_sensor_tolerance": 0.5,  # celsius - tolerance for considering sensors as duplicates
            "filter_duplicate_sensors": True  # filter out duplicate sensors from different kernel drivers
        },
        "logging": {
            "enable_file_logging": True,
            "log_file": "/var/log/pankha-agent/agent.log",
            "max_log_size_mb": 10,
            "log_retention_days": 7
        }
    }
    
    def __init__(self, config_file: Optional[str] = None):
        # Use relative path to config directory by default
        if config_file is None:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            config_file = os.path.join(script_dir, "config", "config.json")
        self.config_file = config_file
        self.config = self.DEFAULT_CONFIG.copy()
        self._load_config()
        
    def _load_config(self):
        """Load configuration from file if it exists."""
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, "r") as f:
                    file_config = json.load(f)
                    
                # Merge with defaults (deep merge)
                self.config = self._deep_merge(self.config, file_config)
                print(f"Loaded configuration from: {self.config_file}")
            else:
                print(f"Config file not found: {self.config_file}")
                print("Using default configuration")
                
        except Exception as e:
            print(f"Error loading config file: {e}")
            print("Using default configuration")
    
    def save_config(self) -> bool:
        """Save current configuration to file."""
        try:
            # Ensure directory exists
            config_dir = os.path.dirname(self.config_file)
            if not os.path.exists(config_dir):
                os.makedirs(config_dir, exist_ok=True)
                
            # Write config file
            with open(self.config_file, "w") as f:
                json.dump(self.config, f, indent=2)
                
            print(f"Configuration saved to: {self.config_file}")
            return True
            
        except Exception as e:
            print(f"Error saving config file: {e}")
            return False
    
    def get(self, key_path: str, default: Any = None) -> Any:
        """Get configuration value using dot notation (e.g., \"agent.update_interval\")."""
        try:
            keys = key_path.split(".")
            value = self.config
            
            for key in keys:
                if isinstance(value, dict) and key in value:
                    value = value[key]
                else:
                    return default
                    
            return value
            
        except Exception:
            return default
    
    def set(self, key_path: str, value: Any):
        """Set configuration value using dot notation."""
        try:
            keys = key_path.split(".")
            config_ref = self.config
            
            # Navigate to parent dictionary
            for key in keys[:-1]:
                if key not in config_ref:
                    config_ref[key] = {}
                config_ref = config_ref[key]
                
            # Set the value
            config_ref[keys[-1]] = value
            
        except Exception as e:
            print(f"Error setting config value: {e}")
    
    def update_from_env(self):
        """Update configuration from environment variables."""
        env_mappings = {
            "PANKHA_SERVER_URL": "backend.server_url",
            "PANKHA_AGENT_ID": "agent.id",
            "PANKHA_UPDATE_INTERVAL": "agent.update_interval",
            "PANKHA_LOG_LEVEL": "agent.log_level",
            "PANKHA_RECONNECT_INTERVAL": "backend.reconnect_interval"
        }
        
        for env_var, config_key in env_mappings.items():
            env_value = os.getenv(env_var)
            if env_value:
                # Convert to appropriate type
                if config_key.endswith("_interval") or config_key == "agent.update_interval":
                    try:
                        env_value = float(env_value)
                    except ValueError:
                        print(f"Invalid numeric value for {env_var}: {env_value}")
                        continue
                        
                self.set(config_key, env_value)
                print(f"Updated {config_key} from environment: {env_value}")
    
    def validate(self) -> bool:
        """Validate configuration values."""
        valid = True
        
        # Validate update interval
        update_interval = self.get("agent.update_interval")
        if not isinstance(update_interval, (int, float)) or update_interval <= 0:
            print(f"Invalid update_interval: {update_interval}. Must be > 0")
            valid = False
            
        # Validate server URL
        server_url = self.get("backend.server_url")
        if not isinstance(server_url, str) or not server_url.startswith(("ws://", "wss://")):
            print(f"Invalid server_url: {server_url}. Must be WebSocket URL")
            valid = False
            
        # Validate fan safety minimum
        fan_min = self.get("hardware.fan_safety_minimum")
        if not isinstance(fan_min, (int, float)) or not 0 <= fan_min <= 100:
            print(f"Invalid fan_safety_minimum: {fan_min}. Must be 0-100")
            valid = False
            
        return valid
    
    def get_backend_config(self) -> Dict[str, Any]:
        """Get backend client configuration."""
        return {
            "server_url": self.get("backend.server_url"),
            "agent_id": self.get("agent.id"),
            "update_interval": self.get("agent.update_interval"),
            "reconnect_interval": self.get("backend.reconnect_interval"),
            "max_reconnect_attempts": self.get("backend.max_reconnect_attempts"),
            "connection_timeout": self.get("backend.connection_timeout")
        }
    
    def _deep_merge(self, base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
        """Deep merge two dictionaries."""
        result = base.copy()
        
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
                
        return result
    
    def print_config(self):
        """Print current configuration (for debugging)."""
        print("Current Configuration:")
        print(json.dumps(self.config, indent=2))


def main():
    """Test configuration management."""
    import sys
    
    config = Config()
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "print":
            config.print_config()
        elif sys.argv[1] == "save":
            config.save_config()
        elif sys.argv[1] == "validate":
            if config.validate():
                print("Configuration is valid")
            else:
                print("Configuration has errors")
        elif sys.argv[1] == "set" and len(sys.argv) == 4:
            key, value = sys.argv[2], sys.argv[3]
            # Try to convert to number if possible
            try:
                if "." in value:
                    value = float(value)
                else:
                    value = int(value)
            except ValueError:
                pass  # Keep as string
                
            config.set(key, value)
            print(f"Set {key} = {value}")
            config.save_config()
        else:
            print("Usage:")
            print("  python3 config.py print              # Print current config")
            print("  python3 config.py save               # Save default config")
            print("  python3 config.py validate           # Validate config")
            print("  python3 config.py set <key> <value>  # Set config value")
    else:
        # Test basic functionality
        print(f"Agent ID: {config.get('agent.id')}")
        print(f"Update Interval: {config.get('agent.update_interval')}s")
        print(f"Server URL: {config.get('backend.server_url')}")
        print(f"Fan Control: {config.get('hardware.enable_fan_control')}")


if __name__ == "__main__":
    main()
