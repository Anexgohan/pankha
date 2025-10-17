#!/usr/bin/env python3
"""
Pankha Linux Agent - Main Entry Point

Production Linux agent for hardware monitoring and fan control.
Uses WebSocket communication with Pankha backend for real-time bidirectional communication.
"""

import os
import sys
import json
import signal
import logging
import socket
import time
from datetime import datetime
from typing import Dict, Any, Optional
from pathlib import Path

# Import our modules
try:
    from websocket_client import WebSocketClient
    WEBSOCKET_AVAILABLE = True
except ImportError:
    print("WARNING: WebSocket client not available, falling back to HTTP")
    from backend_client import BackendClient
    WEBSOCKET_AVAILABLE = False
from config import Config


class PankhaAgent:
    """Main Pankha agent application."""
    
    def __init__(self, config_file: Optional[str] = None):
        # Load configuration
        self.config_manager = Config(config_file)
        self.config = self.config_manager.config
        
        # Setup logging
        self._setup_logging()
        
        # Initialize backend client (WebSocket preferred, HTTP fallback)
        backend_config = {
            "server_url": self.config['backend']['server_url'],
            "agent_id": self.config['agent']['id'],
            "name": self.config['agent']['name'],
            "update_interval": self.config['agent']['update_interval'],  # User configurable
            "connection_timeout": self.config['backend']['connection_timeout'],
            "max_retries": self.config['backend'].get('max_reconnect_attempts', -1),  # Infinite for WebSocket
            "retry_delay": self.config['backend'].get('reconnect_interval', 5.0),
            "enable_fan_control": self.config['hardware']['enable_fan_control'],
            "filter_duplicate_sensors": self.config['hardware'].get('filter_duplicate_sensors', True),
            "duplicate_sensor_tolerance": self.config['hardware'].get('duplicate_sensor_tolerance', 0.5)
        }
        
        # Use WebSocket client if available, otherwise fall back to HTTP
        if WEBSOCKET_AVAILABLE:
            self.backend_client = WebSocketClient(backend_config, self.config_manager)
            self.communication_type = "WebSocket"
        else:
            from backend_client import BackendClient
            self.backend_client = BackendClient(backend_config)
            self.communication_type = "HTTP"
            
        self.backend_client.set_log_callback(self._log_callback)
        
        # Agent state
        self.running = False
        
        # Setup signal handlers
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)
        
        self.logger.info(f"Pankha Agent initialized: {self.config['agent']['name']} ({self.config['agent']['id']})")
        self.logger.info(f"Communication type: {self.communication_type}")
        self.logger.info(f"Update interval: {self.config['agent']['update_interval']}s (user configurable)")
    
    def _setup_logging(self):
        """Configure logging based on config settings."""
        log_level = getattr(logging, self.config['agent']['log_level'].upper())
        
        # Setup logger
        self.logger = logging.getLogger('pankha-agent')
        self.logger.setLevel(log_level)
        
        # Remove existing handlers to avoid duplicates
        for handler in self.logger.handlers[:]:
            self.logger.removeHandler(handler)
        
        # Console handler
        console_handler = logging.StreamHandler()
        console_handler.setLevel(log_level)
        
        # File handler if enabled
        if self.config['logging']['enable_file_logging']:
            log_file = Path(self.config['logging']['log_file'])
            log_file.parent.mkdir(parents=True, exist_ok=True)
            
            file_handler = logging.FileHandler(log_file)
            file_handler.setLevel(log_level)
            
            # File formatter
            file_formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            file_handler.setFormatter(file_formatter)
            self.logger.addHandler(file_handler)
        
        # Console formatter
        console_formatter = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s'
        )
        console_handler.setFormatter(console_formatter)
        self.logger.addHandler(console_handler)
    
    def _log_callback(self, level: str, message: str):
        """Callback for backend client logging."""
        log_level = getattr(logging, level.upper())
        self.logger.log(log_level, f"[BackendClient] {message}")
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully."""
        self.logger.info(f"Received signal {signum}, shutting down gracefully...")
        self.running = False
    
    def run(self) -> int:
        """Main agent loop."""
        self.running = True
        
        try:
            # Start backend communication
            if not self.backend_client.start():
                self.logger.error("Failed to start backend communication")
                return 1
            
            self.logger.info("Agent started successfully")
            
            # Main loop - just keep running while backend client handles communication
            while self.running:
                try:
                    time.sleep(1.0)  # Low CPU usage
                except KeyboardInterrupt:
                    self.logger.info("Keyboard interrupt received")
                    break
                    
        except Exception as e:
            self.logger.error(f"Error in main loop: {e}")
            return 1
        finally:
            # Clean shutdown
            self.backend_client.stop()
            self.logger.info("Agent shutdown complete")
        
        return 0


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Pankha Linux Agent - WebSocket/HTTP Communication')
    parser.add_argument('--config', '-c', help='Configuration file path')
    parser.add_argument('--debug', '-d', action='store_true', help='Enable debug logging')
    parser.add_argument('--test', '-t', action='store_true', help='Test mode (registration only)')
    parser.add_argument('--http', action='store_true', help='Force HTTP mode (disable WebSocket)')
    
    args = parser.parse_args()
    
    # Force HTTP mode if requested
    if args.http:
        global WEBSOCKET_AVAILABLE
        WEBSOCKET_AVAILABLE = False
        print("INFO: Forced HTTP mode enabled")
    
    try:
        agent = PankhaAgent(args.config)
        
        # Override log level if debug requested
        if args.debug:
            agent.logger.setLevel(logging.DEBUG)
            for handler in agent.logger.handlers:
                handler.setLevel(logging.DEBUG)
        
        # Test mode - just test registration and data sending
        if args.test:
            agent.logger.info(f"Running in test mode ({agent.communication_type})...")
            
            if agent.communication_type == "HTTP":
                # HTTP client test
                if agent.backend_client.register_with_backend():
                    agent.logger.info("✅ Registration test successful")
                    
                    # Test data transmission
                    if agent.backend_client.send_sensor_data():
                        agent.logger.info("✅ Data transmission test successful")
                        return 0
                    else:
                        agent.logger.error("❌ Data transmission test failed")
                        return 1
                else:
                    agent.logger.error("❌ Registration test failed")
                    return 1
            else:
                # WebSocket client test - just start and let it run for a few seconds
                agent.logger.info("Starting WebSocket test connection...")
                if agent.backend_client.start():
                    agent.logger.info("✅ WebSocket client started")
                    agent.logger.info("Testing for 10 seconds...")
                    time.sleep(10)
                    agent.backend_client.stop()
                    agent.logger.info("✅ WebSocket test completed")
                    return 0
                else:
                    agent.logger.error("❌ WebSocket test failed")
                    return 1
        
        # Normal operation
        return agent.run()
        
    except KeyboardInterrupt:
        print("\nAgent interrupted by user")
        return 0
    except Exception as e:
        print(f"Agent startup error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
