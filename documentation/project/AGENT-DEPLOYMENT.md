# Agent Deployment Guide

## Overview

Pankha agents are distributed components that run on individual machines to monitor temperature sensors and control fans. This guide covers how to deploy, configure, and manage agents across different systems.

## Agent Types

### 1. **Production Agents**
- **Purpose**: Real hardware monitoring and control
- **Requirements**: Hardware access to sensors and PWM fans
- **Platforms**: Linux (primary), Windows (limited)
- **Installation**: Service/daemon deployment

### 2. **Mock Agents**
- **Purpose**: Testing and development
- **Requirements**: Network access to backend
- **Platforms**: Any OS with Python 3.8+
- **Installation**: Simple Python script

## Deployment Architecture

```
Backend Server (192.168.100.237:3000)
├── API Endpoint: /api/systems (registration)
├── WebSocket: /websocket (real-time communication)
└── Database: Agent registry and configuration

                    ▲
                    │ WebSocket Connection
                    │ (Real-time bidirectional)
                    ▼

┌─────────────────────┬─────────────────────┬─────────────────────┐
│     Agent 1         │     Agent 2         │     Agent N         │
│   (Server Room)     │   (Workstation)     │   (Gaming Rig)      │
│                     │                     │                     │
│ ┌─────────────────┐ │ ┌─────────────────┐ │ ┌─────────────────┐ │
│ │ Hardware Access │ │ │ Hardware Access │ │ │ Hardware Access │ │
│ │ • /sys/hwmon/*  │ │ │ • lm-sensors    │ │ │ • Custom drivers│ │
│ │ • PWM control   │ │ │ • fancontrol    │ │ │ • GPU tools     │ │
│ └─────────────────┘ │ └─────────────────┘ │ └─────────────────┘ │
│                     │                     │                     │
│ ┌─────────────────┐ │ ┌─────────────────┐ │ ┌─────────────────┐ │
│ │ Agent Process   │ │ │ Agent Process   │ │ │ Agent Process   │ │
│ │ • pankha-agent  │ │ │ • pankha-agent  │ │ │ • pankha-agent  │ │
│ │ • Python daemon │ │ │ • Python daemon │ │ │ • Python daemon │ │
│ └─────────────────┘ │ └─────────────────┘ │ └─────────────────┘ │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

## Communication Flow

### 1. **Agent Registration**
```
Agent Startup → HTTP POST → Backend API → Database Registration
```

**Registration Process:**
1. Agent starts and reads local configuration
2. Discovers hardware capabilities (sensors/fans)
3. Sends registration request to backend API
4. Backend validates and assigns system ID
5. Agent receives confirmation and starts monitoring

**Registration Data:**
```json
{
  "agent_id": "workstation-01",
  "system_name": "Main Workstation",
  "ip_address": "192.168.1.100",
  "capabilities": {
    "sensors": [...],
    "fans": [...]
  }
}
```

### 2. **Real-time Communication**
```
Agent ←──WebSocket──→ Backend
   │                      │
   ├── Sensor Data ──────→│
   ├── Status Updates ───→│
   │←──── Commands ────────┤
   │←──── Profiles ────────┤
```

**Data Transmission (Every 3 seconds):**
```json
{
  "type": "data",
  "timestamp": "2025-08-04T03:00:00.000Z",
  "data": {
    "agentId": "workstation-01",
    "sensors": [
      {
        "id": "cpu_temp",
        "temperature": 45.2,
        "status": "ok"
      }
    ],
    "fans": [
      {
        "id": "cpu_fan",
        "speed": 35,
        "rpm": 850,
        "targetSpeed": 35
      }
    ]
  }
}
```

### 3. **Command Processing**
```
User Action → Frontend → Backend → WebSocket → Agent → Hardware
```

**Command Types:**
- `set_fan_speed`: Change fan speed
- `apply_profile`: Apply fan curve profile
- `emergency_stop`: Emergency fan override
- `get_status`: Request status update
- `restart_monitoring`: Restart sensor monitoring

## Agent Installation

### Linux (Production)

#### Prerequisites
```bash
# Install required packages
sudo apt update
sudo apt install python3 python3-pip lm-sensors

# Configure sensors
sudo sensors-detect
sudo systemctl enable lm_sensors
sudo systemctl start lm_sensors

# Verify sensor access
sensors
```

#### Installation Steps
```bash
# Note: Production agents are not yet implemented
# This section is planned for future implementation

# 1. Create agent user (planned)
sudo useradd -r -s /bin/false pankha-agent
sudo usermod -a -G gpio,i2c pankha-agent

# 2. Create directories (planned)
sudo mkdir -p /opt/pankha-agent
sudo mkdir -p /var/log/pankha-agent
sudo mkdir -p /etc/pankha-agent

# 3. Install agent files (planned)
# Production agent implementation pending

# 4. Install dependencies (planned)
cd /opt/pankha-agent
sudo pip3 install -r requirements.txt
```

#### Service Configuration (Optional - For systemd management)
```bash
# Optional: Configure systemd service for automatic startup

# Create systemd service
sudo tee /etc/systemd/system/pankha-agent.service << EOF
[Unit]
Description=Pankha Hardware Agent
After=network.target
Requires=network.target

[Service]
Type=simple
User=pankha-agent
Group=pankha-agent
WorkingDirectory=/opt/pankha-agent
ExecStart=/usr/bin/python3 /opt/pankha-agent/pankha_agent.py --config /etc/pankha-agent/config.yaml
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service (when production agent is available)
sudo systemctl daemon-reload
sudo systemctl enable pankha-agent
sudo systemctl start pankha-agent

# Check status
sudo systemctl status pankha-agent
journalctl -u pankha-agent -f
```

### Windows (Development/Testing)

#### Prerequisites
```powershell
# Install Python 3.8+
# Download from python.org

# Install required packages
pip install aiohttp websockets asyncio-mqtt

# Install hardware monitoring tools (optional)
# HWiNFO64, Open Hardware Monitor, etc.
```

#### Installation Steps (Planned - Not Yet Implemented)
```powershell
# Windows agent is planned for future implementation
# Current focus is on Linux production agents

# Planned steps:
# 1. Clone repository
# 2. Create virtual environment
# 3. Install dependencies
# 4. Configure Windows-specific hardware access
```

#### Windows Service (Optional)
```powershell
# This service configuration is ready for future production agents

# Using NSSM (Non-Sucking Service Manager)
# Download NSSM from nssm.cc

# Install as service (when production agent is available)
nssm install PankhaAgent "C:\Python\python.exe" "C:\PankhaAgent\pankha_agent.py --config C:\PankhaAgent\config.yaml"
nssm set PankhaAgent DisplayName "Pankha Hardware Agent"
nssm set PankhaAgent Description "Hardware monitoring and fan control agent"
nssm start PankhaAgent

# Service management
nssm stop PankhaAgent
nssm restart PankhaAgent
nssm remove PankhaAgent
```

## Production Linux Agent

Production Linux agents provide real hardware monitoring and fan control for actual systems. These agents replace the need for simulated testing with authentic hardware integration.

### **Security Constraints - Remote System Access**

**CRITICAL**: When accessing remote agent systems via SSH:

✅ **Allowed Operations:**
- Read-only access to entire system (logs, configs, hardware info)
- Full read-write access ONLY within agent installation directory
- Example: `/root/anex/proxmox/misc-scripts/pankha-fan-control/`
- Run agent control scripts (`pankha-agent.sh`)
- Modify agent configuration files
- Update agent code files
- View agent logs

❌ **Prohibited Operations:**
- Installing system packages (`apt install`, `yum install`, etc.)
- Modifying system-wide configurations
- Changing system services
- Editing files outside agent directory
- System-wide changes of any kind

**Agent Directory Permissions:**
- `/path/to/agent/installation/` and all subdirectories: **READ-WRITE**
- Everything else on the system: **READ-ONLY**

### Agent Deployment

#### **Development Environment**

```bash
# Backend: Start Pankha backend with PostgreSQL (pankha-dev - private repo)
cd /root/anex/dev/pankha-dev
docker compose build --no-cache  # Builds from local Dockerfile
docker compose up -d

# Client: Deploy agent to target Linux system
scp -r agents/clients/linux/debian/pankha-agent/ root@TARGET_IP:/opt/
scp agents/clients/linux/debian/pankha-agent.sh root@TARGET_IP:/opt/

# Client: Install WebSocket dependency (Debian/Ubuntu)
ssh root@TARGET_IP "apt install -y python3-websockets"

# Client: Configure and start agent
ssh root@TARGET_IP "cd /opt && ./pankha-agent.sh setup"
ssh root@TARGET_IP "cd /opt && ./pankha-agent.sh start"
```

#### **Production Environment**

```bash
# Backend: Deploy stable release (pankha - public repo)
cd /root/anex/dev/pankha
docker compose pull  # Pulls anexgohan/pankha:latest from Docker Hub
docker compose up -d

# Agent deployment same as above
```

**Deployment Access URLs:**
- **Frontend**: http://192.168.100.237:3000 (complete system dashboard)
- **Backend API**: http://192.168.100.237:3000/api (REST endpoints)
- **WebSocket**: ws://192.168.100.237:3000/websocket (real-time communication)

#### **Test System Configuration**

**Current Deployment: 192.168.100.199 (pve-shadow)**
```bash
# SSH to test system
ssh root@192.168.100.199
cd /root/anex/proxmox/misc-scripts/pankha-fan-control

# Agent management
./pankha-agent.sh start      # Start real hardware monitoring
./pankha-agent.sh status     # Check agent status
./pankha-agent.sh logs       # View real-time logs
./pankha-agent.sh stop       # Stop agent
./pankha-agent.sh config     # Edit configuration
```

### Agent Command Options

```bash
# Available management commands
./pankha-agent.sh {start|stop|restart|status|logs|config|setup|test-connection}

# Common usage patterns
./pankha-agent.sh setup               # Interactive configuration wizard
./pankha-agent.sh test-connection     # Verify backend connectivity
./pankha-agent.sh start --debug       # Start with detailed logging
```

### Production Agent Features

**Real Hardware Integration:**
- **25+ Temperature Sensors**: Actual hardware sensor discovery
  - AMD Ryzen 9 3900X CPU temperatures (k10temp)
  - Motherboard sensors (it8628 chipset)
  - NVMe SSD temperature monitoring
  - ACPI thermal zones
- **5 PWM Fans**: Real fan control with RPM feedback
  - Hardware PWM control (0-255 range)
  - Real-time RPM monitoring
  - Fan safety limits and emergency stops
- **Dynamic Discovery**: Automatic hardware detection and capabilities

**Production Behavior:**
- **Real Temperature Data**: Actual sensor readings from hardware
- **Hardware Fan Control**: Direct PWM control of physical fans
- **System Integration**: Native Linux hwmon and thermal subsystem
- **WebSocket Communication**: Real-time bidirectional data transmission

**Supported Hardware:**
```bash
# Sensor types discovered
- k10temp: AMD Ryzen CPU temperatures
- it8628: Motherboard chipset sensors  
- nvme: NVMe SSD temperature monitoring
- acpitz: ACPI thermal zones
- gigabyte_wmi: Motherboard WMI sensors

# Fan control capabilities
- PWM fans with speed control (0-100%)
- RPM monitoring and feedback
- Hardware safety limits
- Emergency stop functionality
```

### Troubleshooting Production Agents

**Common Issues:**

1. **Hardware Access Denied**
   ```bash
   # Check sensor permissions
   ls -la /sys/class/hwmon/*/temp*_input
   
   # Check fan control permissions
   ls -la /sys/class/hwmon/*/pwm*
   
   # Verify sensor detection
   sensors
   ```

2. **WebSocket Connection Failed**
   ```bash
   # Verify backend is running
   curl http://192.168.100.237:3000/health
   
   # Test WebSocket endpoint
   telnet 192.168.100.237 3000
   
   # Check agent configuration
   cat pankha-agent/config/config.json
   ```

3. **No Hardware Detected**
   ```bash
   # Load sensor modules
   sudo sensors-detect
   
   # Check hwmon devices
   ls /sys/class/hwmon/
   
   # Verify agent discovery logs
   ./pankha-agent.sh logs | grep "sensor\|fan"
   ```

4. **Dependencies Missing**
   ```bash
   # Install WebSocket library (Debian/Ubuntu)
   apt install -y python3-websockets
   
   # Verify Python version
   python3 --version
   ```

**Production Monitoring:**
```bash
# Monitor agent performance
./pankha-agent.sh logs | tail -f

# Check system resource usage
htop  # Monitor CPU/memory usage
ss -tuln | grep :3000  # Check WebSocket connections

# Verify backend registration
curl http://192.168.100.237:3000/api/systems
```

## Configuration

### Agent Configuration

#### Production Linux Agent Configuration

The production Linux agent uses a JSON configuration file at `pankha-agent/config/config.json`:

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
  }
}
```

#### Future YAML Configuration (Planned)
```yaml
# Note: This configuration format is for future production agents

# Agent identification
agent:
  id: "workstation-01"
  name: "Main Workstation"
  location: "Office Desk"

# Backend connection
server:
  host: "192.168.100.237"
  port: 3000
  websocket_port: 3000
  websocket_path: "/websocket"
  
  # Connection settings
  reconnect_interval: 5
  heartbeat_interval: 30
  timeout: 10

# Hardware configuration
hardware:
  # Sensor configuration
  sensors:
    - id: "cpu_temp"
      name: "CPU Temperature"
      type: "temperature"
      source: "/sys/class/hwmon/hwmon0/temp1_input"
      scale: 1000  # Convert millidegrees to degrees
      offset: 0
      max_temp: 85.0
      critical_temp: 95.0
      
    - id: "gpu_temp"
      name: "GPU Temperature"
      type: "temperature"
      source: "nvidia-smi"  # Custom source handler
      max_temp: 83.0
      critical_temp: 90.0

  # Fan configuration
  fans:
    - id: "cpu_fan"
      name: "CPU Fan"
      type: "pwm"
      pwm_path: "/sys/class/hwmon/hwmon0/pwm1"
      rpm_path: "/sys/class/hwmon/hwmon0/fan1_input"
      enable_path: "/sys/class/hwmon/hwmon0/pwm1_enable"
      min_speed: 20
      max_speed: 100
      
    - id: "case_fan_1"
      name: "Front Case Fan"
      type: "pwm"
      pwm_path: "/sys/class/hwmon/hwmon0/pwm2"
      rpm_path: "/sys/class/hwmon/hwmon0/fan2_input"
      min_speed: 0
      max_speed: 100

# Monitoring settings
monitoring:
  interval: 3  # Data transmission interval (seconds)
  sensor_read_interval: 1  # Sensor reading interval (seconds)
  
  # Safety settings
  safety:
    max_temp_emergency: 95.0  # Emergency stop temperature
    fan_failure_threshold: 200  # Minimum RPM to consider fan working
    enable_emergency_stop: true

# Logging
logging:
  level: "INFO"  # DEBUG, INFO, WARNING, ERROR
  file: "/var/log/pankha-agent/agent.log"
  max_size: "10MB"
  backup_count: 5
```

### Hardware Discovery
```bash
# Linux sensor discovery (Production agents support full discovery)
sudo sensors-detect

# List available sensors
ls /sys/class/hwmon/hwmon*/temp*_input
ls /sys/class/hwmon/hwmon*/fan*_input
ls /sys/class/hwmon/hwmon*/pwm*

# Test PWM control
echo 128 | sudo tee /sys/class/hwmon/hwmon0/pwm1  # 50% speed

# Check current values
cat /sys/class/hwmon/hwmon0/temp1_input  # Temperature in millidegrees
cat /sys/class/hwmon/hwmon0/fan1_input   # Fan RPM
cat /sys/class/hwmon/hwmon0/pwm1         # Fan PWM value (0-255)

# Production Linux agents automatically discover:
# - All available temperature sensors (CPU, motherboard, NVMe, ACPI, etc.)
# - All PWM-controllable fans with RPM feedback
# - Hardware-specific limits and capabilities
# - Sensor chips and thermal zones
```

## Agent Management

### Backend Agent Registry

**View Registered Agents:**
```bash
curl http://192.168.100.237:3000/api/systems
```

**Agent Status:**
- `online` - Connected and sending data
- `offline` - Registered but not connected
- `error` - Connection issues or hardware problems
- `installing` - Initial setup in progress

### Monitoring Agent Health

**Agent Logs:**
```bash
# Linux systemd
journalctl -u pankha-agent -f

# Manual execution
python pankha_agent.py --debug
```

**Connection Issues:**
1. **Network connectivity**: Can agent reach backend?
2. **WebSocket connection**: Is `/websocket` endpoint accessible?
3. **Hardware permissions**: Can agent access sensor files?
4. **Configuration**: Are server details correct?

### Agent Commands

**Remote Commands (via Backend):**
```bash
# Set fan speed
curl -X POST http://192.168.100.237:3000/api/systems/1/fans/cpu_fan \
  -H "Content-Type: application/json" \
  -d '{"speed": 50, "priority": "user"}'

# Apply fan profile
curl -X POST http://192.168.100.237:3000/api/systems/1/profile \
  -H "Content-Type: application/json" \
  -d '{"profile_name": "quiet"}'

# Emergency stop
curl -X POST http://192.168.100.237:3000/api/emergency-stop
```

## Troubleshooting

### Common Issues

**1. Permission Denied (Linux)**
```bash
# Check user permissions
groups pankha-agent

# Add to required groups
sudo usermod -a -G gpio,i2c pankha-agent

# Check file permissions
ls -la /sys/class/hwmon/hwmon0/
```

**2. WebSocket Connection Failed**
```bash
# Test WebSocket endpoint
curl -H "Connection: Upgrade" -H "Upgrade: websocket" \
  http://192.168.100.237:3000/websocket

# Check backend logs
docker logs pankha-app-1
```

**3. Sensor Not Found**
```bash
# Verify sensor paths
ls /sys/class/hwmon/hwmon*/temp*_input

# Check sensor values
cat /sys/class/hwmon/hwmon0/temp1_input

# Reload sensor modules
sudo modprobe -r <sensor_module>
sudo modprobe <sensor_module>
```

**4. Fan Control Not Working**
```bash
# Check PWM support
cat /sys/class/hwmon/hwmon0/pwm1_enable

# Enable manual control
echo 1 | sudo tee /sys/class/hwmon/hwmon0/pwm1_enable

# Test fan control
echo 255 | sudo tee /sys/class/hwmon/hwmon0/pwm1  # Max speed
echo 0 | sudo tee /sys/class/hwmon/hwmon0/pwm1    # Min speed
```

### Debug Mode

**Run Agent in Debug Mode:**
```bash
# Linux
python3 pankha_agent.py --config /etc/pankha-agent/config.yaml --debug

# Windows
python pankha_agent.py --config config.yaml --debug
```

**Debug Output Example:**
```
2025-08-04 08:30:00 - INFO - Starting Pankha Agent for workstation-01
2025-08-04 08:30:00 - INFO - Server: http://192.168.100.237:3000
2025-08-04 08:30:00 - INFO - WebSocket: ws://192.168.100.237:3000/websocket
2025-08-04 08:30:01 - INFO - ✅ Successfully registered with Pankha server
2025-08-04 08:30:01 - INFO - System ID: 2
2025-08-04 08:30:01 - DEBUG - Discovered 5 sensors, 3 fans
2025-08-04 08:30:01 - INFO - ✅ WebSocket connected
2025-08-04 08:30:04 - DEBUG - Sensor data: cpu_temp=45.2°C, gpu_temp=42.1°C
2025-08-04 08:30:04 - DEBUG - Fan data: cpu_fan=850rpm (35%), case_fan=450rpm (30%)
```

## Security Considerations

### Network Security
- **Firewall**: Open only required ports (3000 for backend)
- **VPN**: Use VPN for remote agent connections
- **SSL/TLS**: Enable HTTPS/WSS for production

### Agent Security
- **Minimal Privileges**: Run agent with minimal required permissions
- **File Permissions**: Restrict config file access
- **Authentication**: Use unique agent tokens
- **Updates**: Keep agent software updated

### Hardware Safety
- **Temperature Limits**: Configure emergency temperature thresholds
- **Fan Minimums**: Enforce minimum fan speeds
- **Safety Overrides**: Implement hardware-level safety mechanisms

---

*This guide enables deployment of Pankha agents across diverse hardware environments, ensuring reliable monitoring and control of cooling systems.*