# Pankha - Multi-System Fan Control and Temperature Monitoring

## Project Overview
A self-hosted Docker application for monitoring and controlling fan speeds across multiple systems/machines. Features dynamic sensor detection, real-time temperature monitoring, and user-configurable fan-to-sensor mappings through a modern web interface.

## Core Functionality

### 🌡️ Temperature Monitoring
- **Multi-System Support**: Monitor multiple machines simultaneously
- **Dynamic Sensor Detection**: Automatically discover all available temperature sensors
- **Sensor Categorization**: CPU, GPU, motherboard, NVMe, ACPI sensors
- **Real-Time Data**: Live temperature readings with <1 second latency
- **Historical Tracking**: Store and visualize temperature trends over time

### 🎛️ Fan Control System
- **Hardware-Agnostic**: Works with any Linux system with PWM fan controls
- **Safety-First**: Emergency shutoffs and temperature-based protection
- **Multiple Profiles**: Silent, balanced, performance, and custom cooling profiles
- **Fine-Grained Control**: Individual fan speed adjustments
- **Response Time**: Fan commands execute within 500ms

### 🔧 User-Configurable Sensor Assignment
- **Flexible Mapping**: Each fan can monitor multiple temperature sources
- **Logic Options**: Choose how multiple sensors affect fan speed (max, average, primary-only)
- **Real-Time Updates**: Changes take effect immediately without restart
- **Visual Interface**: GUI shows which sensors control which fans

### 🖥️ Web-Based Dashboard
- **System Overview**: Multi-system status grid with health indicators
- **Detailed Views**: Individual system monitoring and control
- **Configuration Wizard**: Step-by-step setup for new systems
- **Mobile Responsive**: Full functionality on desktop and mobile devices

## Architecture

### Agent-Based Design
```
Browser ←WebSocket→ Main Server ←HTTP/WS→ Local Agents ←Direct→ Hardware
```

- **Local Agents**: Lightweight services running on each monitored system
- **Direct Hardware Access**: No SSH latency, immediate sensor/fan control
- **Resilient Communication**: Agents continue working during network interruptions
- **Auto-Discovery**: Network scanning to find and register new agents

### Tech Stack

#### Frontend
- **Framework**: React with TypeScript
- **Build Tool**: Vite for fast development and building
- **UI Components**: Modern responsive design with real-time updates
- **State Management**: React Query + Context for real-time data
- **Charts**: Temperature and fan speed visualization

#### Backend (Main Server)
- **Runtime**: Node.js with TypeScript
- **Framework**: Express for REST APIs
- **Real-Time**: WebSocket hub for live data streaming
- **Authentication**: Token-based agent authentication
- **Database**: PostgreSQL for production scalability and time-series performance

#### Local Agents
- **Language**: Python/Go for hardware access
- **Communication**: HTTP + WebSocket APIs
- **Hardware Interface**: Direct sysfs and sensors integration
- **Safety Systems**: Local emergency responses and validation

#### Infrastructure
- **Containerization**: Multi-stage Docker build
- **Reverse Proxy**: nginx for static files and API routing
- **Orchestration**: Docker Compose with health checks
- **Data Persistence**: Volume mounts for configuration and historical data

## Project Structure
```
pankha/
├── frontend/                 # React + TypeScript web interface
├── backend/                  # Node.js main server
├── agents/                   # Local agent implementations
│   ├── python/              # Python agent for Linux systems
│   └── installer/           # Agent deployment scripts
├── docker/                  # Docker configuration
│   ├── Dockerfile           # Multi-stage build
│   ├── nginx.conf           # Reverse proxy config
│   └── scripts/             # Container startup scripts
├── samples/                 # Reference implementations
│   └── fan-control/         # Original fan control sample
├── documentation/           # Project documentation
│   ├── tasks-todo/          # Development tasks
│   ├── backend/             # Backend-specific docs
│   └── api/                 # API documentation
├── docker-compose.yml       # Container orchestration
└── package.json             # Workspace configuration
```

## Key Features

### Dynamic Sensor Detection
- **Auto-Discovery**: Scan and detect all available temperature sensors
- **Hardware Identification**: Automatic sensor chip recognition
- **Sensor Testing**: Validate sensor accessibility and accuracy
- **Categorization**: Group sensors by type (CPU, GPU, motherboard, etc.)
- **Live Status**: Monitor sensor health and availability

### Flexible Fan-to-Sensor Mapping
- **Primary/Secondary Sensors**: Each fan can monitor multiple temperature sources
- **Configurable Logic**: Choose how multiple sensors affect fan speed
- **Real-Time Assignment**: Change sensor mappings without system restart
- **Visual Configuration**: Drag-and-drop sensor assignment interface
- **Profile-Based**: Save and switch between different mapping configurations

### System Configuration Wizard
1. **Agent Detection**: Automatically find and connect to agents
2. **Sensor Discovery**: Scan and display all available sensors
3. **Sensor Categorization**: Group by hardware type
4. **Fan Testing**: Safely test fan controls and limits
5. **Assignment Configuration**: Set up sensor-to-fan mappings
6. **Profile Creation**: Save configuration as named profiles

### Real-Time Monitoring Dashboard
- **Multi-Sensor Display**: Show temperatures from all configured sensors
- **Fan-Sensor Relationships**: Visual indicators showing control relationships
- **Temperature Alerts**: Warnings when sensors exceed thresholds
- **Sensor Health Status**: Indicators for non-responsive sensors
- **Historical Charts**: Temperature and fan speed trends over time

### Safety & Security
- **Emergency Shutoffs**: Automatic full-speed activation at critical temperatures
- **Hardware Protection**: Prevent invalid fan speeds and sensor damage
- **Secure Communication**: Token-based authentication between agents and server
- **Input Validation**: Comprehensive validation of all hardware commands
- **Audit Logging**: Track all system modifications and commands

## Getting Started

### Development Environment
**Development Setup:**
- **Development Server:** Linux server at 192.168.100.237
- **Development Directory:** `/root/anex/dev/pankha-dev` (private repo)
- **Production Directory:** `/root/anex/dev/pankha` (public repo)
- **Database:** PostgreSQL for both development and production

**Development Options:**

1. **Full Stack Development:**
   - **Backend:** HTTP API on port 3003, WebSocket on port 3004
   - **Frontend:** Development server on port 5173
   - **Use case:** Complete isolation for backend development

2. **Frontend Development (Docker Integration):**
   - **Backend:** Uses Docker backend on port 3000
   - **Frontend:** Development server on port 5173
   - **Use case:** Frontend development with real agent data

**Docker Differences:**
- **pankha-dev**: Builds locally from `docker/Dockerfile`
- **pankha**: Pulls pre-built `anexgohan/pankha:latest` from Docker Hub

```bash
# Install dependencies
npm install

# Option 1: Full stack development
npm run dev

# Option 2: Frontend only (requires Docker backend running)
docker compose up -d
npm run dev:frontend

# Backend only
npm run dev:backend

# Build for production
npm run build
```

### Production Deployment
**Linux Docker Machine (192.168.100.237):**
- **Working Directory:** `/root/anex/dev/pankha/` (public repo)
- **Git Repository:** https://github.com/Anexgohan/pankha (public, open source)
- **Docker Container:** `pankha-app-1` running on port 3000
- **Docker Image:** `anexgohan/pankha:latest` (pre-built from Docker Hub)
- **Service Health:** Available at http://192.168.100.237:3000

**Deployment Workflow:**
1. **Development:** Code in `/root/anex/dev/pankha-dev/` (private repo)
2. **Test:** Verify Docker build locally
3. **Build & Push:** Build and push Docker image to Docker Hub
4. **Deploy:** Pull latest image and restart services in production repo

```bash
# On Linux machine - Deploy latest stable release
cd /root/anex/dev/pankha
git pull origin main
docker compose pull  # Pull latest anexgohan/pankha:latest
docker compose up -d

# Verify deployment
docker compose ps
curl http://localhost:3000/health

# Access web interface
http://192.168.100.237:3000
```

### Agent Installation
```bash
# On target system (Linux)
curl -sSL http://main-server:3000/install-agent.sh | bash

# Manual installation
wget http://main-server:3000/agent.tar.gz
tar -xzf agent.tar.gz
cd pankha-agent
sudo ./install.sh
```

## Configuration

### Environment Variables
```bash
# Main Server
PORT=3000
DATABASE_URL=sqlite:./data/app.db
JWT_SECRET=your-secret-key

# Agent Configuration
AGENT_PORT=8080
AGENT_WS_PORT=8081
MAIN_SERVER_URL=http://main-server:3000
AGENT_AUTH_TOKEN=auto-generated
```

### Adding New Systems
1. Deploy agent to target system
2. Agent auto-registers with main server
3. Configure sensors and fans through web interface
4. Test and validate configuration
5. Save as system profile

## Performance Characteristics
- **Real-Time Updates**: Temperature data every 1-3 seconds
- **Command Response**: Fan control within 500ms
- **Multi-System**: Support for 10+ concurrent systems
- **Agent Uptime**: 99%+ connection reliability
- **Emergency Response**: Safety systems activate within 100ms

## Development Roadmap
- **Phase 1**: Core fan control system implementation (Task 01)
- **Phase 2**: Advanced fan curve management and profiles
- **Phase 3**: Alerting and notification system
- **Phase 4**: Performance analytics and optimization
- **Phase 5**: Mobile application development

## Security Considerations
- Agent-to-server communication encryption
- Hardware command validation and rate limiting
- Secure agent deployment and updates
- Audit trails for all system modifications
- Network isolation and access controls

---

**Target Use Cases**: Home labs, server rooms, workstations, gaming rigs  
**Supported Systems**: Linux systems with lm-sensors and PWM fan support  
**Deployment**: Self-hosted via Docker with web-based management