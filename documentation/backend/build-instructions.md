# Backend Build Instructions

## Overview
The Pankha backend is a comprehensive Node.js + Express API built with TypeScript, featuring real-time WebSocket communication, PostgreSQL database, and multi-agent system management. This document covers local development, building, and deployment processes.

## Prerequisites
- Node.js 20+ (required for production builds)
- npm (comes with Node.js)
- TypeScript (installed as dev dependency)
- PostgreSQL (for database functionality)

## Project Structure
```
backend/
├── src/
│   ├── index.ts              # Main application entry point
│   ├── database/
│   │   ├── database.ts       # PostgreSQL database connection
│   │   └── schema.sql        # Database schema
│   ├── services/
│   │   ├── AgentManager.ts   # Agent registration and status management
│   │   ├── AgentCommunication.ts  # Agent message handling
│   │   ├── DataAggregator.ts # Real-time data processing
│   │   ├── CommandDispatcher.ts   # Fan control commands
│   │   └── WebSocketHub.ts   # WebSocket server management
│   ├── routes/
│   │   ├── systems.ts        # System management API
│   │   └── discovery.ts      # Agent discovery endpoints
│   └── types/
│       └── agent.ts          # TypeScript type definitions
├── data/                     # Application data and logs
├── dist/                     # Compiled JavaScript output (generated)
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
└── .env.example              # Environment variables template
```

## Development Setup

### 1. Install Dependencies
```bash
# From project root
cd backend
npm install
```

### 2. Development Server
```bash
# Start development server with hot reload
npm run dev

# Or from project root
npm run dev:backend
```

The development server runs on configurable ports (default HTTP: 3003, WebSocket: 3004) with automatic restart on file changes. Port configuration is handled via environment variables and may vary by environment.

### 3. Available Scripts
```bash
npm run dev        # Start development server with ts-node
npm run build      # Compile TypeScript to JavaScript
npm start          # Run compiled JavaScript (production)
npm run typecheck  # Type checking without compilation
npm run lint       # Code linting (placeholder)
```

## Building for Production

### 1. Compile TypeScript
```bash
npm run build
```

This generates compiled JavaScript files in the `dist/` directory:
- `dist/index.js` - Main application
- `dist/index.d.ts` - Type declarations
- `dist/*.map` - Source maps

### 2. Production Dependencies
Only production dependencies are needed for runtime:
```bash
npm ci --only=production
```

### 3. Start Production Server
```bash
npm start
```

## Docker Build Process

### Multi-Stage Build
The backend is built using Docker's multi-stage build process:

1. **Builder Stage** (`node:20-alpine`)
   - Copies source code and package files
   - Installs all dependencies (dev + production)
   - Compiles TypeScript with `npm run build`

2. **Production Stage** (`node:20-alpine`)
   - Copies compiled `dist/` contents to `/app/backend/`
   - Copies `package.json` for runtime dependencies
   - Installs only production dependencies
   - Sets up nginx and startup scripts

### File Mapping in Container
```
Build Output:     Container Location:
backend/dist/ --> /app/backend/
backend/package.json --> /app/backend/package.json
```

**Important**: In the container, compiled files are placed directly in `/app/backend/` (not in a `dist/` subdirectory).

## Configuration

### Environment Variables
```bash
# Server Configuration (ports are configurable)
PORT=3003                    # HTTP API port (default: 3003)
WS_PORT=3004                 # WebSocket port (default: 3004)
NODE_ENV=development         # Environment mode

# Database Configuration
DATABASE_URL=postgresql://user:pass@localhost:5432/pankha  # PostgreSQL connection string

# Optional Configuration
LOG_LEVEL=info               # Logging level
CORS_ORIGIN=*                # CORS allowed origins
```

**Note**: All ports are configurable and may vary by environment. Check current configuration in `.env` file or environment variables.

### TypeScript Configuration
Key settings in `tsconfig.json`:
- **Target**: ES2020
- **Module**: CommonJS
- **Output**: `./dist/`
- **Source**: `./src/`
- **Strict**: Enabled for type safety

## API Endpoints

### Health Check
```
GET /health
Response: {
  "status": "ok",
  "timestamp": "2025-08-03T06:05:07.700Z",
  "service": "pankha-backend",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "agent_manager": "active",
    "websocket_hub": "active"
  },
  "statistics": {
    "total_agents": 0,
    "agent_statuses": {"online": 0, "offline": 0, "error": 0},
    "websocket_clients": 1,
    "pending_commands": 0
  }
}
```

### System Management
```
GET /api/systems              # List all registered systems
GET /api/systems/:id          # Get specific system details
DELETE /api/systems/:id       # Remove system from database
GET /api/systems/:id/sensors  # Get system sensor data
GET /api/systems/:id/fans     # Get system fan data
PUT /api/systems/:id/fans/:fanId  # Control fan speed
```

### System Overview
```
GET /api/overview
Response: {
  "totalSystems": 1,
  "onlineSystems": 1,
  "offlineSystems": 0,
  "totalSensors": 5,
  "totalFans": 3,
  "avgTemperature": 38.4,
  "highestTemperature": 47.0,
  "websocket_stats": {...}
}
```

### Agent Discovery
```
GET /api/discover/scan        # Scan network for agents
POST /api/emergency-stop      # Emergency fan control stop
```

## Development Workflow

### 1. Make Changes
Edit files in `src/` directory

### 2. Test Locally
```bash
npm run dev  # Starts with hot reload
```

### 3. Type Check
```bash
npm run typecheck  # Verify types without building
```

### 4. Build and Test
```bash
npm run build  # Compile TypeScript
npm start      # Test production build
```

### 5. Deploy

#### Development (pankha-dev - Private Repo)
```bash
git add .
git commit -m "Backend changes"
git push origin main  # Push to private development repo

# Test Docker build
cd /root/anex/dev/pankha-dev
docker compose build --no-cache
docker compose up -d
```

#### Production (pankha - Public Repo)
```bash
# Build and push Docker image to Docker Hub
docker build -t anexgohan/pankha:latest -f docker/Dockerfile .
docker push anexgohan/pankha:latest

# Deploy on production server
cd /root/anex/dev/pankha
git pull origin main
docker compose pull  # Pull latest anexgohan/pankha:latest
docker compose up -d
```

## Troubleshooting

### Common Issues

**1. Module Not Found Errors**
```bash
# Ensure dependencies are installed
npm install

# For production builds
npm ci --only=production
```

**2. TypeScript Compilation Errors**
```bash
# Check for type errors
npm run typecheck

# Verify tsconfig.json settings
```

**3. Port Already in Use**
```bash
# Check if default ports are available
netstat -an | findstr :3003
netstat -an | findstr :3004

# Or set different ports
PORT=3005 WS_PORT=3006 npm run dev
```

**4. Docker Build Failures**
- Ensure Node.js 20+ is used in Dockerfile
- Verify all source files are copied before build
- Check for missing dependencies in package.json

### Debug Mode
For debugging in development:
```bash
# Enable debug logging
DEBUG=* npm run dev

# Or use Node.js inspector
node --inspect-brk dist/index.js
```

## Dependencies

### Production Dependencies
- **express**: Web framework for HTTP API
- **cors**: Cross-origin resource sharing
- **dotenv**: Environment variable loading
- **pg**: PostgreSQL database driver
- **ws**: WebSocket server implementation
- **uuid**: Unique identifier generation

### Development Dependencies
- **typescript**: TypeScript compiler
- **@types/node**: Node.js type definitions
- **@types/express**: Express type definitions
- **@types/cors**: CORS type definitions
- **@types/pg**: PostgreSQL type definitions
- **@types/ws**: WebSocket type definitions
- **@types/uuid**: UUID type definitions
- **ts-node**: TypeScript execution for development
- **nodemon**: Development server with hot reload

## Performance Considerations

### Build Optimization
- TypeScript compilation generates source maps for debugging
- Production builds exclude dev dependencies
- Docker multi-stage builds minimize final image size

### Runtime Performance
- Express server with minimal middleware
- Real-time WebSocket communication for live data
- PostgreSQL database for production-scale data storage and time-series performance
- Health check endpoint for container monitoring
- Graceful error handling and connection management
- Efficient agent status tracking and data aggregation

## Security Notes
- Input validation for all API endpoints and WebSocket messages
- Environment variables for sensitive configuration
- CORS configured for cross-origin requests
- Token-based authentication for agent communication
- Database input sanitization to prevent injection attacks
- WebSocket connection validation and rate limiting
- No secrets committed to repository

## Architecture Components

### Core Services
- **AgentManager**: Handles agent registration, status tracking, and lifecycle management
- **WebSocketHub**: Manages real-time communication between frontend and agents
- **DataAggregator**: Processes and aggregates sensor/fan data from multiple systems
- **AgentCommunication**: Handles bidirectional messaging with remote agents
- **CommandDispatcher**: Manages fan control commands and emergency stops

### Database Schema
- **systems**: Registered agent systems with capabilities and status
- **sensors**: Temperature sensor readings and metadata
- **fans**: Fan speed data and control settings
- **commands**: Command history and execution status

---

**Last Updated**: 2025-08-03  
**Node.js Version**: 20+  
**TypeScript Version**: 5.8+