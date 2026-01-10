import WebSocket from "ws";
import { EventEmitter } from "events";
import {
  AgentConfig,
  AgentDataPacket,
  FanControlCommand,
  AgentStatus,
} from "../types/agent";
import { AgentManager } from "./AgentManager";
import { DataAggregator } from "./DataAggregator";
import { log } from "../utils/logger";

interface AgentConnection {
  agentId: string;
  websocket: WebSocket | null;
  lastPing: Date;
  reconnectAttempts: number;
  reconnectTimeout?: NodeJS.Timeout;
}

export class AgentCommunication extends EventEmitter {
  private static instance: AgentCommunication;
  private connections: Map<string, AgentConnection> = new Map();
  private agentManager: AgentManager;
  private dataAggregator: DataAggregator;
  private reconnectInterval = 3000; // 3 seconds (reduced)
  private maxReconnectAttempts = 10;
  private pingInterval = 15000; // 15 seconds (reduced from 30)
  private pingTimer?: NodeJS.Timeout;

  private constructor() {
    super();
    this.agentManager = AgentManager.getInstance();
    this.dataAggregator = DataAggregator.getInstance();
    this.startPingInterval();
  }

  public static getInstance(): AgentCommunication {
    if (!AgentCommunication.instance) {
      AgentCommunication.instance = new AgentCommunication();
    }
    return AgentCommunication.instance;
  }

  /**
   * Connect to an agent via WebSocket
   */
  public async connectToAgent(agentConfig: AgentConfig): Promise<void> {
    const { agentId, websocketEndpoint, authToken } = agentConfig;

    try {
      log.info(
        ` Connecting to agent ${agentId} at ${websocketEndpoint}`,
        "AgentCommunication"
      );

      const ws = new WebSocket(websocketEndpoint, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "User-Agent": "Pankha-Server/1.0.0",
        },
      });

      const connection: AgentConnection = {
        agentId,
        websocket: ws,
        lastPing: new Date(),
        reconnectAttempts: 0,
      };

      this.connections.set(agentId, connection);

      ws.on("open", () => {
        log.info(` Connected to agent ${agentId}`, "AgentCommunication");
        connection.reconnectAttempts = 0;

        // Clear any pending reconnection
        if (connection.reconnectTimeout) {
          clearTimeout(connection.reconnectTimeout);
          connection.reconnectTimeout = undefined;
        }

        this.emit("agentConnected", agentId);

        // Send initial ping
        this.sendPing(agentId);
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleAgentMessage(agentId, message);
        } catch (error) {
          log.error(
            `Failed to parse agent message - protocol violation`,
            "AgentCommunication",
            { agentId, error }
          );
        }
      });

      ws.on("close", (code, reason) => {
        log.info(
          ` Connection closed to agent ${agentId} (${code}: ${reason})`,
          "AgentCommunication"
        );
        this.handleDisconnection(agentId);
      });

      ws.on("error", (error) => {
        log.error(`WebSocket error for agent`, "AgentCommunication", {
          agentId,
          error: error.message,
        });
        this.agentManager.markAgentError(agentId, error.message);
        this.handleDisconnection(agentId);
      });

      ws.on("pong", () => {
        const connection = this.connections.get(agentId);
        if (connection) {
          connection.lastPing = new Date();
        }
      });
    } catch (error) {
      log.error(`Failed to connect to agent`, "AgentCommunication", {
        agentId,
        error,
      });
      throw error;
    }
  }

  /**
   * Disconnect from an agent
   */
  public async disconnectFromAgent(agentId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (connection) {
      if (connection.reconnectTimeout) {
        clearTimeout(connection.reconnectTimeout);
      }

      if (connection.websocket) {
        connection.websocket.close();
      }

      this.connections.delete(agentId);
      log.info(` Disconnected from agent ${agentId}`, "AgentCommunication");
      this.emit("agentDisconnected", agentId);
    }
  }

  /**
   * Send command to agent
   */
  public async sendCommand(
    agentId: string,
    command: FanControlCommand
  ): Promise<boolean> {
    const connection = this.connections.get(agentId);

    if (
      !connection ||
      !connection.websocket ||
      connection.websocket.readyState !== WebSocket.OPEN
    ) {
      log.error(
        `Cannot send command to agent ${agentId}: not connected`,
        "AgentCommunication"
      );
      return false;
    }

    try {
      const message = {
        type: "command",
        data: command,
      };

      connection.websocket.send(JSON.stringify(message));
      log.debug(`Command sent to agent`, "AgentCommunication", {
        agentId,
        commandType: command.type,
      });
      return true;
    } catch (error) {
      log.error(`Failed to send command to agent`, "AgentCommunication", {
        agentId,
        commandType: command.type,
        error,
      });
      return false;
    }
  }

  /**
   * Send command to all connected agents
   */
  public async broadcastCommand(
    command: Omit<FanControlCommand, "agentId">
  ): Promise<string[]> {
    const successfulAgents: string[] = [];

    for (const [agentId, connection] of this.connections.entries()) {
      if (
        connection.websocket &&
        connection.websocket.readyState === WebSocket.OPEN
      ) {
        const agentCommand: FanControlCommand = {
          ...command,
          agentId,
        };

        const success = await this.sendCommand(agentId, agentCommand);
        if (success) {
          successfulAgents.push(agentId);
        }
      }
    }

    return successfulAgents;
  }

  /**
   * Handle incoming message from agent
   */
  public async handleAgentMessage(
    agentId: string,
    message: any
  ): Promise<void> {
    try {
      log.trace(`Handling message from agent`, "AgentCommunication", {
        agentId,
        messageType: message.type,
      });
      switch (message.type) {
        case "data":
          // Real-time sensor and fan data
          log.debug(`Processing data packet from agent`, "AgentCommunication", {
            agentId,
          });
          const dataPacket: AgentDataPacket = message.data;
          await this.agentManager.updateAgentStatus(agentId, dataPacket);

          // Forward data to DataAggregator for API consumption
          await this.dataAggregator.updateSystemData(agentId, dataPacket);

          this.emit("agentData", { agentId, data: dataPacket });
          log.debug(`Data packet processed`, "AgentCommunication", { agentId });
          break;

        case "status":
          // Agent status update
          this.emit("agentStatusUpdate", { agentId, status: message.data });
          break;

        case "commandResponse":
        case "command_response":
          // Response to a command we sent
          this.emit("commandResponse", { agentId, response: message.data });
          break;

        case "error":
          // Error from agent
          log.error(`Agent reported error`, "AgentCommunication", {
            agentId,
            agentError: message.data,
          });
          this.agentManager.markAgentError(
            agentId,
            message.data.message || "Unknown error"
          );
          this.emit("agentError", { agentId, error: message.data });
          break;

        case "pong":
          // Response to ping
          const connection = this.connections.get(agentId);
          if (connection) {
            connection.lastPing = new Date();
          }
          break;

        case "updateConfig":
          // Handle explicit configuration update from agent (e.g. triggered by Tray App)
          if (message.data?.config) {
            log.info(
              `Received config update from agent ${agentId}`,
              "AgentCommunication"
            );
            const config = message.data.config;

            // Update individual settings and PERSIST to database
            if (config.update_interval !== undefined) {
              await this.agentManager.setAgentUpdateInterval(
                agentId,
                config.update_interval,
                true
              );
            }
            if (config.fan_step_percent !== undefined) {
              await this.agentManager.setAgentFanStep(
                agentId,
                config.fan_step_percent,
                true
              );
            }
            if (config.hysteresis_temp !== undefined) {
              await this.agentManager.setAgentHysteresis(
                agentId,
                config.hysteresis_temp,
                true
              );
            }
            if (config.emergency_temp !== undefined) {
              await this.agentManager.setAgentEmergencyTemp(
                agentId,
                config.emergency_temp,
                true
              );
            }
            if (config.log_level !== undefined) {
              await this.agentManager.setAgentLogLevel(
                agentId,
                config.log_level,
                true
              );
            }
            if (config.failsafe_speed !== undefined) {
              await this.agentManager.setAgentFailsafeSpeed(
                agentId,
                config.failsafe_speed,
                true
              );
            }
            if (config.enable_fan_control !== undefined) {
              await this.agentManager.setAgentEnableFanControl(
                agentId,
                config.enable_fan_control,
                true
              );
            }
            if (config.name !== undefined) {
              await this.agentManager.setAgentName(agentId, config.name, true);
            }
          }
          break;

        default:
          log.warn(`Unknown message type from agent`, "AgentCommunication", {
            agentId,
            messageType: message.type,
          });
      }
    } catch (error) {
      log.error(`Error handling agent message`, "AgentCommunication", {
        agentId,
        error,
      });
    }
  }

  /**
   * Handle agent disconnection
   */
  private handleDisconnection(agentId: string): void {
    const connection = this.connections.get(agentId);
    if (!connection) return;

    this.emit("agentDisconnected", agentId);

    // Mark agent as offline
    this.agentManager.markAgentError(agentId, "Connection lost");

    // Attempt reconnection if within limits
    if (connection.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnection(agentId);
    } else {
      log.error(
        ` Max reconnection attempts reached for agent ${agentId}`,
        "AgentCommunication"
      );
      this.connections.delete(agentId);
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(agentId: string): void {
    const connection = this.connections.get(agentId);
    if (!connection) return;

    connection.reconnectAttempts++;
    const delay =
      this.reconnectInterval *
      Math.pow(2, Math.min(connection.reconnectAttempts - 1, 5)); // Exponential backoff

    log.info(
      ` Scheduling reconnection to agent ${agentId} in ${delay}ms (attempt ${connection.reconnectAttempts})`,
      "AgentCommunication"
    );

    connection.reconnectTimeout = setTimeout(async () => {
      const agent = this.agentManager.getAgent(agentId);
      if (agent) {
        try {
          await this.connectToAgent(agent);
        } catch (error) {
          log.warn(
            `Reconnection attempt failed - will retry`,
            "AgentCommunication",
            { agentId, attempt: connection.reconnectAttempts, error }
          );
          this.scheduleReconnection(agentId);
        }
      }
    }, delay);
  }

  /**
   * Send ping to agent
   */
  private sendPing(agentId: string): void {
    const connection = this.connections.get(agentId);
    if (
      connection &&
      connection.websocket &&
      connection.websocket.readyState === WebSocket.OPEN
    ) {
      connection.websocket.ping();
    }
  }

  /**
   * Start ping interval for all connections
   */
  private startPingInterval(): void {
    this.pingTimer = setInterval(() => {
      for (const [agentId, connection] of this.connections.entries()) {
        if (
          connection.websocket &&
          connection.websocket.readyState === WebSocket.OPEN
        ) {
          this.sendPing(agentId);

          // Check if agent responded to last ping
          const timeSinceLastPing = Date.now() - connection.lastPing.getTime();
          if (timeSinceLastPing > this.pingInterval * 3) {
            // Increased tolerance from 2x to 3x
            log.warn(
              `⚠️  Agent ${agentId} not responding to pings, disconnecting...`,
              "AgentCommunication"
            );
            this.handleDisconnection(agentId);
          }
        }
      }
    }, this.pingInterval);
  }

  /**
   * Get connection status for all agents
   */
  public getConnectionStatuses(): {
    [agentId: string]: {
      connected: boolean;
      lastPing: Date;
      reconnectAttempts: number;
    };
  } {
    const statuses: {
      [agentId: string]: {
        connected: boolean;
        lastPing: Date;
        reconnectAttempts: number;
      };
    } = {};

    for (const [agentId, connection] of this.connections.entries()) {
      statuses[agentId] = {
        connected: connection.websocket?.readyState === WebSocket.OPEN,
        lastPing: connection.lastPing,
        reconnectAttempts: connection.reconnectAttempts,
      };
    }

    return statuses;
  }

  /**
   * Connect to all registered agents
   */
  public async connectToAllAgents(): Promise<void> {
    const agents = this.agentManager.getAgents();

    for (const agent of agents) {
      try {
        await this.connectToAgent(agent);
      } catch (error) {
        log.warn(
          `Failed to connect to agent during bulk connection`,
          "AgentCommunication",
          { agentId: agent.agentId, error }
        );
      }
    }
  }

  /**
   * Disconnect from all agents
   */
  public async disconnectFromAllAgents(): Promise<void> {
    const agentIds = Array.from(this.connections.keys());

    for (const agentId of agentIds) {
      await this.disconnectFromAgent(agentId);
    }
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }

    this.disconnectFromAllAgents();
    this.removeAllListeners();
  }
}
