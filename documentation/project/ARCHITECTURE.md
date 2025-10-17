# Pankha System Architecture

## Overview

Pankha is a distributed fan control system that allows centralized monitoring and control of hardware cooling across multiple machines. The system consists of three main components: **Agents**, **Backend**, and **Frontend**, working together to provide real-time hardware monitoring and intelligent fan control.

## System Components

### 1. **Central Backend (Docker Container)**
- **Purpose**: Data aggregation, command dispatch, and API services
- **Location**: Single Docker host (production deployment)
- **Technologies**: Node.js, TypeScript, PostgreSQL, WebSocket
- **Services**:
  - RESTful API server (Express.js)
  - WebSocket hub for real-time communication
  - PostgreSQL database for persistent storage
  - Agent management and health monitoring
  - Fan profile management
  - Command dispatching system

### 2. **Distributed Agents**
- **Purpose**: Local hardware monitoring and control
- **Location**: Any machine with cooling hardware (Linux primary, Windows future)
- **Technologies**: Python, `websockets` library, asyncio
- **Functions**:
  - Temperature sensor monitoring
  - Fan speed control via PWM
  - Real-time data transmission
  - Command execution from backend
  - Hardware capability discovery

### 3. **Web Frontend**
- **Purpose**: User interface for monitoring and control
- **Location**: Served by nginx from same Docker container as backend
- **Technologies**: React, TypeScript, WebSocket client
- **Features**:
  - Real-time system dashboards
  - Fan curve editor and profile management
  - Multi-system overview
  - Emergency controls
  - Historical data visualization

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        PANKHA SYSTEM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────┐ │
│  │   Agent 1       │    │   Agent 2        │    │   Agent N   │ │
│  │   (Windows)     │    │   (Linux)        │    │   (Any OS)  │ │
│  │                 │    │                  │    │             │ │
│  │ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────┐ │ │
│  │ │ Sensors     │ │    │ │ Sensors      │ │    │ │ Sensors │ │ │
│  │ │ • CPU Temp  │ │    │ │ • GPU Temp   │ │    │ │ • ...   │ │ │
│  │ │ • GPU Temp  │ │    │ │ • Mobo Temp  │ │    │ │         │ │ │
│  │ │ • ...       │ │    │ │ • ...        │ │    │ │         │ │ │
│  │ └─────────────┘ │    │ └──────────────┘ │    │ └─────────┘ │ │
│  │                 │    │                  │    │             │ │
│  │ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────┐ │ │
│  │ │ Fans        │ │    │ │ Fans         │ │    │ │ Fans    │ │ │
│  │ │ • CPU Fan   │ │    │ │ • Case Fan 1 │ │    │ │ • ...   │ │ │
│  │ │ • Case Fans │ │    │ │ • Case Fan 2 │ │    │ │         │ │ │
│  │ │ • ...       │ │    │ │ • ...        │ │    │ │         │ │ │
│  │ └─────────────┘ │    │ └──────────────┘ │    │ └─────────┘ │ │
│  └─────────────────┘    └──────────────────┘    └─────────────┘ │
│           │                       │                      │      │
│           │ WebSocket             │ WebSocket            │      │
│           │ (Real-time)           │ (Real-time)          │      │
│           ▼                       ▼                      ▼      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    CENTRAL BACKEND                           │ │
│  │                   (Docker Container)                         │ │
│  │                                                              │ │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌────────────────┐ │ │
│  │  │ WebSocket Hub  │  │ API Server      │  │ Database       │ │ │
│  │  │ • Real-time    │  │ • REST API      │  │ • PostgreSQL   │ │ │
│  │  │   communication│  │ • Agent mgmt    │  │ • Systems      │ │ │
│  │  │ • Agent conns  │  │ • Fan profiles  │  │ • Sensors      │ │ │
│  │  │ • Command      │  │ • Health checks │  │ • Fan profiles │ │ │
│  │  │   dispatching  │  │                 │  │ • History      │ │ │
│  │  └────────────────┘  └─────────────────┘  └────────────────┘ │ │
│  │                                                              │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │                   NGINX PROXY                           │ │ │
│  │  │  • Serves React frontend (port 3000)                   │ │ │
│  │  │  • Proxies API requests to backend (port 3000)         │ │ │
│  │  │  • Proxies WebSocket to WebSocket server (port 3000)   │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                    │                               │
│                                    │ HTTP/WebSocket                │
│                                    ▼                               │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                      WEB FRONTEND                            │ │
│  │                   (React Application)                        │ │
│  │                                                              │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │
│  │  │ Dashboard   │  │ Fan Control │  │ System Management   │  │ │
│  │  │ • Live data │  │ • Profiles  │  │ • Multi-system view │  │ │
│  │  │ • Charts    │  │ • Curves    │  │ • Agent status      │  │ │
│  │  │ • Alerts    │  │ • Manual    │  │ • Health monitoring │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                    ▲                               │
│                                    │                               │
│                              User Browser                          │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. **Agent → Backend (Sensor Data)**
```
Agent Hardware → Agent Process → WebSocket → Backend → Database
```
- **Frequency**: Every 3 seconds
- **Data**: Raw temperature readings, fan speeds, hardware metadata (no processed status)
- **Processing**: Server calculates temperature status from raw values
- **Protocol**: JSON over WebSocket

### 2. **Backend → Agent (Commands)**
```
User Action → Frontend → Backend API → WebSocket → Agent → Hardware
```
- **Triggers**: User adjustments, profile changes, emergency stops
- **Commands**: Set fan speed, apply profile, emergency stop
- **Protocol**: JSON over WebSocket

### 3. **Frontend ↔ Backend (User Interface)**
```
Browser ↔ Nginx ↔ Backend API ↔ Database
Browser ↔ Nginx ↔ WebSocket Hub ↔ Agents
```
- **API Calls**: System data, profile management
- **Real-time**: Live sensor data via WebSocket

## Communication Protocols

### WebSocket Messages (Agent ↔ Backend)

**Agent Data Transmission (Raw Data Only):**
```json
{
  "type": "data",
  "data": {
    "agentId": "mock-client-01",
    "timestamp": "2025-09-01T15:00:00.000Z",
    "sensors": [
      {
        "id": "cpu_temp",
        "temperature": 67.2,
        "type": "cpu",
        "max_temp": 85,
        "crit_temp": 95
      }
    ],
    "fans": [
      {
        "id": "cpu_fan",
        "speed": 35,
        "rpm": 850,
        "targetSpeed": 35,
        "status": "ok"
      }
    ],
    "systemHealth": {
      "cpuUsage": 25.3,
      "memoryUsage": 45.2,
      "agentUptime": 3600
    }
  }
}
```

**Server Processing:**
```typescript
// Backend calculates temperature status from raw sensor data
if (temp >= critTemp) status = 'critical';
else if (temp >= 70) status = 'warning';  
else if (temp >= 60) status = 'caution';
else status = 'ok';
```

**Backend Commands:**
```json
{
  "type": "command",
  "data": {
    "command": "set_fan_speed",
    "fanId": "cpu_fan",
    "speed": 50,
    "priority": "user"
  }
}
```

### REST API Endpoints

- `GET /api/systems` - List all registered systems
- `GET /api/systems/{id}` - Get specific system details
- `GET /api/overview` - System overview and statistics
- `POST /api/systems/{id}/fans/{fanId}` - Set fan speed
- `GET /api/fan-profiles` - Fan profile management
- `GET /health` - Backend health check

## Frontend Configuration

### Production vs Development Configuration Differences

**Development Environment (Option 1 - Standalone Dev Stack):**
- API endpoints: `http://localhost:3000` (unified dev backend)
- WebSocket: `ws://localhost:3000` (unified with API)
- Served by: Vite dev server on port 5173
- Build: Hot module replacement, source maps
- Use case: Full stack development with separate backend

**Development Environment (Option 2 - Docker Backend Integration):**
- API endpoints: `http://192.168.100.237:3000` (uses Docker backend)
- WebSocket: `ws://192.168.100.237:3000` (uses Docker WebSocket)
- Served by: Vite dev server on port 5173
- Build: Hot module replacement, source maps
- Use case: Frontend development with shared production data

**Production Environment:**
- API endpoints: Relative URLs (empty base URL)
- WebSocket: `/websocket` (proxied by nginx)
- Served by: nginx on port 3000
- Build: Optimized, minified, cached assets

**Note:** The development frontend can be configured to use either the development backend (port 3000) or the Docker backend (port 3000) depending on development needs. Both use unified port 3000 for API and WebSocket. Using Docker backend allows frontend development with real agent data.

### Frontend Build Process Integration with Docker

The Docker build process integrates frontend compilation:

```dockerfile
# Build stage
FROM node:20-alpine as builder
WORKDIR /app
COPY frontend/ ./frontend/
COPY backend/ ./backend/
RUN npm run build  # Builds both frontend and backend

# Production stage  
FROM node:20-alpine as production
COPY --from=builder /app/frontend/dist ./frontend/  # Copy built frontend
COPY docker/nginx.conf /etc/nginx/nginx.conf       # nginx serves frontend
```

**Build Output:**
- Frontend assets: `/app/frontend/` (served by nginx)
- Filename hashing: `index-[hash].js` for cache busting
- nginx proxy: Routes `/api/*` to backend, serves static files for `/`

## Deployment Architecture

### Repository Structure
Pankha uses a two-repository architecture:

- **pankha-dev** (https://github.com/Anexgohan/pankha-dev - private)
  - Active development and testing
  - Builds Docker images locally from `docker/Dockerfile`
  - Located at `/root/anex/dev/pankha-dev/`

- **pankha** (https://github.com/Anexgohan/pankha - public, open source)
  - Stable community releases
  - Uses pre-built Docker images from Docker Hub (`anexgohan/pankha:latest`)
  - Located at `/root/anex/dev/pankha/`

### Production Environment
```
┌──────────────────────────────────────────┐
│         Docker Host (Linux)              │
│         192.168.100.237                  │
│                                          │
│  Two Repositories:                       │
│  • pankha-dev: Builds from Dockerfile    │
│  • pankha: Pulls Docker Hub image        │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │        Docker Container            │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │         Nginx                │  │  │
│  │  │  • Port 3000 (external)     │  │  │
│  │  │  • Serves React frontend    │  │  │
│  │  │  • Proxies to backend       │  │  │
│  │  └──────────────────────────────┘  │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │       Backend Services       │  │  │
│  │  │  • API Server (port 3000)   │  │  │
│  │  │  • WebSocket (port 3000)    │  │  │
│  │  │  • PostgreSQL Database      │  │  │
│  │  └──────────────────────────────┘  │  │
│  │                                    │  │
│  │  Port Configuration:               │  │
│  │  • External: 3000 (nginx proxy)   │  │
│  │  • Internal: 3000 (unified)       │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
              ▲
              │
         Port 3000
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼────┐        ┌─────▼─────┐
│Agent 1 │   ...  │ Agent N   │
│(Any OS)│        │ (Any OS)  │
└────────┘        └───────────┘
```

### Development Environment

#### Option 1: Standalone Development Stack (pankha-dev)
```
┌─────────────────────────────────────────┐
│      Linux Development Server          │
│           192.168.100.237               │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │  Private Dev Repo (pankha-dev)      ││
│  │    /root/anex/dev/pankha-dev        ││
│  │                                     ││
│  │  Backend:  http://localhost:3000    ││
│  │  WebSocket: ws://localhost:3000     ││
│  │  Frontend: http://localhost:5173    ││
│  │  Docker: Builds from Dockerfile     ││
│  │                                     ││
│  │  Use case: Full stack development   ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

#### Option 2: Docker Backend Integration (pankha-dev)
```
┌─────────────────────────────────────────┐
│      Linux Development Server          │
│           192.168.100.237               │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │  Private Dev Repo (pankha-dev)      ││
│  │    /root/anex/dev/pankha-dev        ││
│  │                                     ││
│  │  Frontend: http://192.168.100.237:5173││
│  │      ↓ (connects to)                ││
│  │  Docker Backend: :3000              ││
│  │  Docker: Builds from local source   ││
│  │  Real Agents: Connected to Docker   ││
│  │                                     ││
│  │  Use case: Frontend dev + real data ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

## Scalability

### Horizontal Scaling
- **Agents**: Unlimited agents can connect to single backend
- **Systems**: Each agent can monitor multiple systems
- **Geographic Distribution**: Agents can be deployed globally

### Vertical Scaling
- **Backend**: Single container handles 100+ concurrent agents
- **Database**: PostgreSQL optimized for concurrent connections and time-series data
- **Future Scaling**: Can add MQTT messaging layer when scale demands (>100 agents)

## Security Considerations

### Agent Authentication
- **Token-based**: Each agent has unique authentication token
- **Registration**: Agents must register before sending data
- **Validation**: Backend validates all incoming data

### Network Security
- **WebSocket**: Secure WebSocket (WSS) recommended for production
- **Firewall**: Restrict backend port access to known agent IPs
- **SSL/TLS**: HTTPS recommended for frontend access

### Data Integrity
- **Validation**: All sensor data validated before storage
- **Safety Limits**: Fan speed limits prevent hardware damage
- **Emergency Stop**: Global emergency stop available

## Monitoring and Maintenance

### Health Monitoring
- **Agent Health**: Backend tracks agent connection status
- **System Health**: Regular health checks and alerts
- **Performance**: WebSocket connection monitoring

### Data Retention
- **Sensor Data**: Configurable retention period
- **System Events**: Permanent event logging
- **Performance Metrics**: Statistical aggregation

### Backup and Recovery
- **Database**: Regular PostgreSQL backup with pg_dump
- **Configuration**: Fan profiles and system settings
- **Agent Config**: Local agent configuration files

## Operational Procedures

### Agent Reconnection After Backend Restart

When the backend container is restarted, agents may lose connection and show `real_time_status: "error"`.

**Diagnosis Steps:**
1. **Verify backend health:**
   ```bash
   curl http://192.168.100.237:3000/health
   ```

2. **Check agent connections:**
   ```bash
   curl http://192.168.100.237:3000/api/systems
   ```
   Look for: `"real_time_status": "error"` and old `"last_data_received"` timestamps

3. **Check frontend symptoms:**
   - Dashboard shows "No real-time data available"
   - System cards show 0 sensors/fans despite having capabilities
   - WebSocket connection errors in browser console

**Resolution:**
1. **Restart disconnected agents** on their respective machines
2. **Verify reconnection** - agents should show `"real_time_status": "online"`
3. **Confirm data flow** in frontend dashboard within 3-10 seconds

**Prevention:**
- Use process managers (systemd, PM2) to auto-restart agents
- Implement agent health monitoring and auto-recovery

### Multi-Machine Development and Deployment Workflow

**Development Workflow:**

1. **Development (pankha-dev - private repo):**
   ```bash
   # Clone development repository
   git clone https://github.com/Anexgohan/pankha-dev.git
   cd pankha-dev
   npm install

   # Make changes and test
   npm run dev

   # Test Docker build
   docker compose build --no-cache
   docker compose up -d

   # Commit and push
   git add .
   git commit -m "Description of changes"
   git push origin main
   ```

2. **Build and Push Docker Image (for public release):**
   ```bash
   # Build production image
   docker build -t anexgohan/pankha:latest -f docker/Dockerfile .

   # Push to Docker Hub
   docker push anexgohan/pankha:latest
   ```

3. **Deploy to Production (pankha - public repo):**
   ```bash
   # SSH to production server
   ssh root@192.168.100.237

   # Update from GitHub and pull Docker image
   cd /root/anex/dev/pankha
   git pull origin main
   docker compose pull  # Pull latest anexgohan/pankha:latest
   docker compose up -d
   ```

3. **Verification:**
   ```bash
   # Check container status
   docker compose ps
   
   # Verify backend health
   curl http://192.168.100.237:3000/health
   
   # Check build artifacts
   docker exec pankha-app-1 ls -la /app/frontend/assets/
   ```

4. **Frontend Verification:**
   - Open new browser tab to bypass cache
   - Check browser console for new JavaScript filenames (e.g., `index-[newhash].js`)
   - Verify WebSocket connection and real-time data

**Troubleshooting Deployment:**
- **Frontend not updating:** Check Docker build logs for new asset hashes
- **Browser cache issues:** Hard refresh (Ctrl+Shift+R) or use incognito mode
- **Agent disconnections:** Restart agents after backend deployment

## Future Enhancements

### Planned Features
- **Mobile App**: Native mobile application
- **Advanced Analytics**: ML-based thermal optimization
- **Cloud Integration**: Cloud-based deployment option
- **Hardware Expansion**: Support for additional sensor types

### API Evolution
- **GraphQL**: Consider GraphQL for complex queries
- **REST v2**: Enhanced REST API with pagination
- **Webhook Support**: External system integration

---

*This architecture enables distributed hardware monitoring with centralized control, providing scalable and maintainable fan control across multiple systems.*