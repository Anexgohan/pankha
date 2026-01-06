import { EventEmitter } from "events";
import Database from "../database/database";
import {
  AgentConfig,
  AgentStatus,
  AgentDataPacket,
  FanControlCommand,
} from "../types/agent";
import { log } from "../utils/logger";
import { licenseManager } from "../license";
import {
  defaultFanStep,
  defaultHysteresis,
  defaultEmergencyTemp,
  defaultUpdateInterval,
  defaultFailsafeSpeed,
  defaultLogLevel,
} from "../config/uiOptions";

export class AgentManager extends EventEmitter {
  private static instance: AgentManager;
  private agents: Map<string, AgentConfig> = new Map();
  private agentStatuses: Map<string, AgentStatus> = new Map();
  private agentUpdateIntervals: Map<string, number> = new Map(); // Track current update intervals
  private agentFanStep: Map<string, number> = new Map(); // Track fan step percentage
  private agentHysteresis: Map<string, number> = new Map(); // Track hysteresis temperature
  private agentEmergencyTemp: Map<string, number> = new Map(); // Track emergency temperature
  private agentLogLevel: Map<string, string> = new Map(); // Track log level
  private agentFailsafeSpeed: Map<string, number> = new Map(); // Track failsafe speed
  private agentEnableFanControl: Map<string, boolean> = new Map(); // Track enable fan control
  private db: Database;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // Cache for agent registration order (to avoid repeated DB queries)
  private cachedAgentOrder: string[] = []; // agent_ids in registration order
  private agentOrderCacheValid: boolean = false;

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
        JSON.stringify(agentConfig.capabilities),
      ]);

      // Store in memory
      this.agents.set(agentConfig.agentId, agentConfig);

      // Initialize status
      const status: AgentStatus = {
        agentId: agentConfig.agentId,
        status: "online",
        lastSeen: new Date(),
        lastDataReceived: new Date(),
        connectionInfo: {
          apiEndpoint: agentConfig.apiEndpoint,
          websocketEndpoint: agentConfig.websocketEndpoint,
          responseTime: 0,
          errorCount: 0,
        },
      };

      this.agentStatuses.set(agentConfig.agentId, status);

      // Initialize with agent's reported update interval (convert from milliseconds to seconds)
      const intervalSeconds = agentConfig.updateInterval
        ? Math.round(agentConfig.updateInterval / 1000)
        : defaultUpdateInterval;
      this.agentUpdateIntervals.set(agentConfig.agentId, intervalSeconds);

      // Initialize ALL configuration Maps with default values from SST (ui-options.json)
      // This ensures all getters return actual values instead of fallback defaults
      if (!this.agentFanStep.has(agentConfig.agentId)) {
        this.agentFanStep.set(agentConfig.agentId, defaultFanStep);
      }
      if (!this.agentHysteresis.has(agentConfig.agentId)) {
        this.agentHysteresis.set(agentConfig.agentId, defaultHysteresis);
      }
      if (!this.agentEmergencyTemp.has(agentConfig.agentId)) {
        this.agentEmergencyTemp.set(agentConfig.agentId, defaultEmergencyTemp);
      }

      log.info(
        ` Agent ${agentConfig.agentId} registered with update interval: ${intervalSeconds}s`,
        "AgentManager"
      );

      log.info(
        ` Agent registered: ${agentConfig.name} (${agentConfig.agentId})`,
        "AgentManager"
      );

      // Invalidate agent order cache since a new agent was registered
      this.invalidateAgentOrderCache();

      this.emit("agentRegistered", agentConfig);
    } catch (error) {
      log.error("Error registering agent:", "AgentManager", error);
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
        "UPDATE systems SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE agent_id = $2",
        ["offline", agentId]
      );

      // Remove from memory
      const agent = this.agents.get(agentId);
      this.agents.delete(agentId);
      this.agentStatuses.delete(agentId);
      this.agentUpdateIntervals.delete(agentId);

      log.info(` Agent unregistered: ${agentId}`, "AgentManager");

      // Invalidate agent order cache since an agent was unregistered
      this.invalidateAgentOrderCache();

      this.emit("agentUnregistered", { agentId, agent });
    } catch (error) {
      log.error("Error unregistering agent:", "AgentManager", error);
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
  public async updateAgentStatus(
    agentId: string,
    dataPacket: AgentDataPacket
  ): Promise<void> {
    const status = this.agentStatuses.get(agentId);
    if (status) {
      status.lastDataReceived = new Date(dataPacket.timestamp);
      status.lastSeen = new Date();
      status.status = "online";
      status.connectionInfo.errorCount = 0;

      // Update database
      try {
        log.debug(`Updating agent status to online`, "AgentManager", {
          agentId,
        });
        const result = await this.db.run(
          "UPDATE systems SET status = $1, last_seen = CURRENT_TIMESTAMP, last_data_received = CURRENT_TIMESTAMP WHERE agent_id = $2",
          ["online", agentId]
        );
        log.trace(`Database status update complete`, "AgentManager", {
          agentId,
          rowsAffected: result.rowCount,
        });
      } catch (error) {
        log.error(`Failed to update agent status in database`, "AgentManager", {
          agentId,
          error,
        });
      }

      this.agentStatuses.set(agentId, status);
      this.emit("agentDataReceived", { agentId, dataPacket });
    } else {
      log.info(
        `⚠️  Agent status not found in memory for ${agentId}, skipping status update`,
        "AgentManager"
      );
      log.info(
        ` Available agents in memory: ${Array.from(
          this.agentStatuses.keys()
        ).join(", ")}`,
        "AgentManager"
      );
    }
  }

  /**
   * Mark agent as having an error
   */
  public markAgentError(agentId: string, error: string): void {
    const status = this.agentStatuses.get(agentId);
    if (status) {
      status.status = "error";
      status.connectionInfo.errorCount++;
      status.connectionInfo.lastError = error;
      status.lastSeen = new Date();

      this.agentStatuses.set(agentId, status);
      this.emit("agentError", { agentId, error });
    }
  }

  /**
   * Load agents from database on startup
   */
  public async loadAgentsFromDatabase(): Promise<void> {
    try {
      const systems = await this.db.all("SELECT * FROM systems");

      for (const system of systems) {
        const capabilities = system.capabilities || { sensors: [], fans: [] };

        const agentConfig: AgentConfig = {
          agentId: system.agent_id,
          name: system.name,
          version: system.agent_version || "1.0.0",
          apiEndpoint: system.api_endpoint,
          websocketEndpoint: system.websocket_endpoint,
          authToken: system.auth_token,
          updateInterval: 3000, // Default 3 seconds
          capabilities,
        };

        this.agents.set(agentConfig.agentId, agentConfig);

        // Initialize status as offline until we hear from them
        const status: AgentStatus = {
          agentId: system.agent_id,
          status: "offline",
          lastSeen: new Date(system.last_seen || Date.now()),
          lastDataReceived: new Date(system.last_data_received || Date.now()),
          connectionInfo: {
            apiEndpoint: system.api_endpoint,
            websocketEndpoint: system.websocket_endpoint,
            responseTime: 0,
            errorCount: 0,
          },
        };

        this.agentStatuses.set(agentConfig.agentId, status);

        // Initialize with default update interval from SST
        this.agentUpdateIntervals.set(agentConfig.agentId, defaultUpdateInterval);

        // Initialize ALL configuration Maps with default values from SST (ui-options.json)
        // This ensures all getters return actual values instead of fallback defaults
        if (!this.agentFanStep.has(agentConfig.agentId)) {
          this.agentFanStep.set(agentConfig.agentId, defaultFanStep);
        }
        if (!this.agentHysteresis.has(agentConfig.agentId)) {
          this.agentHysteresis.set(agentConfig.agentId, defaultHysteresis);
        }
        if (!this.agentEmergencyTemp.has(agentConfig.agentId)) {
          this.agentEmergencyTemp.set(agentConfig.agentId, defaultEmergencyTemp);
        }
      }

      log.info(
        ` Loaded ${systems.length} agents from database`,
        "AgentManager"
      );
    } catch (error) {
      log.error("Error loading agents from database:", "AgentManager", error);
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

    log.info(" Agent health checking started", "AgentManager");
  }

  /**
   * Perform health checks on all agents
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now();
    const timeout = 15000; // 15 seconds timeout (reduced from 60)

    for (const [agentId, status] of this.agentStatuses.entries()) {
      const timeSinceLastSeen = now - status.lastSeen.getTime();

      if (timeSinceLastSeen > timeout && status.status === "online") {
        // Mark as offline if we haven't heard from agent in timeout period
        status.status = "offline";
        this.agentStatuses.set(agentId, status);

        // Update database
        await this.db.run(
          "UPDATE systems SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE agent_id = $2",
          ["offline", agentId]
        );

        log.info(
          `⚠️  Agent ${agentId} marked as offline (last seen: ${status.lastSeen.toISOString()})`,
          "AgentManager"
        );
        this.emit("agentOffline", { agentId, status });
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
      log.info(" Agent health checking stopped", "AgentManager");
    }
  }

  /**
   * Set agent name
   */
  public async setAgentName(
    agentId: string,
    name: string,
    persist: boolean = false
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.name = name;
      this.agents.set(agentId, agent);
    }

    if (persist) {
      try {
        await this.db.run("UPDATE systems SET name = $1 WHERE agent_id = $2", [
          name,
          agentId,
        ]);
      } catch (error) {
        log.error(
          `Failed to persist name for ${agentId}`,
          "AgentManager",
          error
        );
      }
    }

    log.info(
      ` Agent ${agentId} name set to ${name} (persisted: ${persist})`,
      "AgentManager"
    );
    this.emit("agentConfigUpdated", { agentId, config: { name: name } });
  }

  /**
   * Extract IP address from endpoint URL
   */
  private extractIpFromEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      return url.hostname;
    } catch {
      return "unknown";
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
   * Get agents sorted by registration time (oldest first)
   * Uses cached order when available, refreshes from DB when cache is invalid
   */
  public async getAgentsByRegistrationOrder(): Promise<AgentConfig[]> {
    try {
      // Refresh cache if invalid
      if (!this.agentOrderCacheValid) {
        const systems = await this.db.all(
          "SELECT agent_id FROM systems ORDER BY created_at ASC"
        );
        this.cachedAgentOrder = systems.map(
          (s: { agent_id: string }) => s.agent_id
        );
        this.agentOrderCacheValid = true;
        log.debug("Agent order cache refreshed", "AgentManager");
      }

      // Return agents in cached order, only those currently in memory
      const orderedAgents: AgentConfig[] = [];
      for (const agentId of this.cachedAgentOrder) {
        const agent = this.agents.get(agentId);
        if (agent) {
          orderedAgents.push(agent);
        }
      }

      return orderedAgents;
    } catch (error) {
      log.error(
        "Error getting agents by registration order:",
        "AgentManager",
        error
      );
      // Fallback: return agents in arbitrary order
      return Array.from(this.agents.values());
    }
  }

  /**
   * Invalidate the agent order cache (call after register/unregister)
   */
  private invalidateAgentOrderCache(): void {
    this.agentOrderCacheValid = false;
  }

  /**
   * Check if agent is over the license limit (read-only mode)
   * Oldest registered agents have priority for full access
   */
  public async isAgentReadOnly(agentId: string): Promise<boolean> {
    try {
      const limit = await licenseManager.getAgentLimit();

      // Infinity means unlimited - never read-only
      if (limit === Infinity || limit === -1) {
        return false;
      }

      const sortedAgents = await this.getAgentsByRegistrationOrder();
      const index = sortedAgents.findIndex((a) => a.agentId === agentId);

      // Agent not found means it's not registered yet
      if (index === -1) {
        return false;
      }

      // Agents beyond the limit are read-only
      return index >= limit;
    } catch (error) {
      log.error(
        "Error checking agent read-only status:",
        "AgentManager",
        error
      );
      // On error, default to allowing control (fail open)
      return false;
    }
  }

  /**
   * Batch check which agents are read-only (optimized for listing)
   * Returns a Map of agentId -> isReadOnly
   */
  public async getAgentsReadOnlyStatus(): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();

    try {
      const limit = await licenseManager.getAgentLimit();

      // Unlimited tier - all agents have full access
      if (limit === Infinity || limit === -1) {
        for (const agentId of this.agents.keys()) {
          result.set(agentId, false);
        }
        return result;
      }

      const sortedAgents = await this.getAgentsByRegistrationOrder();

      sortedAgents.forEach((agent, index) => {
        result.set(agent.agentId, index >= limit);
      });

      return result;
    } catch (error) {
      log.error("Error getting batch read-only status:", "AgentManager", error);
      // On error, default to allowing control (fail open)
      for (const agentId of this.agents.keys()) {
        result.set(agentId, false);
      }
      return result;
    }
  }

  /**
   * Get agent limit info for UI display
   */
  public async getAgentLimitInfo(): Promise<{
    current: number;
    limit: number;
    overLimit: boolean;
  }> {
    const limit = await licenseManager.getAgentLimit();
    const current = this.agents.size;

    return {
      current,
      limit: limit === Infinity ? -1 : limit,
      overLimit: limit !== Infinity && current > limit,
    };
  }

  /**
   * Get agent current update interval
   */
  public getAgentUpdateInterval(agentId: string): number {
    return this.agentUpdateIntervals.get(agentId) ?? defaultUpdateInterval;
  }

  /**
   * Set agent current update interval
   */
  public async setAgentUpdateInterval(
    agentId: string,
    interval: number,
    persist: boolean = false
  ): Promise<void> {
    this.agentUpdateIntervals.set(agentId, interval);

    if (persist) {
      try {
        await this.db.run(
          "UPDATE systems SET config_data = jsonb_set(COALESCE(config_data, '{}'), '{update_interval}', $1::jsonb) WHERE agent_id = $2",
          [interval, agentId]
        );
      } catch (error) {
        log.error(
          `Failed to persist update_interval for ${agentId}`,
          "AgentManager",
          error
        );
      }
    }

    log.info(
      ` Agent ${agentId} update interval set to ${interval}s (persisted: ${persist})`,
      "AgentManager"
    );
    this.emit("agentConfigUpdated", {
      agentId,
      config: { current_update_interval: interval },
    });
  }

  /**
   * Get agent fan step percentage
   */
  public getAgentFanStep(agentId: string): number {
    return this.agentFanStep.get(agentId) ?? defaultFanStep;
  }

  /**
   * Set agent fan step percentage
   */
  public async setAgentFanStep(
    agentId: string,
    step: number,
    persist: boolean = false
  ): Promise<void> {
    this.agentFanStep.set(agentId, step);

    if (persist) {
      try {
        await this.db.run(
          "UPDATE systems SET config_data = jsonb_set(COALESCE(config_data, '{}'), '{fan_step_percent}', $1::jsonb) WHERE agent_id = $2",
          [step, agentId]
        );
      } catch (error) {
        log.error(
          `Failed to persist fan_step_percent for ${agentId}`,
          "AgentManager",
          error
        );
      }
    }

    log.info(
      ` Agent ${agentId} fan step set to ${step}% (persisted: ${persist})`,
      "AgentManager"
    );
    this.emit("agentConfigUpdated", {
      agentId,
      config: { fan_step_percent: step },
    });
  }

  /**
   * Get agent hysteresis temperature
   */
  public getAgentHysteresis(agentId: string): number {
    return this.agentHysteresis.get(agentId) ?? defaultHysteresis;
  }

  /**
   * Set agent hysteresis temperature
   */
  public async setAgentHysteresis(
    agentId: string,
    hysteresis: number,
    persist: boolean = false
  ): Promise<void> {
    this.agentHysteresis.set(agentId, hysteresis);

    if (persist) {
      try {
        await this.db.run(
          "UPDATE systems SET config_data = jsonb_set(COALESCE(config_data, '{}'), '{hysteresis_temp}', $1::jsonb) WHERE agent_id = $2",
          [hysteresis, agentId]
        );
      } catch (error) {
        log.error(
          `Failed to persist hysteresis_temp for ${agentId}`,
          "AgentManager",
          error
        );
      }
    }

    log.info(
      ` Agent ${agentId} hysteresis set to ${hysteresis}°C (persisted: ${persist})`,
      "AgentManager"
    );
    this.emit("agentConfigUpdated", {
      agentId,
      config: { hysteresis_temp: hysteresis },
    });
  }

  /**
   * Get agent emergency temperature
   */
  public getAgentEmergencyTemp(agentId: string): number {
    return this.agentEmergencyTemp.get(agentId) ?? defaultEmergencyTemp;
  }

  /**
   * Set agent emergency temperature
   */
  public async setAgentEmergencyTemp(
    agentId: string,
    temp: number,
    persist: boolean = false
  ): Promise<void> {
    this.agentEmergencyTemp.set(agentId, temp);

    if (persist) {
      try {
        await this.db.run(
          "UPDATE systems SET config_data = jsonb_set(COALESCE(config_data, '{}'), '{emergency_temp}', $1::jsonb) WHERE agent_id = $2",
          [temp, agentId]
        );
      } catch (error) {
        log.error(
          `Failed to persist emergency_temp for ${agentId}`,
          "AgentManager",
          error
        );
      }
    }

    log.info(
      ` Agent ${agentId} emergency temp set to ${temp}°C (persisted: ${persist})`,
      "AgentManager"
    );
    this.emit("agentConfigUpdated", {
      agentId,
      config: { emergency_temp: temp },
    });
  }

  /**
   * Get agent log level
   */
  public getAgentLogLevel(agentId: string): string {
    return this.agentLogLevel.get(agentId) || defaultLogLevel;
  }

  /**
   * Set agent log level
   */
  public async setAgentLogLevel(
    agentId: string,
    level: string,
    persist: boolean = false
  ): Promise<void> {
    this.agentLogLevel.set(agentId, level);

    if (persist) {
      try {
        await this.db.run(
          "UPDATE systems SET config_data = jsonb_set(COALESCE(config_data, '{}'), '{log_level}', $1::jsonb) WHERE agent_id = $2",
          [JSON.stringify(level), agentId] // JSON.stringify string values for jsonb
        );
      } catch (error) {
        log.error(
          `Failed to persist log_level for ${agentId}`,
          "AgentManager",
          error
        );
      }
    }

    log.info(
      ` Agent ${agentId} log level set to ${level} (persisted: ${persist})`,
      "AgentManager"
    );
    this.emit("agentConfigUpdated", { agentId, config: { log_level: level } });
  }

  /**
   * Get agent failsafe speed
   */
  public getAgentFailsafeSpeed(agentId: string): number {
    return this.agentFailsafeSpeed.get(agentId) ?? defaultFailsafeSpeed;
  }

  /**
   * Set agent failsafe speed
   */
  public async setAgentFailsafeSpeed(
    agentId: string,
    speed: number,
    persist: boolean = false
  ): Promise<void> {
    this.agentFailsafeSpeed.set(agentId, speed);

    if (persist) {
      try {
        await this.db.run(
          "UPDATE systems SET config_data = jsonb_set(COALESCE(config_data, '{}'), '{failsafe_speed}', $1::jsonb) WHERE agent_id = $2",
          [speed, agentId]
        );
      } catch (error) {
        log.error(
          `Failed to persist failsafe_speed for ${agentId}`,
          "AgentManager",
          error
        );
      }
    }

    log.info(
      ` Agent ${agentId} failsafe speed set to ${speed}% (persisted: ${persist})`,
      "AgentManager"
    );
    this.emit("agentConfigUpdated", {
      agentId,
      config: { failsafe_speed: speed },
    });
  }

  /**
   * Get agent enable fan control
   */
  public getAgentEnableFanControl(agentId: string): boolean {
    return this.agentEnableFanControl.get(agentId) ?? true; // Default true (enabled)
  }

  /**
   * Set agent enable fan control
   */
  public async setAgentEnableFanControl(
    agentId: string,
    enabled: boolean,
    persist: boolean = false
  ): Promise<void> {
    this.agentEnableFanControl.set(agentId, enabled);

    if (persist) {
      try {
        await this.db.run(
          "UPDATE systems SET config_data = jsonb_set(COALESCE(config_data, '{}'), '{enable_fan_control}', $1::jsonb) WHERE agent_id = $2",
          [enabled, agentId]
        );
      } catch (error) {
        log.error(
          `Failed to persist enable_fan_control for ${agentId}`,
          "AgentManager",
          error
        );
      }
    }

    log.info(
      ` Agent ${agentId} enable fan control set to ${enabled} (persisted: ${persist})`,
      "AgentManager"
    );
    this.emit("agentConfigUpdated", {
      agentId,
      config: { enable_fan_control: enabled },
    });
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.stopHealthChecking();
    this.removeAllListeners();
  }
}
