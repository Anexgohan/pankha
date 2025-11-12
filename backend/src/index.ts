// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import Database from './database/database';
import { AgentManager } from './services/AgentManager';
import { AgentCommunication } from './services/AgentCommunication';
import { DataAggregator } from './services/DataAggregator';
import { CommandDispatcher } from './services/CommandDispatcher';
import { WebSocketHub } from './services/WebSocketHub';
import { FanProfileController } from './services/FanProfileController';

// Import routes
import systemsRouter from './routes/systems';
import discoveryRouter from './routes/discovery';
import fanProfilesRouter from './routes/fanProfiles';
import fanConfigurationsRouter from './routes/fanConfigurations';
import { log } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;

// Initialize services
let services: {
  db: Database;
  agentManager: AgentManager;
  agentCommunication: AgentCommunication;
  dataAggregator: DataAggregator;
  commandDispatcher: CommandDispatcher;
  webSocketHub: WebSocketHub;
  fanProfileController: FanProfileController;
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

    // Initialize WebSocket server (agents will connect TO us)
    webSocketHub.initialize(parseInt(WS_PORT.toString()));

    // Set WebSocketHub reference in CommandDispatcher for command sending
    commandDispatcher.setWebSocketHub(webSocketHub);

    // Connect AgentCommunication command responses to CommandDispatcher
    agentCommunication.on('commandResponse', (event) => {
      commandDispatcher.processCommandResponse(event);
    });

    // Start Fan Profile Controller (loads interval from database)
    await fanProfileController.start();

    // Note: Agents connect TO the backend, not vice versa
    log.info(' WebSocket server ready - waiting for agent connections...', 'index');

    services = {
      db,
      agentManager,
      agentCommunication,
      dataAggregator,
      commandDispatcher,
      webSocketHub,
      fanProfileController
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
    service: 'pankha-backend',
    version: '1.0.0',
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

// System overview endpoint
app.get('/api/overview', (req, res) => {
  if (!services) {
    return res.status(503).json({ error: 'Services not initialized' });
  }

  const overview = services.dataAggregator.getSystemOverview();
  const wsStats = services.webSocketHub.getStats();
  const queueStatus = services.commandDispatcher.getQueueStatus();

  res.json({
    ...overview,
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
    websocket_endpoint: `ws://localhost:${WS_PORT}`,
    connected_clients: clients,
    statistics: stats
  });
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
    
    // Start HTTP server
    app.listen(PORT, () => {
      log.info(` Pankha Backend Server started`, 'index');
      log.info(` HTTP API: http://localhost:${PORT}`, 'index');
      log.info(` WebSocket: ws://localhost:${WS_PORT}`, 'index');
      log.info(` Health check: http://localhost:${PORT}/health`, 'index');
      log.info(` System overview: http://localhost:${PORT}/api/overview`, 'index');
    });
    
  } catch (error) {
    log.error(' Failed to start server:', 'index', error);
    process.exit(1);
  }
}

startServer();