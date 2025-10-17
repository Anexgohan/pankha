# Pankha Project Status

## Project Overview
Production-ready multi-system fan control and temperature monitoring with agent-based architecture, real-time WebSocket communication, and PostgreSQL database.

## ✅ Production Status - FULLY OPERATIONAL

### Live Deployment
- **Backend**: http://192.168.100.237:3000 (Docker + PostgreSQL + nginx)
- **Frontend**: React SPA with real-time dashboard
- **Database**: PostgreSQL 17 with time-series optimization
- **Active Agents**: 1 production Linux agent (192.168.100.199 - pve-shadow)
- **Real Hardware**: 25 sensors + 5 PWM fans on AMD Ryzen 9 3900X

### Development Environment
- **Server**: Linux 192.168.100.237

**Private Development Repository (pankha-dev):**
- **Directory**: `/root/anex/dev/pankha-dev/`
- **GitHub**: https://github.com/Anexgohan/pankha-dev (private)
- **Purpose**: Active development, experimental features, testing
- **Docker**: Builds locally from `docker/Dockerfile`
- **Containers**: `pankha-dev-app-1`, `pankha-dev-postgres-1`

**Public Community Repository (pankha):**
- **Directory**: `/root/anex/dev/pankha/`
- **GitHub**: https://github.com/Anexgohan/pankha (public, open source)
- **Purpose**: Stable releases for end users
- **Docker**: Pulls pre-built `anexgohan/pankha:latest` from Docker Hub
- **Containers**: `pankha-app-1`, `pankha-postgres-1`

**System:**
- **Node.js**: v20.19.4
- **Database**: PostgreSQL 17

**Note**: Both repositories may have the same code after a release, but serve different purposes and use different Docker configurations.

## ✅ Completed Implementation

### Core System (Production Ready)
- ✅ **Backend**: Express + TypeScript + WebSocket hub + PostgreSQL
- ✅ **Frontend**: React + TypeScript + Vite + real-time dashboard
- ✅ **Linux Agent**: Production Python agent with hardware integration
- ✅ **WebSocket Communication**: Real-time bidirectional data (3-second intervals)
- ✅ **Docker Deployment**: Multi-stage build with nginx reverse proxy
- ✅ **Database**: Full PostgreSQL schema with time-series data storage

### Real Hardware Integration
- ✅ **Sensor Discovery**: Automatic detection of 25+ temperature sensors
- ✅ **Fan Control**: PWM control of 5 hardware fans with RPM feedback
- ✅ **Sensor Types**: CPU (k10temp), Motherboard (it8628), NVMe, ACPI, WMI
- ✅ **Data Persistence**: Historical sensor/fan data in PostgreSQL
- ✅ **Live Monitoring**: Real-time temperature and fan speed updates

### Production Agent (192.168.100.199)
- **System**: AMD Ryzen 9 3900X (Debian 12)
- **Sensors**: 25 temperature sensors (k10temp, it8628, nvme, acpitz, gigabyte_wmi)
- **Fans**: 5 PWM fans (it8628 chipset with hardware control)
- **Communication**: WebSocket to backend at 192.168.100.237:3000
- **Status**: Online and transmitting live data
- **Performance**: <50MB memory, <1% CPU usage

## Technical Stack

### Frontend
- React 18 + TypeScript + Vite
- Real-time WebSocket updates
- Dashboard with system monitoring
- Fan control interface

### Backend
- Node.js 20 + Express + TypeScript
- WebSocket hub for agent communication
- PostgreSQL database with connection pooling
- RESTful API endpoints

### Agents
- Python 3 with websockets library
- Direct hardware access via /sys/class/hwmon
- Automatic sensor/fan discovery
- PWM fan control (0-255 range)

### Infrastructure
- Docker multi-stage builds
- nginx reverse proxy
- PostgreSQL 17 (Alpine container)
- GitHub-based deployment workflow

## Deployment Workflow

### Development
```bash
# Full stack development (starts both services)
npm run dev

# This starts:
# - Frontend: http://192.168.100.237:5173/ (Vite dev server)
# - Backend: http://192.168.100.237:3000/ (API + WebSocket)

# Or start individual services:
npm run dev:frontend  # Frontend only on port 5173
npm run dev:backend   # Backend only on port 3000
```

### Production Deployment
```bash
# On production server (192.168.100.237)
cd /root/anex/dev/pankha
git pull origin main
docker compose build --no-cache
docker compose up -d

# Verify deployment
curl http://192.168.100.237:3000/health
```

### Agent Deployment
```bash
# Deploy to target system
scp -r agents/clients/linux/debian/ root@TARGET_IP:/opt/pankha-agent/

# On target system
ssh root@TARGET_IP
cd /opt/pankha-agent
apt install -y python3-websockets  # Install dependency
./pankha-agent.sh setup             # Interactive configuration
./pankha-agent.sh start             # Start hardware monitoring
```

## API Endpoints

### Core Endpoints
- `GET /health` - Backend health and statistics
- `GET /api/systems` - List all registered agents
- `GET /api/overview` - System overview statistics
- `GET /api/systems/:id` - Specific system details
- `PUT /api/systems/:id/fans/:fanId` - Control fan speed
- `POST /api/emergency-stop` - Emergency fan control

### WebSocket
- Endpoint: `ws://192.168.100.237:3000/websocket`
- Protocol: Bidirectional JSON messages
- Agent data: Every 3 seconds
- Commands: Fan control, emergency stop

## Performance Metrics

### System Performance
- **Agent Memory**: <50MB per agent
- **Agent CPU**: <1% during normal operation
- **Network**: ~1KB/s per agent (3-second intervals)
- **Response Times**:
  - Fan control: <500ms hardware response
  - Temperature updates: 3-second intervals
  - WebSocket latency: <50ms

### Database
- **Connection Pool**: 20 max connections
- **Data Retention**: 30 days (configurable)
- **Storage Rate**: ~380 records/minute per agent
- **Query Performance**: Indexed time-series queries

## Current Focus

### Completed Features
- ✅ Full WebSocket agent-backend communication
- ✅ Real hardware monitoring and fan control
- ✅ PostgreSQL database with time-series data
- ✅ Production deployment on real hardware
- ✅ Dashboard with real-time updates

### In Development
- 🚧 Fan profile management and curves
- 🚧 Advanced dashboard features
- 🚧 Multi-system management UI
- 🚧 Alert and notification system

### Future Enhancements
- Windows agent support
- Mobile responsive UI improvements
- Advanced analytics and trends
- Profile scheduling and automation

## Documentation

### Available Guides
- **[ARCHITECTURE.md](../project/ARCHITECTURE.md)**: System architecture and design
- **[AGENT-DEPLOYMENT.md](../project/AGENT-DEPLOYMENT.md)**: Agent deployment guide
- **[USER-WORKFLOWS.md](../project/USER-WORKFLOWS.md)**: User interface workflows
- **[PostgreSQL Guide](../backend/database/postgresql-guide.md)**: Database documentation
- **[Setup Guide](../client/setup-guide.md)**: Linux agent installation
- **[Testing Guide](../guides/TESTING-GUIDE.md)**: System testing procedures

## Project Status Summary

**Status**: ✅ **PRODUCTION OPERATIONAL**
**Last Updated**: 2025-10-03
**Active Deployment**: 1 Linux agent with 25 sensors + 5 fans
**Next Milestone**: Advanced dashboard features and fan profile management
**License**: AGPL-3.0
