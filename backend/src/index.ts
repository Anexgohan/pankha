// Load environment variables from backend directory AND parent (root) directory
import dotenv from 'dotenv';
import path from 'path';
dotenv.config(); // Try loading from /backend/.env first (if exists)
dotenv.config({ path: path.join(__dirname, '../../.env') }); // Load from project root

import express from 'express';
import http from 'http';
import cors from 'cors';
import Database from './database/database';
import { AgentManager } from './services/AgentManager';
import { AgentCommunication } from './services/AgentCommunication';
import { DataAggregator } from './services/DataAggregator';
import { CommandDispatcher } from './services/CommandDispatcher';
import { WebSocketHub } from './services/WebSocketHub';
import { FanProfileController } from './services/FanProfileController';
import { DownsamplingService } from './services/DownsamplingService';

// Import routes
import systemsRouter from './routes/systems';
import discoveryRouter from './routes/discovery';
import fanProfilesRouter from './routes/fanProfiles';
import fanConfigurationsRouter from './routes/fanConfigurations';
import deployRouter from './routes/deploy';
import configRouter from './routes/config';
import { licenseRouter, licenseManager } from './license';
import { log } from './utils/logger';

const app = express();
// Port Priority: 
// 1. process.env.PORT (set by Docker to keep container port static)
// 2. process.env.PANKHA_PORT (set by user in root .env for host access)
// 3. 3143 (default fallback / brand port)
const PORT = process.env.PORT || process.env.PANKHA_PORT || 3143;

// Initialize services
let services: {
  db: Database;
  agentManager: AgentManager;
  agentCommunication: AgentCommunication;
  dataAggregator: DataAggregator;
  commandDispatcher: CommandDispatcher;
  webSocketHub: WebSocketHub;
  fanProfileController: FanProfileController;
  downsamplingService: DownsamplingService;
} | null = null;

async function initializeServices() {
  try {
    log.info(' Initializing Pankha services...', 'index');

    // Initialize database
    const db = Database.getInstance();
    await db.initialize();

    // Initialize core services
    const agentManager = AgentManager.getInstance();
    const agentCommunication = AgentCommunication.getInstance();
    const dataAggregator = DataAggregator.getInstance();
    const commandDispatcher = CommandDispatcher.getInstance();
    const webSocketHub = WebSocketHub.getInstance();
    const fanProfileController = FanProfileController.getInstance();

    // Load existing agents from database
    await agentManager.loadAgentsFromDatabase();

    // Initialize license manager
    await licenseManager.initialize();

    // Initialize WebSocket server (attached to HTTP server at /websocket)
    // server instance will be provided in startServer()

    // Set WebSocketHub reference in CommandDispatcher for command sending
    commandDispatcher.setWebSocketHub(webSocketHub);

    // Connect AgentCommunication command responses to CommandDispatcher
    agentCommunication.on('commandResponse', (event) => {
      commandDispatcher.processCommandResponse(event);
    });

    // Start Fan Profile Controller (loads interval from database)
    await fanProfileController.start();
    
    // Start Downsampling Service (Tier 2/3 data compression, runs daily at 03:00 UTC)
    const downsamplingService = new DownsamplingService(
      db.getPool(),
      licenseManager
    );
    downsamplingService.start();

    // Note: Agents connect TO the backend, not vice versa
    log.info(' WebSocket server ready - waiting for agent connections...', 'index');

    services = {
      db,
      agentManager,
      agentCommunication,
      dataAggregator,
      commandDispatcher,
      webSocketHub,
      fanProfileController,
      downsamplingService
    };

    log.info(' All services initialized successfully', 'index');
    return services;

  } catch (error) {
    log.error(' Failed to initialize services:', 'index', error);
    throw error;
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  const isInitialized = services !== null;
  const agentCount = isInitialized ? services!.agentManager.getAgents().length : 0;
  const agentStatuses = isInitialized ? services!.agentManager.getAgentCountByStatus() : {};
  const wsClients = isInitialized ? services!.webSocketHub.getClientsInfo().length : 0;

  res.json({ 
    status: isInitialized ? 'ok' : 'initializing',
    timestamp: new Date().toISOString(),
    timezone: process.env.TZ || process.env.TIMEZONE || 'UTC',
    server_time: new Date().toLocaleString('en-US', { timeZone: process.env.TZ || process.env.TIMEZONE || 'UTC' }),
    service: 'pankha-backend',
    version: process.env.PANKHA_VERSION || 'dev',
    services: {
      database: isInitialized ? 'connected' : 'disconnected',
      agent_manager: isInitialized ? 'active' : 'inactive',
      websocket_hub: isInitialized ? 'active' : 'inactive'
    },
    statistics: {
      total_agents: agentCount,
      agent_statuses: agentStatuses,
      websocket_clients: wsClients,
      pending_commands: isInitialized ? services!.commandDispatcher.getPendingCommandsCount() : 0
    }
  });
});

// API routes
app.use('/api/systems', systemsRouter);
app.use('/api/discovery', discoveryRouter);
app.use('/api/fan-profiles', fanProfilesRouter);
app.use('/api/fan-configurations', fanConfigurationsRouter);
app.use('/api/deploy', deployRouter);
app.use('/api/config', configRouter);
app.use('/api/license', licenseRouter);

// System overview endpoint
app.get('/api/overview', async (req, res) => {
  if (!services) {
    return res.status(503).json({ error: 'Services not initialized' });
  }

  const overview = services.dataAggregator.getSystemOverview();
  const wsStats = services.webSocketHub.getStats();
  const queueStatus = services.commandDispatcher.getQueueStatus();

  // Add license limit info
  const tier = await licenseManager.getCurrentTier();
  const agentLimit = tier.agentLimit;
  const isUnlimited = agentLimit === Infinity;

  res.json({
    ...overview,
    agentLimit: isUnlimited ? 'unlimited' : agentLimit,
    overLimit: !isUnlimited && overview.totalSystems > agentLimit,
    tierName: tier.name,
    websocket_stats: wsStats,
    command_queue_status: queueStatus,
    timestamp: new Date().toISOString()
  });
});

// WebSocket connection info
app.get('/api/websocket/info', (req, res) => {
  if (!services) {
    return res.status(503).json({ error: 'Services not initialized' });
  }

  const clients = services.webSocketHub.getClientsInfo();
  const stats = services.webSocketHub.getStats();

  res.json({
    websocket_endpoint: `/websocket`, // Path-relative endpoint
    connected_clients: clients,
    statistics: stats
  });
});

// Serve static frontend files (Production)
const frontendPath = path.join(__dirname, '../frontend');

// Hashed assets (JS/CSS in /assets/) - cache for 1 year (hash changes on update)
app.use('/assets', express.static(path.join(frontendPath, 'assets'), {
  maxAge: '1y',
  immutable: true
}));

// Other static files (favicons, etc.) - short cache
app.use(express.static(frontendPath, {
  maxAge: '1h',
  index: false  // Don't serve index.html from here
}));

// SPA fallback: Route all unknown requests to index.html (no cache)
app.get(/^(?!\/(api|health|websocket)).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Emergency stop endpoint
app.post('/api/emergency-stop', async (req, res) => {
  if (!services) {
    return res.status(503).json({ error: 'Services not initialized' });
  }

  try {
    await services.commandDispatcher.emergencyStopAll();
    res.json({ 
      message: 'Emergency stop triggered for all systems',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log.error('Emergency stop failed:', 'index', error);
    res.status(500).json({ error: 'Emergency stop failed' });
  }
});

// Graceful shutdown handler
process.on('SIGINT', async () => {
  log.info(' Shutting down Pankha backend...', 'index');

  if (services) {
    try {
      services.fanProfileController.stop(); // Stop fan controller first
      services.downsamplingService.stop(); // Stop downsampling scheduler
      services.commandDispatcher.cleanup();
      services.dataAggregator.cleanup();
      services.agentManager.cleanup();
      services.webSocketHub.cleanup(); // This will close agent connections
      await services.db.close();
      log.info(' All services cleaned up', 'index');
    } catch (error) {
      log.error(' Error during cleanup:', 'index', error);
    }
  }

  process.exit(0);
});

// Start server
async function startServer() {
  try {
    // Initialize all services first
    await initializeServices();
    
    // 2. Create the unified HTTP server
    const httpServer = http.createServer(app);
    
    // 3. Attach WebSockets to the server
    if (services) {
      services.webSocketHub.initialize(httpServer);
    }

    // 4. Start listening
    httpServer.listen(PORT, () => {
      log.info(` Unified Port Architecture: http://localhost:${PORT}`, 'index');
      log.info(` HTTP API: /api`, 'index');
      log.info(` WebSocket: /websocket`, 'index');
      log.info(` Health check: http://localhost:${PORT}/health`, 'index');
      log.info(` System overview: http://localhost:${PORT}/api/overview`, 'index');
    });
    
  } catch (error) {
    log.error(' Failed to start server:', 'index', error);
    process.exit(1);
  }
}

startServer();