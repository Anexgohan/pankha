import { EventEmitter } from 'events';
import Database from '../database/database';
import { AgentConfig, AgentStatus, AgentDataPacket, FanControlCommand } from '../types/agent';
import { log } from '../utils/logger';

export class AgentManager extends EventEmitter {
  private static instance: AgentManager;
  private agents: Map<string, AgentConfig> = new Map();
  private agentStatuses: Map<string, AgentStatus> = new Map();
  private agentUpdateIntervals: Map<string, number> = new Map(); // Track current update intervals
  private agentSensorDeduplication: Map<string, boolean> = new Map(); // Track sensor deduplication setting
  private agentSensorTolerance: Map<string, number> = new Map(); // Track sensor tolerance setting
  private db: Database;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.db = Database.getInstance();
    this.startHealthChecking();
  }

  public static getInstance(): AgentManager {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager();
    }
    return AgentManager.instance;
  }

  /**
   * Register a new agent with the system
   */
  public async registerAgent(agentConfig: AgentConfig): Promise<void> {
    try {
      // Store agent configuration in database
      const sql = `
        INSERT INTO systems (
          name, agent_id, ip_address, api_endpoint, websocket_endpoint,
          auth_token, agent_version, status, capabilities, last_seen
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'online', $8, CURRENT_TIMESTAMP)
        ON CONFLICT (agent_id) DO UPDATE SET
          name = EXCLUDED.name,
          ip_address = EXCLUDED.ip_address,
          api_endpoint = EXCLUDED.api_endpoint,
          websocket_endpoint = EXCLUDED.websocket_endpoint,
          auth_token = EXCLUDED.auth_token,
          agent_version = EXCLUDED.agent_version,
          status = 'online',
          capabilities = EXCLUDED.capabilities,
          last_seen = CURRENT_TIMESTAMP
      `;

      const ipAddress = this.extractIpFromEndpoint(agentConfig.apiEndpoint);

      await this.db.run(sql, [
        agentConfig.name,
        agentConfig.agentId,
        ipAddress,
        agentConfig.apiEndpoint,
        agentConfig.websocketEndpoint,
        agentConfig.authToken,
        agentConfig.version,
        JSON.stringify(agentConfig.capabilities)
      ]);

      // Store in memory
      this.agents.set(agentConfig.agentId, agentConfig);
      
      // Initialize status
      const status: AgentStatus = {
        agentId: agentConfig.agentId,
        status: 'online',
        lastSeen: new Date(),
        lastDataReceived: new Date(),
        connectionInfo: {
          apiEndpoint: agentConfig.apiEndpoint,
          websocketEndpoint: agentConfig.websocketEndpoint,
          responseTime: 0,
          errorCount: 0
        }
      };
      
      this.agentStatuses.set(agentConfig.agentId, status);
      
      // Initialize with agent's reported update interval (convert from milliseconds to seconds)
      const intervalSeconds = agentConfig.updateInterval ? Math.round(agentConfig.updateInterval / 1000) : 3;
      this.agentUpdateIntervals.set(agentConfig.agentId, intervalSeconds);
      log.info(` Agent ${agentConfig.agentId} registered with update interval: ${intervalSeconds}s`, 'AgentManager');

      log.info(` Agent registered: ${agentConfig.name} (${agentConfig.agentId})`, 'AgentManager');
      this.emit('agentRegistered', agentConfig);
      
    } catch (error) {
      log.error('Error registering agent:', 'AgentManager', error);
      throw error;
    }
  }

  /**
   * Unregister an agent from the system
   */
  public async unregisterAgent(agentId: string): Promise<void> {
    try {
      // Update status in database
      await this.db.run(
        'UPDATE systems SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE agent_id = $2',
        ['offline', agentId]
      );

      // Remove from memory
      const agent = this.agents.get(agentId);
      this.agents.delete(agentId);
      this.agentStatuses.delete(agentId);
      this.agentUpdateIntervals.delete(agentId);

      log.info(` Agent unregistered: ${agentId}`, 'AgentManager');
      this.emit('agentUnregistered', { agentId, agent });
      
    } catch (error) {
      log.error('Error unregistering agent:', 'AgentManager', error);
      throw error;
    }
  }

  /**
   * Get all registered agents
   */
  public getAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get specific agent by ID
   */
  public getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agent status
   */
  public getAgentStatus(agentId: string): AgentStatus | undefined {
    return this.agentStatuses.get(agentId);
  }

  /**
   * Get all agent statuses
   */
  public getAllAgentStatuses(): AgentStatus[] {
    return Array.from(this.agentStatuses.values());
  }

  /**
   * Update agent status based on received data
   */
  public async updateAgentStatus(agentId: string, dataPacket: AgentDataPacket): Promise<void> {
    const status = this.agentStatuses.get(agentId);
    if (status) {
      status.lastDataReceived = new Date(dataPacket.timestamp);
      status.lastSeen = new Date();
      status.status = 'online';
      status.connectionInfo.errorCount = 0;
      
      // Update database
      try {
        log.info(` Updating agent status for ${agentId} to online`, 'AgentManager');
        const result = await this.db.run(
          'UPDATE systems SET status = $1, last_seen = CURRENT_TIMESTAMP, last_data_received = CURRENT_TIMESTAMP WHERE agent_id = $2',
          ['online', agentId]
        );
        log.info(` Database update result: ${result.rowCount} rows affected`, 'AgentManager');
      } catch (error) {
        log.error(` Error updating agent status in database: ${error}`, 'AgentManager');
      }
      
      this.agentStatuses.set(agentId, status);
      this.emit('agentDataReceived', { agentId, dataPacket });
    } else {
      log.info(`⚠️  Agent status not found in memory for ${agentId}, skipping status update`, 'AgentManager');
      log.info(` Available agents in memory: ${Array.from(this.agentStatuses.keys()).join(', ')}`, 'AgentManager');
    }
  }

  /**
   * Mark agent as having an error
   */
  public markAgentError(agentId: string, error: string): void {
    const status = this.agentStatuses.get(agentId);
    if (status) {
      status.status = 'error';
      status.connectionInfo.errorCount++;
      status.connectionInfo.lastError = error;
      status.lastSeen = new Date();
      
      this.agentStatuses.set(agentId, status);
      this.emit('agentError', { agentId, error });
    }
  }

  /**
   * Load agents from database on startup
   */
  public async loadAgentsFromDatabase(): Promise<void> {
    try {
      const systems = await this.db.all('SELECT * FROM systems');
      
      for (const system of systems) {
        const capabilities = system.capabilities || { sensors: [], fans: [] };
        
        const agentConfig: AgentConfig = {
          agentId: system.agent_id,
          name: system.name,
          version: system.agent_version || '1.0.0',
          apiEndpoint: system.api_endpoint,
          websocketEndpoint: system.websocket_endpoint,
          authToken: system.auth_token,
          updateInterval: 3000, // Default 3 seconds
          capabilities
        };

        this.agents.set(agentConfig.agentId, agentConfig);
        
        // Initialize status as offline until we hear from them
        const status: AgentStatus = {
          agentId: system.agent_id,
          status: 'offline',
          lastSeen: new Date(system.last_seen || Date.now()),
          lastDataReceived: new Date(system.last_data_received || Date.now()),
          connectionInfo: {
            apiEndpoint: system.api_endpoint,
            websocketEndpoint: system.websocket_endpoint,
            responseTime: 0,
            errorCount: 0
          }
        };
        
        this.agentStatuses.set(agentConfig.agentId, status);
        
        // Initialize with default update interval (3 seconds)
        this.agentUpdateIntervals.set(agentConfig.agentId, 3);
      }

      log.info(` Loaded ${systems.length} agents from database`, 'AgentManager');
      
    } catch (error) {
      log.error('Error loading agents from database:', 'AgentManager', error);
      throw error;
    }
  }

  /**
   * Start health checking for all agents
   */
  private startHealthChecking(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 10000); // Check every 10 seconds (reduced from 30)

    log.info(' Agent health checking started', 'AgentManager');
  }

  /**
   * Perform health checks on all agents
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now();
    const timeout = 15000; // 15 seconds timeout (reduced from 60)
    
    for (const [agentId, status] of this.agentStatuses.entries()) {
      const timeSinceLastSeen = now - status.lastSeen.getTime();
      
      if (timeSinceLastSeen > timeout && status.status === 'online') {
        // Mark as offline if we haven't heard from agent in timeout period
        status.status = 'offline';
        this.agentStatuses.set(agentId, status);

        // Update database
        await this.db.run(
          'UPDATE systems SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE agent_id = $2',
          ['offline', agentId]
        );

        log.info(`⚠️  Agent ${agentId} marked as offline (last seen: ${status.lastSeen.toISOString()})`, 'AgentManager');
        this.emit('agentOffline', { agentId, status });
      }
    }
  }

  /**
   * Stop health checking
   */
  public stopHealthChecking(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      log.info(' Agent health checking stopped', 'AgentManager');
    }
  }

  /**
   * Extract IP address from endpoint URL
   */
  private extractIpFromEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      return url.hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get agent count by status
   */
  public getAgentCountByStatus(): { [key: string]: number } {
    const counts = { online: 0, offline: 0, error: 0, installing: 0 };
    
    for (const status of this.agentStatuses.values()) {
      counts[status.status]++;
    }
    
    return counts;
  }

  /**
   * Get agent current update interval
   */
  public getAgentUpdateInterval(agentId: string): number {
    return this.agentUpdateIntervals.get(agentId) || 3; // Default 3 seconds
  }

  /**
   * Set agent current update interval
   */
  public setAgentUpdateInterval(agentId: string, interval: number): void {
    this.agentUpdateIntervals.set(agentId, interval);
    log.info(` Agent ${agentId} update interval set to ${interval}s`, 'AgentManager');
  }

  /**
   * Get agent sensor deduplication setting
   */
  public getAgentSensorDeduplication(agentId: string): boolean {
    return this.agentSensorDeduplication.get(agentId) ?? true; // Default true
  }

  /**
   * Set agent sensor deduplication setting
   */
  public setAgentSensorDeduplication(agentId: string, enabled: boolean): void {
    this.agentSensorDeduplication.set(agentId, enabled);
    log.info(` Agent ${agentId} sensor deduplication set to ${enabled}`, 'AgentManager');
  }

  /**
   * Get agent sensor tolerance setting
   */
  public getAgentSensorTolerance(agentId: string): number {
    return this.agentSensorTolerance.get(agentId) || 0.5; // Default 0.5°C
  }

  /**
   * Set agent sensor tolerance setting
   */
  public setAgentSensorTolerance(agentId: string, tolerance: number): void {
    this.agentSensorTolerance.set(agentId, tolerance);
    log.info(` Agent ${agentId} sensor tolerance set to ${tolerance}°C`, 'AgentManager');
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.stopHealthChecking();
    this.removeAllListeners();
  }
}