# Pankha (पंखा) - Open Source Fan Control System

![Docker Pulls](https://img.shields.io/docker/pulls/anexgohan/pankha)
![GitHub Discussions](https://img.shields.io/github/discussions/Anexgohan/pankha)
![GitHub Repo Size](https://img.shields.io/github/repo-size/Anexgohan/pankha)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)

![GitHub Latest Downloads](https://img.shields.io/github/downloads/Anexgohan/pankha/latest/total?label=Latest%20Downloads)
![GitHub Total Downloads](https://img.shields.io/github/downloads/Anexgohan/pankha/total?label=Total%20Downloads)
![GitHub Commit Activity](https://img.shields.io/github/commit-activity/m/Anexgohan/pankha)
![GitHub Last Commit](https://img.shields.io/github/last-commit/Anexgohan/pankha)
![GitHub Release](https://img.shields.io/github/v/release/Anexgohan/pankha)

![GitHub Stars](https://img.shields.io/github/stars/Anexgohan/pankha?style=social)
![GitHub Forks](https://img.shields.io/github/forks/Anexgohan/pankha?style=social)
![GitHub Watchers](https://img.shields.io/github/watchers/Anexgohan/pankha?style=social)
![GitHub Sponsors](https://img.shields.io/github/sponsors/Anexgohan?style=social)
![GitHub Issues](https://img.shields.io/github/issues/Anexgohan/pankha)
![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Anexgohan/pankha)

![Reddit Subscribers](https://img.shields.io/reddit/subreddit-subscribers/selfhosted?style=social)
![Discord](https://img.shields.io/discord/:serverId?label=Pankha%20Discord&logo=discord)

---
Is an open-source Distributed fan control system with Centralized Management system for monitoring and controlling hardware cooling across multiple machines. Production-ready with real-time hardware monitoring, WebSocket communication, and PostgreSQL database.

## Features:

- **Real-time Temperature Monitoring** - Manage multiple sensors across multiple hardware types
- **PWM Fan Control** - Direct hardware control with RPM feedback, Profiles, and Safety features, historical data visualization.
- **Multi-System Support** - Monitor and control multiple machines from one dashboard
- **Web Dashboard** - Modern React interface with real-time updates
- **WebSocket Communication** - Bidirectional real-time data transmission to centralize control
- **Easy Deployment** - Docker based server deployment, with one command setup for agents
- **PostgreSQL Database** - Production-grade time-series data storage
- **Open Source**

## Showcase:  
Centralized Dashboard:  
![Centralized Dashboard](documentation/public/images/zen_2025-11-05_00-38-15_IutnWbxl11.png)  

Agent widget:  
![Agent widget](documentation/public/images/zen_2025-11-09_10-06-33_dsPnjkAOT3.png)  

Temperature Sensors:  
![Temperature Sensors](documentation/public/images/2025-11-09_10-08-14_sQjuyQPPjL.png)  

Fan Control:  
![Fan Control](documentation/public/images/2025-11-09_10-11-32_2L9HjamqLC.png)  

Profiles:  
![Profiles](documentation/public/images/zen_2025-11-05_00-38-44_57LBUM5n3B.png)  

Fully Customizable:  
![Profiles](documentation/public/images/zen_2025-11-05_00-39-25_A8ywDiMWc8.png)  
![Import Export](documentation/public/images/zen_2025-11-05_00-41-41_7vx3VRh0Fl.png)  

## Why Pankha?

  - ✅ Reduced Fan Wear - Fewer speed changes extend fan lifespan
  - ✅ Quieter Operation - Smooth transitions eliminate abrupt noise changes
  - ✅ Stable UI - No flickering fan speed indicators
  - ✅ Better UX - Professional, predictable behavior
  - ✅ Energy Efficiency - Smoother transitions reduce power spikes
  - ✅ User Control - Tune behavior per system/use case
  - ✅ Safety - Emergency override ensures critical temps handled immediately
  - ✅ Multi-System Support - Monitor and control multiple machines from one dashboard
  - ✅ Open Source - Easy to deploy, manage, and scale
  - ✅ Real-time Updates - Instant feedback on temperature and fan speed changes
  - ✅ Real-time Profiles - Customizable fan profiles for different workloads
  - ✅ Real-time Data - Historical data visualization for better planning

## Instructions:

### Prerequisites

- Docker and Docker Compose for server deployment
- System with fan control capabilities (for agents)

# Server Installation Guide :
## Docker Compose Deployment:
1. Download the Docker Compose file:
   ```bash
   wget -O compose.yml https://github.com/Anexgohan/pankha/releases/latest/download/compose.yml
   ```
   or,
   ```bash
   curl -fsSLo compose.yml https://github.com/Anexgohan/pankha/releases/latest/download/compose.yml
   ```
2. Download the .env file
   ```bash
   wget -O .env https://github.com/Anexgohan/pankha/releases/latest/download/example.env
   ```
   or,
   ```bash
   curl -fsSLo .env https://github.com/Anexgohan/pankha/releases/latest/download/example.env
   ```
3. Start Docker Compose
   ```bash
   docker pull && docker compose up -d
   ```

## Clone and Deploy (Alternate Method):
1. Clone the repository  
    this creates a pankha directory in your current path
    ```bash
    git clone https://github.com/Anexgohan/pankha.git
    cd pankha
    ```
    or, clone to current directory without creating pankha/ folder
      ```bash
      git clone https://github.com/Anexgohan/pankha.git .
      ```
    NOTE:  
    Edit `.env` and `compose` with your configuration, if needed.

2. Start the system  
      ```bash
      docker compose pull && docker compose up -d
      ```

That's it! The backend is now running with:
  - Access the Web Dashboard at http://localhost:3000 or, http://[serverIP]:[3000]  
  - To stop the system, run:  
    ```bash
    docker compose down
    ```

# Agent Installation Guide:  
# Agent Installation Guide:  

### 1. Windows Agent (New!)
**Requirements**: Windows 10/11, .NET 8 Runtime.

1. **Download Installer**:
   - Download `PankhaAgentSetup.msi` from [Latest Releases](https://github.com/Anexgohan/pankha/releases/latest).
2. **Install**:
   - Run the installer. It will install the Background Service and Tray Application.
3. **Configure**:
   - Launch "Pankha Fan Control" from the Start Menu.
   - Right-click the Tray Icon -> **Settings** to configure the backend URL.

### 2. Linux Client Agent (Rust)
**Performance**: Single binary, <10MB RAM, <1% CPU. Zero dependencies.

## *For x86_64 systems (Intel/AMD):*
  - With wget
    ```bash
    wget -O pankha-agent-linux_x86_64 https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x86_64
    chmod +x pankha-agent-linux_x86_64
    ```
  - Or, With curl
    ```bash
    curl -fsSLo pankha-agent-linux_x86_64 https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_x86_64
    chmod +x pankha-agent-linux_x86_64
    ```
  ***Configure and manage the x86_64 agent using the following commands:***

  1. Configure agent (Required for first time)
      ```bash
      ./pankha-agent-linux_x86_64 --setup
      ```
  2. Start agent (Make sure --setup is done first)
      ```bash
      ./pankha-agent-linux_x86_64 --start
      ```
  3. Check status
      ```bash
      ./pankha-agent-linux_x86_64 --status
      ```
  4. Stop agent
      ```bash
      ./pankha-agent-linux_x86_64 --stop
      ```
  5. Help, or list all commands and options
      ```bash
      ./pankha-agent-linux_x86_64 --help
        ```

## *For ARM64 systems (Raspberry Pi 5, pimox, pxvirt, ARM sbc, etc):*
  - With wget
    ```bash
    wget -O pankha-agent-linux_arm64 https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
    chmod +x pankha-agent-linux_arm64
    ```
  - Or, With curl
    ```bash
    curl -fsSLo pankha-agent-linux_arm64 https://github.com/Anexgohan/pankha/releases/latest/download/pankha-agent-linux_arm64
    chmod +x pankha-agent-linux_arm64
    ```

  ***Configure and manage the arm64 agent using the following commands:***

  1. Configure agent (Required for first time)
      ```bash
      ./pankha-agent-linux_arm64 --setup
      ```
  2. Start agent (Make sure --setup is done first)
      ```bash
      ./pankha-agent-linux_arm64 --start
      ```
  3. Check status
      ```bash
      ./pankha-agent-linux_arm64 --status
      ```
  4. Stop agent
      ```bash
      ./pankha-agent-linux_arm64 --stop
      ```
  5. Help, or list all commands and options
      ```bash
      ./pankha-agent-linux_arm64 --help
      ```

The agent will connect to the backend and start sending hardware data. You can now manage the agent from the dashboard.

## Documentation

- [Installation Guide](documentation/public/getting-started/installation.md) - Server setup and deployment
- [Agent Setup Guide](documentation/public/getting-started/agent-setup.md) - Installing and configuring agents
- [Backend Configuration](documentation/public/configuration/backend.md) - Server environment and settings
- [Agent Configuration](documentation/public/configuration/agent.md) - Agent configuration options
- [API Documentation](documentation/public/api/endpoints.md) - REST API reference
- [Backend Troubleshooting](documentation/public/troubleshooting/backend.md) - Server issues and solutions
- [Agent Troubleshooting](documentation/public/troubleshooting/agent.md) - Agent issues and solutions

## Architecture

```
Browser ←HTTP/WS→ Backend (Docker) ←WebSocket→ Agents ←Direct→ Hardware
```

- **Backend**: Node.js + Express + WebSocket + PostgreSQL (Dockerized)
- **Frontend**: React + TypeScript + Vite (served by nginx)
- **Agents**: 
  - **Linux**: Rust single binary processes (sysfs)
  - **Windows**: .NET 8 Service (LibreHardwareMonitor)

## Extra:
- **Verify installation**
   ```bash
   # Check services are running
   docker compose ps

   # Check backend health
   curl http://localhost:3000/health

   # Access dashboard
   open http://localhost:3000
   ```

- **Cleanup**
   ```bash
   # To stop services
   docker compose down

   # To remove volumes (data loss)
   docker compose down -v
   ```

### Option 2: Manual Build

Build from source:  

  Clone repository  
  ```bash
  git clone https://github.com/Anexgohan/pankha.git
  cd pankha
  ```
  Build Docker image
  ```bash
  docker compose pull
  docker compose build --no-cache
  ```
  Run with compose
  ```bash
  docker compose up -d
  ```

## Configuration

### Backend Configuration

Environment variables in `.env`:

```bash
# Database Configuration
POSTGRES_DB=db_pankha
POSTGRES_USER=pankha_user
POSTGRES_PASSWORD=your_secure_password
DATABASE_URL=postgresql://pankha_user:your_secure_password@pankha-postgres:5432/db_pankha

# Server Configuration
PANKHA_PORT=3000
NODE_ENV=production
```

### Agent Configuration
Generate Agent config with 
```bash
./pankha-agent --setup
```

Agent configuration file: `config.json` (running directory)

```json
{
  "agent": {
    "id": "OS-mysystem-randomhash",
    "name": "hostname-or-custom-name",
    "update_interval": 3.0,
    "log_level": "INFO"
  },
  "backend": {
    "server_url": "ws://192.168.1.100:3000/websocket",
    "reconnect_interval": 30.0,
    "max_reconnect_attempts": -1,
    "connection_timeout": 10.0
  },
  "hardware": {
    "enable_fan_control": true,
    "enable_sensor_monitoring": true,
    "fan_safety_minimum": 30,
    "temperature_critical": 80.0,
    "filter_duplicate_sensors": false,
    "duplicate_sensor_tolerance": 2.0,
    "fan_step_percent": 5,
    "hysteresis_temp": 3.0,
    "emergency_temp": 80.0
  },
  "logging": {
    "enable_file_logging": true,
    "log_file": "/var/log/pankha-agent/agent.log",
    "max_log_size_mb": 10,
    "log_retention_days": 7
  }
}


```

## Troubleshooting

### Backend Issues

**Issue: Cannot connect to database**
```bash
# Check PostgreSQL is running
docker compose ps

# Check logs
docker compose logs postgres

# Verify DATABASE_URL in .env
cat .env | grep DATABASE_URL
```

**Issue: Port already in use**
```bash
# Change port in compose
    ports:
      - "${PANKHA_PORT:-7000}:3000"
# or in .env file
    PANKHA_PORT=7000

# Restart
docker compose down
docker compose up -d
```

### Agent Issues

**Issue: Agent cannot connect to backend**
```bash
# Test backend connectivity
curl http://your-backend:3000/health

# Check agent logs
tail -f /var/log/pankha-agent/agent.log

# Verify config
./pankha-agent --config
```

**Issue: No sensors detected**
```bash
# Verify lm-sensors
sensors

# Check permissions
ls -la /sys/class/hwmon/

# Run as root
sudo ./pankha-agent --start
```

**Issue: Fan control not working**
```bash
# Check PWM support
cat /sys/class/hwmon/hwmon*/pwm*

# Test manual control
echo 128 | sudo tee /sys/class/hwmon/hwmon0/pwm1
```

## Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## System Requirements

### Backend (Server)
- CPU: x86_64 or ARM64
- RAM: 256MB minimum
- Disk: 1GB (for database)
- OS: Linux, Windows (Docker supported), Mac support in future

### Agent (Client)
- CPU: <1% usage
- RAM: <50MB
- OS: Linux with hwmon support, Windows
- Requirements:
  - PWM-controllable fans

## Supported Hardware

### Fan Control
- ✅ PWM fans (4-pin, Speed control)
- ✅ DC fans (voltage control, On/Off)
- Hardware monitoring chips (IPMI, Supermicro, Dell iDRAC), coming soon

## License

This project is licensed under the AGPL-3.0 License ![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg) , see the [LICENSE](LICENSE) file for details.

## Links

- **GitHub**: https://github.com/Anexgohan/pankha
- **Docker Hub**: https://hub.docker.com/r/anexgohan/pankha
- **Issues**: https://github.com/Anexgohan/pankha/issues
- **Discussions**: https://github.com/Anexgohan/pankha/discussions

## Support

- **Issues**: [GitHub Issues](https://github.com/Anexgohan/pankha/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Anexgohan/pankha/discussions)
- **Discord**: [Discore coming Soon](#discord)

## Acknowledgments

- Built with Node.js, React, and PostgreSQL
- Inspired by the need for centralized hardware monitoring
- Thanks to the open source community

---

**Made with ❤️ for the self-hosting community**
