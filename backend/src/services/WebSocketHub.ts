import WebSocket, { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { DataAggregator } from './DataAggregator';
import { AgentManager } from './AgentManager';
import { CommandDispatcher } from './CommandDispatcher';
import { AgentCommunication } from './AgentCommunication';
import { log } from '../utils/logger';

interface ClientConnection {
  id: string;
  websocket: WebSocket;
  subscriptions: Set<string>;
  lastActivity: Date;
  metadata: {
    userAgent?: string;
    ip?: string;
    connectedAt: Date;
    agentId?: string;
    isAgent?: boolean;
  };
}

interface WebSocketMessage {
  type: string;
  data?: any;
  subscriptions?: string[];
  clientId?: string;
}

export class WebSocketHub extends EventEmitter {
  private static instance: WebSocketHub;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private dataAggregator: DataAggregator;
  private agentManager: AgentManager;
  private commandDispatcher: CommandDispatcher;
  private agentCommunication: AgentCommunication;
  private pingInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.dataAggregator = DataAggregator.getInstance();
    this.agentManager = AgentManager.getInstance();
    this.commandDispatcher = CommandDispatcher.getInstance();
    this.agentCommunication = AgentCommunication.getInstance();
    
    this.setupEventListeners();
  }

  public static getInstance(): WebSocketHub {
    if (!WebSocketHub.instance) {
      WebSocketHub.instance = new WebSocketHub();
    }
    return WebSocketHub.instance;
  }

  /**
   * Initialize WebSocket server
   */
  public initialize(port: number = 3002): void {
    this.wss = new WebSocketServer({ 
      port,
      perMessageDeflate: false // Disable compression for real-time updates
    });

    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      this.handleNewConnection(ws, request);
    });

    this.startPingInterval();
    this.startCleanupInterval();

    log.info(` WebSocket server started on port ${port}`, 'WebSocketHub');
  }

  /**
   * Setup event listeners for data updates
   */
  private setupEventListeners(): void {
    // Listen for aggregated data updates
    this.dataAggregator.on('dataAggregated', (data) => {
      this.broadcast('systemData', data, [`system:${data.agentId}`, 'systems:all']);
    });

    this.dataAggregator.on('systemOffline', (data) => {
      this.broadcast('systemOffline', data, [`system:${data.agentId}`, 'systems:all']);
    });

    // Listen for agent events
    this.agentManager.on('agentRegistered', (agent) => {
      this.broadcast('agentRegistered', agent, ['agents:all']);
    });

    this.agentManager.on('agentUnregistered', (event) => {
      this.broadcast('agentUnregistered', event, ['agents:all']);
    });

    this.agentManager.on('agentError', (event) => {
      this.broadcast('agentError', event, [`system:${event.agentId}`, 'agents:all']);
    });

    // Listen for command events
    this.commandDispatcher.on('commandCompleted', (event) => {
      this.broadcast('commandCompleted', event, [`system:${event.command.agentId}`, 'commands:all']);
    });

    this.commandDispatcher.on('commandFailed', (event) => {
      this.broadcast('commandFailed', event, [`system:${event.command.agentId}`, 'commands:all']);
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleNewConnection(ws: WebSocket, request: IncomingMessage): void {
    const clientId = this.generateClientId();
    const userAgent = request.headers['user-agent'] || '';
    const isAgent = userAgent.includes('Python') || userAgent.includes('websockets');

    // Get real IP address (handles nginx proxy and IPv6-mapped IPv4)
    const realIp = this.extractRealIp(request);

    const client: ClientConnection = {
      id: clientId,
      websocket: ws,
      subscriptions: new Set(),
      lastActivity: new Date(),
      metadata: {
        userAgent: userAgent,
        ip: realIp,
        connectedAt: new Date(),
        isAgent: isAgent
      }
    };

    this.clients.set(clientId, client);

    if (isAgent) {
      log.info(` New AGENT WebSocket connected: ${clientId} (${client.metadata.ip})`, 'WebSocketHub');
    } else {
      log.info(` New FRONTEND WebSocket connected: ${clientId} (${client.metadata.ip})`, 'WebSocketHub');
      
      // Send welcome message to frontend clients only
      this.sendToClient(clientId, 'connected', {
        clientId,
        serverTime: new Date().toISOString(),
        availableSubscriptions: this.getAvailableSubscriptions()
      });
    }

    // Setup message handler
    ws.on('message', async (data: WebSocket.Data) => {
      await this.handleClientMessage(clientId, data);
    });

    // Handle disconnection
    ws.on('close', () => {
      this.handleClientDisconnection(clientId);
    });

    // Handle errors
    ws.on('error', (error) => {
      log.error(`WebSocket error for client ${clientId}`, "WebSocketHub", error);
      this.handleClientDisconnection(clientId);
    });

    // Handle pong responses
    ws.on('pong', () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastActivity = new Date();
      }
    });

    this.emit('clientConnected', { clientId, client });
  }

  /**
   * Handle client disconnection
   */
  private handleClientDisconnection(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      log.info(` Client disconnected: ${clientId}`, 'WebSocketHub');
      this.emit('clientDisconnected', { clientId, client });
    }
  }

  /**
   * Handle incoming message from client
   */
  private async handleClientMessage(clientId: string, data: WebSocket.Data): Promise<void> {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      log.info(` RAW MESSAGE from ${clientId}: ${message.type}`, 'WebSocketHub');
      const client = this.clients.get(clientId);
      
      if (!client) return;

      client.lastActivity = new Date();

      switch (message.type) {
        case 'subscribe':
          this.handleSubscription(clientId, message.data?.subscriptions || message.subscriptions || []);
          break;

        case 'unsubscribe':
          this.handleUnsubscription(clientId, message.data?.subscriptions || message.subscriptions || []);
          break;

        case 'getSystemData':
          this.handleGetSystemData(clientId, message.data?.agentId);
          break;

        case 'getOverview':
          this.handleGetOverview(clientId);
          break;

        case 'ping':
          this.sendToClient(clientId, 'pong', { timestamp: Date.now() });
          break;

        case 'data':
          // Handle agent data messages
          const dataClient = this.clients.get(clientId);
          if (dataClient?.metadata.isAgent) {
            log.debug(`Received AGENT data from ${clientId}:`, JSON.stringify(message.data, null, 2));
            if (message.data?.agentId) {
              log.info(` Processing agent data for: ${message.data.agentId}`, 'WebSocketHub');
              // Process agent data directly through AgentCommunication
              const agentMessage = {
                type: 'data',
                data: message.data
              };
              await this.agentCommunication.handleAgentMessage(message.data.agentId, agentMessage);
            } else {
              log.warn(` Agent data from ${clientId} missing agentId`, 'WebSocketHub');
            }
          } else {
            log.info(` Received FRONTEND data from ${clientId} (ignoring)`, 'WebSocketHub');
          }
          break;

        case 'register':
          // Handle agent registration via WebSocket
          await this.handleAgentRegistration(clientId, message.data);
          break;

        case 'commandResponse':
          // Handle command response from agent
          const commandClient = this.clients.get(clientId);
          if (commandClient?.metadata.isAgent && (message as any).commandId) {
            log.info(` Command response from ${commandClient.metadata.agentId}: ${(message as any).commandId}, success: ${(message as any).success}`, 'WebSocketHub');
            // Forward to CommandDispatcher to handle response
            this.agentCommunication.emit('commandResponse', { 
              agentId: commandClient.metadata.agentId, 
              response: message 
            });
          }
          break;

        default:
          log.warn(`Unknown message type from client ${clientId}: ${message.type}`, 'WebSocketHub');
      }

    } catch (error) {
      log.error(`Error parsing message from client ${clientId}`, "WebSocketHub", error);
    }
  }

  /**
   * Handle client subscription
   */
  private handleSubscription(clientId: string, subscriptions: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const subscription of subscriptions) {
      client.subscriptions.add(subscription);
    }

    log.info(` Client ${clientId} subscribed to: ${subscriptions.join(', ')}`, 'WebSocketHub');
    
    this.sendToClient(clientId, 'subscribed', { 
      subscriptions: Array.from(client.subscriptions) 
    });

    // Send initial data for subscriptions
    this.sendInitialDataForSubscriptions(clientId, subscriptions);
  }

  /**
   * Handle agent registration via WebSocket
   */
  private async handleAgentRegistration(clientId: string, registrationData: any): Promise<void> {
    try {
      log.info(`Agent registration via WebSocket ${clientId}:`, registrationData?.name || registrationData?.agentId);
      
      if (!registrationData?.agentId) {
        log.error(` Agent registration missing agentId from ${clientId}`, 'WebSocketHub');
        this.sendToClient(clientId, 'registrationError', { error: 'Missing agentId' });
        return;
      }
      
      const agentId = registrationData.agentId;
      
      // Mark this client as an agent connection
      const client = this.clients.get(clientId);
      if (client) {
        client.metadata.agentId = agentId;
        client.metadata.isAgent = true;
        log.info(` WebSocket client ${clientId} marked as agent ${agentId}`, 'WebSocketHub');
      }
      
      // Create agent configuration for AgentManager
      const agentConfig = {
        agentId: agentId,
        name: registrationData.name || agentId,
        version: registrationData.agent_version || '1.0.0-websocket',
        apiEndpoint: `http://${client?.metadata.ip || 'unknown'}:8080`, // Mock endpoint
        websocketEndpoint: `ws://${client?.metadata.ip || 'unknown'}:8081`, // Mock endpoint
        authToken: registrationData.auth_token || 'websocket-agent-token',
        updateInterval: registrationData.update_interval || 3000, // From client config or default
        capabilities: registrationData.capabilities || { sensors: [], fans: [] }
      };
      
      // Register agent with AgentManager
      try {
        await this.agentManager.registerAgent(agentConfig);
        log.info(` Agent ${agentId} registered successfully via WebSocket`, 'WebSocketHub');

        // Set sensor deduplication settings if provided
        if (registrationData.filter_duplicate_sensors !== undefined) {
          this.agentManager.setAgentSensorDeduplication(agentId, registrationData.filter_duplicate_sensors);
          log.info(` Agent ${agentId} sensor deduplication: ${registrationData.filter_duplicate_sensors}`, 'WebSocketHub');
        }
        if (registrationData.duplicate_sensor_tolerance !== undefined) {
          this.agentManager.setAgentSensorTolerance(agentId, registrationData.duplicate_sensor_tolerance);
          log.info(` Agent ${agentId} sensor tolerance: ${registrationData.duplicate_sensor_tolerance}`, 'WebSocketHub');
        }

        // Send registration confirmation
        this.sendToClient(clientId, 'registered', {
          agentId: agentId,
          status: 'success',
          message: 'Agent registered successfully',
          timestamp: new Date().toISOString()
        });

        // Notify other clients about new agent
        this.broadcast('agentRegistered', agentConfig, ['agents:all']);

      } catch (error) {
        log.error(`Failed to register agent ${agentId}`, "WebSocketHub", error);
        this.sendToClient(clientId, 'registrationError', {
          error: error instanceof Error ? error.message : 'Registration failed'
        });
      }
      
    } catch (error) {
      log.error(`Error handling agent registration for ${clientId}`, "WebSocketHub", error);
      this.sendToClient(clientId, 'registrationError', { error: 'Registration processing failed' });
    }
  }

  /**
   * Handle client unsubscription
   */
  private handleUnsubscription(clientId: string, subscriptions: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const subscription of subscriptions) {
      client.subscriptions.delete(subscription);
    }

    log.info(` Client ${clientId} unsubscribed from: ${subscriptions.join(', ')}`, 'WebSocketHub');
    
    this.sendToClient(clientId, 'unsubscribed', { 
      subscriptions: Array.from(client.subscriptions) 
    });
  }

  /**
   * Send initial data for new subscriptions
   */
  private sendInitialDataForSubscriptions(clientId: string, subscriptions: string[]): void {
    for (const subscription of subscriptions) {
      if (subscription === 'systems:all') {
        // Send all current system data
        const systemsData = this.dataAggregator.getAllSystemsData();
        this.sendToClient(clientId, 'systemsData', systemsData);
      } else if (subscription.startsWith('system:')) {
        // Send specific system data
        const agentId = subscription.replace('system:', '');
        const systemData = this.dataAggregator.getSystemData(agentId);
        if (systemData) {
          this.sendToClient(clientId, 'systemData', systemData);
        }
      } else if (subscription === 'agents:all') {
        // Send agent statuses
        const agentStatuses = this.agentManager.getAllAgentStatuses();
        this.sendToClient(clientId, 'agentStatuses', agentStatuses);
      }
    }
  }

  /**
   * Handle get system data request
   */
  private handleGetSystemData(clientId: string, agentId?: string): void {
    if (agentId) {
      const systemData = this.dataAggregator.getSystemData(agentId);
      this.sendToClient(clientId, 'systemData', systemData);
    } else {
      const systemsData = this.dataAggregator.getAllSystemsData();
      this.sendToClient(clientId, 'systemsData', systemsData);
    }
  }

  /**
   * Handle get overview request
   */
  private handleGetOverview(clientId: string): void {
    const overview = this.dataAggregator.getSystemOverview();
    this.sendToClient(clientId, 'overview', overview);
  }

  /**
   * Send message to specific client
   */
  private sendToClient(clientId: string, type: string, data?: any): void {
    const client = this.clients.get(clientId);
    if (!client || client.websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const message = {
        type,
        data,
        timestamp: new Date().toISOString()
      };

      client.websocket.send(JSON.stringify(message));
    } catch (error) {
      log.error(`Error sending message to client ${clientId}`, "WebSocketHub", error);
    }
  }

  /**
   * Broadcast message to all subscribed clients
   */
  private broadcast(type: string, data: any, subscriptions: string[]): void {
    const message = {
      type,
      data,
      timestamp: new Date().toISOString()
    };

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (client.websocket.readyState !== WebSocket.OPEN) {
        continue;
      }

      // Check if client is subscribed to any of the relevant subscriptions
      const isSubscribed = subscriptions.some(sub => client.subscriptions.has(sub));
      
      if (isSubscribed) {
        try {
          client.websocket.send(messageStr);
          sentCount++;
        } catch (error) {
          log.error(`Error broadcasting to client ${clientId}`, "WebSocketHub", error);
        }
      }
    }

    if (sentCount > 0) {
      log.info(` Broadcasted ${type} to ${sentCount} clients`, 'WebSocketHub');
    }
  }

  /**
   * Start ping interval to keep connections alive
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      for (const [clientId, client] of this.clients.entries()) {
        if (client.websocket.readyState === WebSocket.OPEN) {
          client.websocket.ping();
        }
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Start cleanup interval for dead connections
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds
      const clientsToRemove: string[] = [];

      for (const [clientId, client] of this.clients.entries()) {
        const timeSinceLastActivity = now - client.lastActivity.getTime();
        
        if (client.websocket.readyState !== WebSocket.OPEN || timeSinceLastActivity > timeout) {
          clientsToRemove.push(clientId);
        }
      }

      for (const clientId of clientsToRemove) {
        this.handleClientDisconnection(clientId);
      }

      if (clientsToRemove.length > 0) {
        log.info(` Cleaned up ${clientsToRemove.length} inactive WebSocket connections`, 'WebSocketHub');
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Generate unique client ID
   */
  /**
   * Extract real IP address from request (handles proxies and IPv6)
   */
  private extractRealIp(request: IncomingMessage): string {
    // Check for X-Forwarded-For header (nginx proxy)
    const xForwardedFor = request.headers['x-forwarded-for'];
    if (xForwardedFor) {
      const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
      const firstIp = ips.split(',')[0].trim();
      return this.cleanIpAddress(firstIp);
    }

    // Check for X-Real-IP header
    const xRealIp = request.headers['x-real-ip'];
    if (xRealIp) {
      const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
      return this.cleanIpAddress(ip);
    }

    // Fall back to socket address
    const socketIp = request.socket.remoteAddress || 'unknown';
    return this.cleanIpAddress(socketIp);
  }

  /**
   * Clean IPv6-mapped IPv4 addresses
   */
  private cleanIpAddress(ip: string): string {
    // Convert IPv6-mapped IPv4 (::ffff:192.168.1.1) to IPv4 (192.168.1.1)
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }
    // Convert localhost variations
    if (ip === '::1' || ip === '127.0.0.1') {
      return 'localhost';
    }
    return ip;
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get available subscription types
   */
  private getAvailableSubscriptions(): string[] {
    return [
      'systems:all',
      'agents:all',
      'commands:all',
      'system:{agentId}' // Template for specific system subscriptions
    ];
  }

  /**
   * Get connected clients info
   */
  public getClientsInfo(): Array<{
    id: string;
    subscriptions: string[];
    lastActivity: Date;
    connectedAt: Date;
    ip?: string;
    userAgent?: string;
  }> {
    return Array.from(this.clients.values()).map(client => ({
      id: client.id,
      subscriptions: Array.from(client.subscriptions),
      lastActivity: client.lastActivity,
      connectedAt: client.metadata.connectedAt,
      ip: client.metadata.ip,
      userAgent: client.metadata.userAgent
    }));
  }

  /**
   * Send command to agent via WebSocket
   */
  public sendCommandToAgent(agentId: string, command: any): boolean {
    // Find the WebSocket client for this agent
    for (const [clientId, client] of this.clients.entries()) {
      if (client.metadata.isAgent && client.metadata.agentId === agentId) {
        if (client.websocket.readyState === WebSocket.OPEN) {
          try {
            const message = {
              type: 'command',
              data: command,
              timestamp: new Date().toISOString()
            };
            client.websocket.send(JSON.stringify(message));
            log.info(` Command sent to agent ${agentId}: ${command.type}`, 'WebSocketHub');
            return true;
          } catch (error) {
            log.error(`Error sending command to agent ${agentId}`, "WebSocketHub", error);
            return false;
          }
        } else {
          log.warn(`Agent ${agentId} WebSocket not open (state: ${client.websocket.readyState})`, 'WebSocketHub');
          return false;
        }
      }
    }
    
    log.warn(`Agent ${agentId} not found in WebSocket connections`, 'WebSocketHub');
    return false;
  }

  /**
   * Send command to all connected agents
   */
  public broadcastCommandToAgents(command: any): string[] {
    const successfulAgents: string[] = [];
    
    for (const [clientId, client] of this.clients.entries()) {
      if (client.metadata.isAgent && client.metadata.agentId) {
        const success = this.sendCommandToAgent(client.metadata.agentId, command);
        if (success) {
          successfulAgents.push(client.metadata.agentId);
        }
      }
    }
    
    return successfulAgents;
  }

  /**
   * Get connection statistics
   */
  public getStats(): {
    totalClients: number;
    activeClients: number;
    totalSubscriptions: number;
    subscriptionBreakdown: { [subscription: string]: number };
  } {
    const now = Date.now();
    const activeTimeout = 60000; // 1 minute
    
    let activeClients = 0;
    let totalSubscriptions = 0;
    const subscriptionBreakdown: { [subscription: string]: number } = {};

    for (const client of this.clients.values()) {
      const isActive = (now - client.lastActivity.getTime()) < activeTimeout;
      if (isActive) activeClients++;
      
      totalSubscriptions += client.subscriptions.size;
      
      for (const subscription of client.subscriptions) {
        subscriptionBreakdown[subscription] = (subscriptionBreakdown[subscription] || 0) + 1;
      }
    }

    return {
      totalClients: this.clients.size,
      activeClients,
      totalSubscriptions,
      subscriptionBreakdown
    };
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      if (client.websocket.readyState === WebSocket.OPEN) {
        client.websocket.close();
      }
    }

    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }

    this.removeAllListeners();
    log.info(' WebSocket hub cleaned up', 'WebSocketHub');
  }
}