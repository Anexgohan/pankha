# Pankha - Open Source Fan Control System

![Docker Pulls](https://img.shields.io/docker/pulls/anexgohan/pankha)
![GitHub Discussions](https://img.shields.io/github/discussions/Anexgohan/pankha)
![GitHub Repo Size](https://img.shields.io/github/repo-size/Anexgohan/pankha)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)

![GitHub Release](https://img.shields.io/github/v/release/Anexgohan/pankha)
![GitHub Last Commit](https://img.shields.io/github/last-commit/Anexgohan/pankha)
![GitHub Stars](https://img.shields.io/github/stars/Anexgohan/pankha?style=social)
![GitHub Forks](https://img.shields.io/github/forks/Anexgohan/pankha?style=social)
![GitHub Watchers](https://img.shields.io/github/watchers/Anexgohan/pankha?style=social)
![GitHub Issues](https://img.shields.io/github/issues/Anexgohan/pankha)
![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Anexgohan/pankha)
![GitHub Sponsors](https://img.shields.io/github/sponsors/Anexgohan?style=social)

![Reddit Subscribers](https://img.shields.io/reddit/subreddit-subscribers/selfhosted?style=social)
![Discord](https://img.shields.io/discord/112233445566778899?label=Discord&logo=discord)

# Pankha (पंखा) - Fan Control System
Is an open-source Distributed fan control system with Centralized Management system for monitoring and controlling hardware cooling across multiple machines. Production-ready with real-time hardware monitoring, WebSocket communication, and PostgreSQL database.

## Features:

- **Real-time Temperature Monitoring** - 25+ sensors across multiple hardware types
- **PWM Fan Control** - Direct hardware control with RPM feedback
- **Multi-System Support** - Monitor and control multiple machines from one dashboard
- **Web Dashboard** - Modern React interface with real-time updates
- **WebSocket Communication** - Bidirectional real-time data transmission
- **Easy Deployment** - Docker-based deployment with one command
- **PostgreSQL Database** - Production-grade time-series data storage
- **Open Source**

## Instructions:

### Prerequisites

- Docker and Docker Compose for server deployment
- System with fan control capabilities (for agents)

### Deploy Backend (Server)

```bash
# Clone the repository
git clone https://github.com/Anexgohan/pankha.git
cd pankha

# Create environment file
cp .env.example .env
# Edit .env with your configuration

# Start the system
docker compose up -d

# Access the dashboard
open http://localhost:3000
```

That's it! The backend is now running with:
- Web dashboard on port 3000
- PostgreSQL database
- WebSocket server for agent connections

### Deploy Agent (Client)

Deploy agents on each machine you want to monitor:

```bash
# These instructions are outdated, change to the newer single binary rust agent:
# On your target system (Linux)
wget https://github.com/Anexgohan/pankha/archive/refs/heads/main.zip
unzip main.zip
cd pankha-main/agents/clients/linux/debian

# Install dependency
sudo apt install python3-websockets

# Configure agent
./pankha-agent.sh setup

# Start agent
./pankha-agent.sh start

# Check status
./pankha-agent.sh status
```

## Documentation

- [Installation Guide](#installation-guide)
- [Agent Setup](#agent-setup)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)

## Architecture

```
Browser ←HTTP/WS→ Backend (Docker) ←WebSocket→ Agents ←Direct→ Hardware
```

- **Backend**: Node.js + Express + WebSocket + PostgreSQL (Dockerized)
- **Frontend**: React + TypeScript + Vite (served by nginx)
- **Agents**: Python processes with direct hardware access

## Installation Guide

### Option 1: Docker Compose (Recommended)

**Requirements:**
- Docker 20.10+
- Docker Compose 2.0+

**Steps:**

1. **Download and extract**
   ```bash
   git clone https://github.com/Anexgohan/pankha.git
   cd pankha
   ```

2. **Configure environment**
   ```bash
   # Create .env file
   cat > .env << EOF
   # Database
   POSTGRES_DB=db_pankha
   POSTGRES_USER=pankha
   POSTGRES_PASSWORD=your_secure_password_here

   # Application
   PANKHA_PORT=3000
   DATABASE_URL=postgresql://pankha:your_secure_password_here@pankha-postgres:5432/db_pankha
   EOF
   ```

3. **Start services**
   ```bash
   docker compose up -d
   ```

4. **Verify installation**
   ```bash
   # Check services are running
   docker compose ps

   # Check backend health
   curl http://localhost:3000/health

   # Access dashboard
   open http://localhost:3000
   ```

### Option 2: Manual Build

If you prefer to build from source:

```bash
# Clone repository
git clone https://github.com/Anexgohan/pankha.git
cd pankha

# Build Docker image
docker build -t pankha:local -f docker/Dockerfile .

# Run with compose
docker compose up -d
```

## 🤖 Agent Setup

### Linux Agent (Production)

#### Prerequisites
```bash
# Install required packages
sudo apt update
sudo apt install python3 python3-pip lm-sensors

# Configure sensors
sudo sensors-detect

# Install WebSocket library
sudo apt install python3-websockets
```

#### Installation

1. **Deploy agent files**
   ```bash
   # Download agent
   wget https://github.com/Anexgohan/pankha/archive/refs/heads/main.zip
   unzip main.zip
   cd pankha-main/agents/clients/linux/debian

   # Or use git
   git clone https://github.com/Anexgohan/pankha.git
   cd pankha/agents/clients/linux/debian
   ```

2. **Configure agent**
   ```bash
   ./pankha-agent.sh setup
   ```

   You'll be prompted for:
   - Agent ID (unique name for this system)
   - System name (friendly name)
   - Backend server URL (e.g., `ws://192.168.1.100:3000/websocket`)

3. **Start agent**
   ```bash
   ./pankha-agent.sh start
   ```

4. **Verify connection**
   ```bash
   # Check agent status
   ./pankha-agent.sh status

   # View logs
   ./pankha-agent.sh logs

   # Check backend received data
   curl http://your-backend:3000/api/systems
   ```

#### Agent Management

```bash
# Start agent
./pankha-agent.sh start

# Stop agent
./pankha-agent.sh stop

# Restart agent
./pankha-agent.sh restart

# View logs
./pankha-agent.sh logs

# Check status
./pankha-agent.sh status

# Edit configuration
./pankha-agent.sh config
```

## ⚙️ Configuration

### Backend Configuration

Environment variables in `.env`:

```bash
# Database Configuration
POSTGRES_DB=db_pankha
POSTGRES_USER=pankha
POSTGRES_PASSWORD=your_secure_password
DATABASE_URL=postgresql://pankha:password@pankha-postgres:5432/db_pankha

# Server Configuration
PANKHA_PORT=3000
NODE_ENV=production

# PostgreSQL Tuning (Optional)
POSTGRES_MAX_WAL_SIZE=256MB
POSTGRES_MIN_WAL_SIZE=80MB
POSTGRES_CHECKPOINT_TIMEOUT=5min
```

### Agent Configuration
Generate Agent config with 
```bash
./pankha-agent setup
```

Agent configuration file: `pankha-agent/config/config.json`

```json
{
  "agent": {
    "id": "my-system-01",
    "name": "My System",
    "update_interval": 3,
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
    "fan_safety_minimum": 10,
    "temperature_critical": 85.0
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
./pankha-agent.sh logs

# Verify config
cat pankha-agent/config/config.json
```

**Issue: No sensors detected**
```bash
# Verify lm-sensors
sensors

# Check permissions
ls -la /sys/class/hwmon/

# Run as root
sudo ./pankha-agent.sh start
```

**Issue: Fan control not working**
```bash
# Check PWM support
cat /sys/class/hwmon/hwmon*/pwm*

# Test manual control
echo 128 | sudo tee /sys/class/hwmon/hwmon0/pwm1
```

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📊 System Requirements

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

## 🏷️ Supported Hardware

### Fan Control
- ✅ PWM fans (4-pin, Speed control)
- ✅ DC fans (voltage control, On/Off)
- Hardware monitoring chips (IPMI, Supermicro, Dell iDRAC), coming soon

## 📜 License

This project is licensed under the AGPL-3.0 License ![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg) , see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **GitHub**: https://github.com/Anexgohan/pankha
- **Docker Hub**: https://hub.docker.com/r/anexgohan/pankha
- **Issues**: https://github.com/Anexgohan/pankha/issues
- **Discussions**: https://github.com/Anexgohan/pankha/discussions

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/Anexgohan/pankha/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Anexgohan/pankha/discussions)

## 🙏 Acknowledgments

- Built with Node.js, React, and PostgreSQL
- Inspired by the need for centralized hardware monitoring
- Thanks to the open source community

---

**Made with ❤️ for the self-hosting community**
