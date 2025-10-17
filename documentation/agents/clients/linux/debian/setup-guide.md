# Pankha Linux Agent Setup Guide

This guide provides step-by-step instructions for installing and configuring Pankha Linux client agents on real hardware systems for production monitoring and fan control.

## **Security Policy - Remote System Access**

**CRITICAL CONSTRAINT**: When accessing remote agent systems:

✅ **Allowed:**
- Read-only access to entire remote system
- Full read-write access to agent installation directory ONLY
- Example: `/root/anex/proxmox/misc-scripts/pankha-fan-control/`

❌ **Prohibited:**
- System package installation
- System-wide configuration changes
- File modifications outside agent directory
- Any system-level changes

**All operations on remote systems must respect these constraints.**

## Table of Contents
- [Prerequisites](#prerequisites)
- [Linux Installation](#linux-installation)
- [Configuration](#configuration)
- [Testing & Verification](#testing--verification)
- [Troubleshooting](#troubleshooting)
- [Uninstallation](#uninstallation)

## Prerequisites

### Hardware Requirements
- **Supported Hardware**: Linux systems with PWM-controllable fans and temperature sensors
- **Motherboard**: Must support fan control via PWM (most modern motherboards)
- **Sensors**: Temperature sensors accessible via `/sys/class/hwmon` or `/sys/class/thermal`
- **Network**: Ethernet or Wi-Fi connection to reach the Pankha server

### Software Requirements
- **Linux**: Any modern distribution with kernel 3.10+ and root access
- **Python**: 3.8 or higher (included in most modern Linux distributions)
- **Dependencies**: `python3-websockets` library (Debian package)
- **Network Access**: WebSocket communication with Pankha server

### Network Requirements
- **Outbound Access**: Agent needs to connect to Pankha server
- **WebSocket Port**: 3000 (WebSocket real-time communication via /websocket path)
- **Protocol**: WebSocket bidirectional communication
- **Firewall**: May need to allow outbound connections on port 3000

## Linux Installation

### Quick Installation

1. **Deploy agent files to target system**:
   ```bash
   # Create installation directory
   sudo mkdir -p /opt/pankha-agent
   
   # Copy agent files from development system
   scp -r agents/clients/linux/debian/pankha-agent/ root@TARGET_IP:/opt/pankha-agent/
   scp agents/clients/linux/debian/pankha-agent.sh root@TARGET_IP:/opt/pankha-agent/
   ```

2. **Install WebSocket dependency**:
   ```bash
   # Ubuntu/Debian (required for WebSocket communication)
   sudo apt update
   sudo apt install -y python3-websockets
   
   # RHEL/CentOS/Fedora
   sudo dnf install -y python3-websockets
   
   # Arch Linux
   sudo pacman -S python-websockets
   ```

3. **Configure hardware access**:
   ```bash
   # Detect and load sensor modules
   sudo sensors-detect --auto
   
   # Test sensor readings
   sensors
   
   # Check PWM fan control availability
   find /sys/class/hwmon -name "pwm*" 2>/dev/null | head -5
   ```

### Agent Control Script

The agent includes a comprehensive control script for lifecycle management:

```bash
# Navigate to agent directory
cd /opt/pankha-agent

# Setup interactive configuration
./pankha-agent.sh setup

# Test hardware discovery and server connection
./pankha-agent.sh test-connection

# Start the agent
./pankha-agent.sh start

# Check status and view logs
./pankha-agent.sh status
./pankha-agent.sh logs

# Stop the agent
./pankha-agent.sh stop
```

### Production Deployment Example

**Current Test System: 192.168.100.199 (pve-shadow)**
```bash
# SSH to production system
ssh root@192.168.100.199
cd /root/anex/proxmox/misc-scripts/pankha-fan-control

# Production agent management
./pankha-agent.sh start      # Start real hardware monitoring
./pankha-agent.sh status     # Check agent status and hardware discovery
./pankha-agent.sh logs       # View real-time WebSocket communication
```

## Configuration

### Agent Configuration File

The agent uses JSON configuration located at `pankha-agent/config/config.json`:

```json
{
  "agent": {
    "id": "linux-agent-hostname",
    "name": "Production System",
    "update_interval": 3,
    "log_level": "INFO"
  },
  "backend": {
    "server_url": "ws://192.168.100.237:3000/websocket",
    "reconnect_interval": 30.0,
    "max_reconnect_attempts": -1,
    "connection_timeout": 10.0
  },
  "hardware": {
    "enable_fan_control": true,
    "enable_sensor_monitoring": true,
    "fan_safety_minimum": 10,
    "temperature_critical": 85.0
  },
  "logging": {
    "enable_file_logging": true,
    "log_file": "/var/log/pankha-agent/agent.log",
    "max_log_size_mb": 10,
    "log_retention_days": 7
  }
}
```

### Interactive Configuration

Use the setup command for guided configuration:

```bash
./pankha-agent.sh setup
```

This will:
- Configure backend server connection
- Set agent identification
- Configure hardware monitoring options
- Set up logging preferences
- Test hardware discovery
- Validate server connectivity

## Testing & Verification

### 1. Test Agent Installation

```bash
# Check configuration
./pankha-agent.sh config

# Test hardware access
./pankha-agent.sh test-connection

# Expected output:
# ✓ Server is reachable at 192.168.100.237:3000
# ✓ Hardware discovery completed
# ✓ WebSocket connection test passed
```

### 2. Test Real Hardware Discovery

```bash
# Start agent and monitor hardware discovery
./pankha-agent.sh start
./pankha-agent.sh logs

# Expected results (example from AMD Ryzen 9 3900X system):
# Hardware Discovery: 25+ sensors detected
# - k10temp: CPU temperatures (Tctl, Tccd1, Tccd2)
# - it8628: Motherboard sensors
# - nvme: SSD temperatures
# - acpitz: ACPI thermal zones
# Fan Discovery: 5 PWM fans detected
# - it8628 Fan 1-5 with RPM control
```

### 3. Test WebSocket Communication

```bash
# Monitor WebSocket connection and data transmission
./pankha-agent.sh logs | grep WebSocket

# Expected WebSocket messages:
# ✅ WebSocket connected
# ✅ Agent registered successfully via WebSocket
# Communication type: WebSocket
# Real-time sensor data transmission every 3 seconds
```

### 4. Test Server Integration

```bash
# Verify agent registration on backend
curl http://192.168.100.237:3000/api/systems

# Expected: Agent appears with real hardware capabilities
# - 25+ sensors with actual temperature readings
# - 5+ fans with RPM values
# - WebSocket real_time_status: "online"
```

### 5. Test Fan Control

```bash
# Use Pankha dashboard to test fan control:
# 1. Access http://192.168.100.237:3000
# 2. Navigate to systems page
# 3. Adjust fan speed sliders
# 4. Observe real hardware fan speed changes
# 5. Monitor RPM feedback in real-time
```

## Troubleshooting

### Common Issues

#### 1. WebSocket Connection Failed

**Symptoms**: Agent can't connect to backend
```bash
# Check server connectivity
curl http://192.168.100.237:3000/health

# Test WebSocket port
telnet 192.168.100.237 3000

# Verify agent configuration
cat pankha-agent/config/config.json
```

#### 2. Hardware Discovery Issues

**Symptoms**: No sensors or fans detected
```bash
# Check sensor modules
sudo sensors-detect --auto
sensors

# Verify hwmon devices
ls -la /sys/class/hwmon/*/temp*_input
ls -la /sys/class/hwmon/*/pwm*

# Check agent discovery logs
./pankha-agent.sh logs | grep -i "sensor\|fan"
```

#### 3. Missing WebSocket Dependency

**Symptoms**: `ModuleNotFoundError: No module named 'websockets'`
```bash
# Install WebSocket library (Debian/Ubuntu)
sudo apt install -y python3-websockets

# Verify installation
python3 -c "import websockets; print('WebSocket library available:', websockets.__version__)"
```

#### 4. Permission Issues

**Symptoms**: Cannot read sensors or control fans
```bash
# Check hardware permissions
ls -la /sys/class/hwmon/*/temp*_input
ls -la /sys/class/hwmon/*/pwm*

# Test manual sensor reading
cat /sys/class/hwmon/hwmon*/temp*_input

# Test manual fan control (careful!)
echo 128 | sudo tee /sys/class/hwmon/hwmon*/pwm1
```

### Log Analysis

**Important log messages**:

```bash
# Successful startup and hardware discovery
INFO - Hardware Discovery: 25 sensors, 5 fans detected
INFO - Communication type: WebSocket
INFO - ✅ WebSocket connected
INFO - ✅ Agent registered successfully via WebSocket

# Hardware issues
WARNING - ✗ Sensor discovery failed
WARNING - ✗ Fan control discovery failed
ERROR - Hardware access denied

# Connection issues
ERROR - WebSocket connection failed
WARNING - Server unreachable
ERROR - Registration failed
```

### Performance Monitoring

```bash
# Monitor agent performance
htop  # Check CPU/memory usage (<50MB, <1% CPU expected)

# Monitor WebSocket connections
ss -tuln | grep :3000

# Check backend statistics
curl -s http://192.168.100.237:3000/health | jq '.statistics'
```

## Hardware Compatibility

### Tested Systems

**AMD Ryzen 9 3900X System (192.168.100.199)**
- **Sensors**: 25+ temperature sensors discovered
- **Fans**: 5 PWM fans with full control
- **Chipset**: it8628 motherboard sensors
- **Status**: Production deployment successful

### Supported Hardware

- **CPU Sensors**: AMD k10temp, Intel coretemp
- **Motherboard**: it87xx series chipsets
- **Storage**: NVMe temperature monitoring
- **Thermal**: ACPI thermal zones
- **Fan Control**: PWM-capable fans (0-255 range)

## Uninstallation

### Remove Agent

```bash
# Stop agent
./pankha-agent.sh stop

# Remove installation directory
sudo rm -rf /opt/pankha-agent

# Remove logs
sudo rm -rf /var/log/pankha-agent

# Remove systemd service (if installed)
sudo systemctl disable pankha-agent
sudo rm /etc/systemd/system/pankha-agent.service
sudo systemctl daemon-reload
```

---

## Production Notes

- **WebSocket Communication**: Real-time bidirectional data transmission
- **Hardware Integration**: Direct hardware sensor and fan access
- **Performance**: <50MB memory, <1% CPU usage
- **Security**: Minimal dependencies (single WebSocket library)
- **Reliability**: Automatic reconnection and error handling

For advanced configuration and deployment scenarios, see the complete documentation in `documentation/project/AGENT-DEPLOYMENT.md`.