import WebSocket, { WebSocketServer } from "ws";
import { EventEmitter } from "events";
import { IncomingMessage, Server } from "http";
import { DataAggregator } from "./DataAggregator";
import { AgentManager } from "./AgentManager";
import { CommandDispatcher } from "./CommandDispatcher";
import { AgentCommunication } from "./AgentCommunication";
import { FanProfileController } from "./FanProfileController";
import { CalibrationService } from "./CalibrationService";
import { DeltaComputer } from "./DeltaComputer";
import Database from "../database/database";
import type { AggregatedSystemData } from "../types/aggregatedData";
import { licenseManager } from "../license";
import { log } from "../utils/logger";
import { SESSION_COOKIE, parseCookieHeader, verifySession } from "../auth/session";
import { mintAgentToken, hashAgentToken, verifyAgentToken } from "../auth/tokens";
import { isValidDeployToken } from "../auth/enrollment";
import { UpdateDownloadService } from "./UpdateDownloadService";
import { compareSemver } from "../utils/version";
import { 
  defaultUpdateInterval, 
  defaultFanStep, 
  defaultHysteresis, 
  defaultEmergencyTemp, 
  defaultLogLevel,
  defaultFailsafeSpeed,
  validUpdateIntervals,
  validFanSteps,
  validHysteresis,
  validEmergencyTemps,
  validLogLevels,
  validFailsafeSpeeds
} from '../config/uiOptions';

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
    // Session-verified dashboard connection. Connections start unclassified;
    // isFrontend is granted by a valid session cookie at upgrade, isAgent by
    // an authenticated register message. Neither = no data flows.
    isFrontend?: boolean;
    username?: string;
  };
}

interface WebSocketMessage {
  type: string;
  data?: any;
  subscriptions?: string[];
  clientId?: string;
}

// Credential-less agent held for admin approval. Lives in memory only,
// tied to its connection; no systems row, no license seat, telemetry ignored.
interface PendingAgent {
  clientId: string;
  registrationData: any;
  agentId: string;
  name: string;
  ip?: string;
  agentType?: string;
  platform?: string;
  version?: string;
  reason: string;
  requestedAt: string;
}

// Max agents held awaiting approval at once (memory + card-spam bound); raise for large enrollments.
const MAX_PENDING_AGENTS = (() => {
  const raw = (process.env.PANKHA_MAX_PENDING_AGENTS ?? '').trim();
  if (!raw) return 20;
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    log.warn(`PANKHA_MAX_PENDING_AGENTS ignored - expected a positive integer, got "${raw}". Using 20.`, 'websocket');
    return 20;
  }
  return n;
})();

// Oldest agent build that can store a pushed auth token. Approving an older
// Linux/IPMI agent chains a self-update first; its token is pushed after it
// reconnects on the new build.
const MIN_TOKEN_CAPABLE_AGENT_VERSION = "v0.6.3";

// How long an updating agent has to reconnect before it must pend again.
const UPDATE_RECONNECT_WINDOW_MS = 300_000;

export class WebSocketHub extends EventEmitter {
  private static instance: WebSocketHub;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  // Reverse lookup of subscription -> subscribed clientIds, so broadcast() can
  // reach a channel's subscribers without scanning every connection. Mirrors
  // the per-client `subscriptions` Sets; keep them in sync only through
  // add/removeClientSubscription and removeClientFromIndex.
  private subscriptionIndex: Map<string, Set<string>> = new Map();
  // agentId -> pending-approval entry
  private pendingAgents: Map<string, PendingAgent> = new Map();
  // Approve-and-update in flight: agentId -> reconnect window (same source IP)
  private updateReconnectTickets: Map<string, { ip?: string; deadline: number }> =
    new Map();
  private dataAggregator: DataAggregator;
  private agentManager: AgentManager;
  private commandDispatcher: CommandDispatcher;
  private agentCommunication: AgentCommunication;
  private deltaComputer: DeltaComputer;
  private pingInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.dataAggregator = DataAggregator.getInstance();
    this.agentManager = AgentManager.getInstance();
    this.commandDispatcher = CommandDispatcher.getInstance();
    this.agentCommunication = AgentCommunication.getInstance();
    this.deltaComputer = new DeltaComputer();

    this.setupEventListeners();
  }

  public static getInstance(): WebSocketHub {
    if (!WebSocketHub.instance) {
      WebSocketHub.instance = new WebSocketHub();
    }
    return WebSocketHub.instance;
  }

  /**
   * Initialize WebSocket server by attaching to an existing HTTP server
   */
  public initialize(server: Server): void {
    this.wss = new WebSocketServer({
      server,
      path: "/websocket",
      perMessageDeflate: false, // Disable compression for real-time updates
    });

    this.wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      this.handleNewConnection(ws, request).catch((error) => {
        log.error("Failed to handle new WebSocket connection", "WebSocketHub", error);
        ws.close();
      });
    });

    this.startPingInterval();
    this.startCleanupInterval();

    log.info(" WebSocket server initialized via unified port architecture", "WebSocketHub");
  }

  /**
   * Setup event listeners for data updates
   */
  private setupEventListeners(): void {
    // Listen for aggregated data updates - use delta optimization
    this.dataAggregator.on("dataAggregated", async (data: AggregatedSystemData) => {
      const delta = this.deltaComputer.computeDelta(data.agentId, data);
      
      // Calculate real-time global overview stats on every tick
      const overviewStats = this.dataAggregator.getSystemOverview();

      if (delta) {
        // Send delta update (changed values only)
        // Delta updates only need the changing overview stats (temperatures, counts)
        this.broadcast("systemDelta", { ...delta, overview: overviewStats }, [
          `system:${data.agentId}`,
          "systems:all",
        ]);
      } else {
        // First update for this agent - send full state in frontend-compatible shape
        try {
          const system = await this.getSystemRecordByAgentId(data.agentId);
          if (!system) {
            log.warn(
              `Skipping first-update fullState for unknown agent: ${data.agentId}`,
              "WebSocketHub"
            );
            return;
          }

          const readOnlyStatus = await this.agentManager.getAgentsReadOnlyStatus();
          const normalizedSystem = this.buildEnhancedSystemState(
            system,
            data,
            readOnlyStatus.get(data.agentId) || false
          );

          // Add license limit info ONLY to fullState (less frequent) to save DB/memory lookups
          const tier = await licenseManager.getCurrentTier();
          const agentLimit = tier.agentLimit;
          const isUnlimited = agentLimit === Infinity;
          
          const fullOverview = {
            ...overviewStats,
            agentLimit: isUnlimited ? 'unlimited' : agentLimit,
            overLimit: !isUnlimited && overviewStats.totalSystems > agentLimit,
            tierName: tier.name
          };

          this.broadcast(
            "fullState",
            { systems: [normalizedSystem], overview: fullOverview },
            [`system:${data.agentId}`, "systems:all"]
          );
        } catch (error) {
          log.error(
            `Failed to build first-update fullState for agent ${data.agentId}`,
            "WebSocketHub",
            error
          );
        }
      }
    });

    this.dataAggregator.on("systemOffline", (data) => {
      // Clear delta state when agent goes offline
      this.deltaComputer.clearAgentState(data.agentId);
      this.broadcast("systemOffline", data, [
        `system:${data.agentId}`,
        "systems:all",
      ]);
    });

    // Clear delta state when agent disconnects (manual disconnect or reconnect)
    // This ensures the first update after reconnection sends full state with all enriched data
    this.agentCommunication.on("agentDisconnected", (agentId: string) => {
      log.info(
        `Agent disconnected, clearing delta state for: ${agentId}`,
        "WebSocketHub"
      );
      this.deltaComputer.clearAgentState(agentId);
    });

    // Listen for agent events
    this.agentManager.on("agentRegistered", (agent) => {
      // Broadcast to both agents:all AND systems:all so frontend (subscribed to systems:all) receives the event
      // This ensures frontend can request full sync immediately when agent reconnects
      this.broadcast("agentRegistered", agent, ["agents:all", "systems:all"]);
    });

    this.agentManager.on("agentUnregistered", (event) => {
      // Broadcast to systems:all so frontend sees when agents stop/unregister
      this.broadcast("agentUnregistered", event, ["agents:all", "systems:all"]);
    });

    this.agentManager.on("agentError", (event) => {
      // Broadcast to systems:all so frontend sees agent errors and status changes
      this.broadcast("agentError", event, [
        `system:${event.agentId}`,
        "agents:all",
        "systems:all",
      ]);
    });

    this.agentManager.on("agentRecovered", (event) => {
      this.broadcast("agentRecovered", event, [
        `system:${event.agentId}`,
        "agents:all",
        "systems:all",
      ]);
    });

    this.agentManager.on("agentConfigUpdated", (event) => {
      // Broadcast config updates so frontend reflects changes immediately
      this.broadcast("agentConfigUpdated", event, [
        `system:${event.agentId}`,
        "systems:all",
      ]);
    });

    // Stall watchdog events: calibrated fan commanded above min_stop
    // but tach reads 0. Detection-only - frontend surfaces a stalled state.
    const fanProfileController = FanProfileController.getInstance();
    fanProfileController.on("fanStalled", (event) => {
      this.broadcast("fanStalled", event, [
        `system:${event.agentId}`,
        "systems:all",
      ]);
    });
    fanProfileController.on("fanStallCleared", (event) => {
      this.broadcast("fanStallCleared", event, [
        `system:${event.agentId}`,
        "systems:all",
      ]);
    });

    // Calibration lifecycle events: pending/running/done/failed/no_tach
    const calibrationService = CalibrationService.getInstance();
    calibrationService.on("fanCalibrationStatus", (event) => {
      this.broadcast("fanCalibrationStatus", event, [
        `system:${event.agentId}`,
        "systems:all",
      ]);
    });

    // Listen for command events
    this.commandDispatcher.on("commandCompleted", (event) => {
      this.broadcast("commandCompleted", event, [
        `system:${event.command.agentId}`,
        "commands:all",
      ]);
    });

    this.commandDispatcher.on("commandFailed", (event) => {
      this.broadcast("commandFailed", event, [
        `system:${event.command.agentId}`,
        "commands:all",
      ]);
    });

    // License changed (autonomous renewal pickup, manual activate/remove): tell
    // clients to refetch /api/license so an always-open screen updates without a
    // reload. Same push channel the dashboard already uses for live data.
    licenseManager.on("licenseUpdated", () => {
      this.broadcast("licenseUpdated", {}, ["systems:all"]);
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleNewConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
    const clientId = this.generateClientId();
    const userAgent = request.headers["user-agent"] || "";

    // Classification is credential-based: a valid session cookie on the
    // upgrade request marks a frontend connection; agents earn isAgent via an
    // authenticated register message. Unclassified connections receive
    // nothing and may only register or ping.
    const cookies = parseCookieHeader(request.headers.cookie);
    const session = cookies[SESSION_COOKIE]
      ? await verifySession(cookies[SESSION_COOKIE])
      : null;
    const isFrontend = !!session;

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
        isAgent: false,
        isFrontend,
        username: session?.user.username,
      },
    };

    this.clients.set(clientId, client);

    if (!isFrontend) {
      log.info(
        ` New unclassified WebSocket connected (agent register or login pending): ${clientId} (${client.metadata.ip})`,
        "WebSocketHub"
      );
    } else {
      log.info(
        ` New FRONTEND WebSocket connected: ${clientId} (${client.metadata.ip}, user: ${session!.user.username})`,
        "WebSocketHub"
      );

      // Send welcome message to frontend clients only
      this.sendToClient(clientId, "connected", {
        clientId,
        serverTime: new Date().toISOString(),
        availableSubscriptions: this.getAvailableSubscriptions(),
      });
    }

    // Setup message handler
    ws.on("message", async (data: WebSocket.Data) => {
      await this.handleClientMessage(clientId, data);
    });

    // Handle disconnection
    ws.on("close", () => {
      this.handleClientDisconnection(clientId);
    });

    // Handle errors
    ws.on("error", (error) => {
      log.error(
        `WebSocket error for client ${clientId}`,
        "WebSocketHub",
        error
      );
      this.handleClientDisconnection(clientId);
    });

    // Handle pong responses
    ws.on("pong", () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastActivity = new Date();
      }
    });

    this.emit("clientConnected", { clientId, client });
  }

  /**
   * Handle client disconnection
   */
  private async handleClientDisconnection(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (client) {
      // Check if this is an agent disconnection
      if (client.metadata.isAgent && client.metadata.agentId) {
        const agentId = client.metadata.agentId;
        log.info(
          `Agent disconnected via WebSocket: ${agentId} (${clientId})`,
          "WebSocketHub"
        );

        const currentStatus = this.agentManager.getAgentStatus(agentId);
        const isError = currentStatus?.status === "error";

        if (isError) {
          log.info(
            `Agent ${agentId} disconnected while in error state - preserving error status`,
            "WebSocketHub"
          );
        } else {
          this.agentManager.markAgentOffline(agentId);

          const db = Database.getInstance();
          const presenceHeartbeatSeconds = Math.max(
            5,
            parseInt(
              process.env.DB_SYSTEM_PRESENCE_HEARTBEAT_SECONDS ||
                process.env.DB_TELEMETRY_HEARTBEAT_SECONDS ||
                "15",
              10
            ) || 15
          );
          await db
            .run(
              `UPDATE systems
               SET status = $1, last_seen = CURRENT_TIMESTAMP
               WHERE agent_id = $2
                 AND (
                   status IS DISTINCT FROM $1
                   OR last_seen IS NULL
                   OR last_seen < CURRENT_TIMESTAMP - ($3 * INTERVAL '1 second')
                 )`,
              ["offline", agentId, presenceHeartbeatSeconds]
            )
            .catch((err) => {
              log.error(
                `Failed to update agent status in database`,
                "WebSocketHub",
                { agentId, error: err }
              );
            });

          this.broadcast("systemOffline", { agentId }, [
            `system:${agentId}`,
            "systems:all",
          ]);
        }

        this.deltaComputer.clearAgentState(agentId);

        log.info(
          `Agent ${agentId} disconnected, delta state cleared (status: ${isError ? "error" : "offline"})`,
          "WebSocketHub"
        );
      } else {
        log.info(` Frontend client disconnected: ${clientId}`, "WebSocketHub");
      }

      // Pending-approval entries live with their connection
      for (const [agentId, entry] of this.pendingAgents) {
        if (entry.clientId === clientId) {
          this.pendingAgents.delete(agentId);
          this.broadcast("agentPendingRemoved", { agentId }, [
            "agents:all",
            "systems:all",
          ]);
          log.info(
            `Pending agent ${agentId} disconnected before approval`,
            "WebSocketHub"
          );
        }
      }

      this.removeClientFromIndex(client); // before removing the client itself
      this.clients.delete(clientId);
      this.emit("clientDisconnected", { clientId, client });
    }
  }

  /**
   * Handle incoming message from client
   */
  private async handleClientMessage(
    clientId: string,
    data: WebSocket.Data
  ): Promise<void> {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      log.trace(`RAW MESSAGE received`, "WebSocketHub", {
        clientId,
        messageType: message.type,
      });
      const client = this.clients.get(clientId);

      if (!client) return;

      client.lastActivity = new Date();

      // Dashboard data flows only to session-verified connections. 4401 lets
      // the frontend distinguish "log in again" from a network drop.
      const FRONTEND_MESSAGES = [
        "subscribe",
        "unsubscribe",
        "requestFullSync",
        "getSystemData",
        "getOverview",
      ];
      if (FRONTEND_MESSAGES.includes(message.type) && !client.metadata.isFrontend) {
        log.warn(
          `Unauthenticated client ${clientId} sent ${message.type} - closing`,
          "WebSocketHub"
        );
        client.websocket.close(4401, "authentication required");
        return;
      }

      switch (message.type) {
        case "subscribe":
          await this.handleSubscription(
            clientId,
            message.data?.subscriptions || message.subscriptions || []
          );
          break;

        case "unsubscribe":
          this.handleUnsubscription(
            clientId,
            message.data?.subscriptions || message.subscriptions || []
          );
          break;

        case "requestFullSync":
          await this.handleFullSyncRequest(clientId);
          break;

        case "getSystemData":
          this.handleGetSystemData(clientId, message.data?.agentId);
          break;

        case "getOverview":
          this.handleGetOverview(clientId);
          break;

        case "ping":
          this.sendToClient(clientId, "pong", { timestamp: Date.now() });
          break;

        case "data":
          // Handle agent data messages
          const dataClient = this.clients.get(clientId);
          if (dataClient?.metadata.isAgent) {
            log.trace(`Received AGENT data`, "WebSocketHub", {
              clientId,
              dataSize: JSON.stringify(message.data).length,
            });
            if (message.data?.agentId) {
              log.debug(`Processing agent data`, "WebSocketHub", {
                agentId: message.data.agentId,
              });
              // Process agent data directly through AgentCommunication
              const agentMessage = {
                type: "data",
                data: message.data,
              };
              await this.agentCommunication.handleAgentMessage(
                message.data.agentId,
                agentMessage
              );
            } else {
              log.warn(`Agent data missing agentId`, "WebSocketHub", {
                clientId,
              });
            }
          } else {
            log.trace(`Received FRONTEND data (ignoring)`, "WebSocketHub", {
              clientId,
            });
          }
          break;

        case "register":
          // Handle agent registration via WebSocket
          await this.handleAgentRegistration(clientId, message.data);
          break;

        case "updateConfig":
          // Handle agent config update via WebSocket
          const configClient = this.clients.get(clientId);
          if (configClient?.metadata.isAgent && message.data?.config) {
            const agentId =
              message.data.agentId || configClient.metadata.agentId;
            if (agentId) {
              log.info(
                `Received config update via WebSocket for ${agentId}`,
                "WebSocketHub"
              );
              // Forward to AgentCommunication
              const agentMessage = {
                type: "updateConfig",
                data: message.data,
              };
              await this.agentCommunication.handleAgentMessage(
                agentId,
                agentMessage
              );
            }
          }
          break;

        case "error":
          // Agent is reporting an init/runtime error (e.g. IPMI profile
          // mismatch, OS agent sysfs permission failure). Forward to
          // AgentCommunication so markAgentError fires and the frontend
          // shows the red Error badge with the reported reason.
          const errorClient = this.clients.get(clientId);
          if (errorClient?.metadata.isAgent && errorClient.metadata.agentId) {
            await this.agentCommunication.handleAgentMessage(
              errorClient.metadata.agentId,
              { type: "error", data: message.data }
            );
          }
          break;

        case "commandResponse":
          // Handle command response from agent
          const commandClient = this.clients.get(clientId);
          if (commandClient?.metadata.isAgent && (message as any).commandId) {
            log.debug(`Command response received`, "WebSocketHub", {
              agentId: commandClient.metadata.agentId,
              commandId: (message as any).commandId,
              success: (message as any).success,
            });
            // Forward to CommandDispatcher to handle response
            this.agentCommunication.emit("commandResponse", {
              agentId: commandClient.metadata.agentId,
              response: message,
            });
          }
          break;

        default:
          log.warn(
            `Unknown message type from client ${clientId}: ${message.type}`,
            "WebSocketHub"
          );
      }
    } catch (error) {
      log.error(
        `Error parsing message from client ${clientId}`,
        "WebSocketHub",
        error
      );
    }
  }

  /**
   * Handle client subscription
   */
  private async handleSubscription(
    clientId: string,
    subscriptions: string[]
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const subscription of subscriptions) {
      this.addClientSubscription(client, subscription);
    }

    log.info(
      ` Client ${clientId} subscribed to: ${subscriptions.join(", ")}`,
      "WebSocketHub"
    );

    this.sendToClient(clientId, "subscribed", {
      subscriptions: Array.from(client.subscriptions),
    });

    // Send initial data for subscriptions
    await this.sendInitialDataForSubscriptions(clientId, subscriptions);
  }

  /**
   * Handle agent registration via WebSocket
   */
  private async handleAgentRegistration(
    clientId: string,
    registrationData: any,
    // Set only by approvePendingAgent: admin vouched, so skip the credential tree and push a token.
    preApproved: boolean = false,
    // Old build that can't store a token yet: self-update it instead of pushing one.
    chainSelfUpdate: boolean = false
  ): Promise<void> {
    try {
      log.info(
        `Agent registration via WebSocket ${clientId}:`,
        registrationData?.name || registrationData?.agentId
      );

      if (!registrationData?.agentId) {
        log.error(
          ` Agent registration missing agentId from ${clientId}`,
          "WebSocketHub"
        );
        this.sendToClient(clientId, "registrationError", {
          error: "Missing agentId",
        });
        return;
      }

      const agentId = registrationData.agentId;
      const client = this.clients.get(clientId);

      if (client?.metadata.isFrontend) {
        this.sendToClient(clientId, "registrationError", {
          error: "Frontend connections cannot register as agents",
        });
        return;
      }

      // Credential decision tree (single door):
      //   auth_token + stored hash        -> verify or close
      //   enrollment_token valid          -> exchange for a minted token
      //   anything else, known or unknown -> hold as pending-approval card
      let mintedToken: string | null = null; // returned in the registered response

      if (!preApproved) {
        const db2 = Database.getInstance();
        const existing = await db2.get(
          "SELECT auth_token_hash FROM systems WHERE agent_id = $1",
          [agentId]
        );
        const presentedToken = registrationData.auth_token;
        const presentedEnrollment = registrationData.enrollment_token;

        if (existing?.auth_token_hash) {
          if (!verifyAgentToken(presentedToken, existing.auth_token_hash)) {
            // A failed credential counts as impersonation only while the
            // real agent is connected; otherwise hold for approval so the
            // admin can reissue a token.
            const liveConflict = Array.from(this.clients.entries()).some(
              ([cid, c]) =>
                cid !== clientId &&
                c.metadata.isAgent &&
                c.metadata.agentId === agentId
            );
            if (liveConflict) {
              log.warn(
                `Agent ${agentId} presented ${presentedToken ? "an invalid" : "no"} auth token while an authenticated connection is online - rejecting (possible impersonation)`,
                "WebSocketHub"
              );
              this.sendToClient(clientId, "registrationError", {
                error: "Agent token rejected",
              });
              this.clients.get(clientId)?.websocket.close(4403, "agent token rejected");
              return;
            }
            // An approved-with-update agent reconnects tokenless even when an
            // old hash exists; a valid window ticket completes the approval.
            if (this.redeemUpdateTicket(agentId, client?.metadata.ip)) {
              preApproved = true;
            } else {
              const reason = presentedToken
                ? "Secured system presented an invalid token - approve to issue a new one"
                : presentedEnrollment
                  ? (await isValidDeployToken(presentedEnrollment))
                    ? "Secured system reinstalled with a valid install token - approve to issue a new one"
                    : "Secured system presented an expired install token - approve to issue a new one"
                  : "Secured system reconnected without its token - approve to issue a new one";
              this.holdPendingAgent(clientId, registrationData, reason);
              return;
            }
          }
        } else {
          // No stored token (known or unknown): a valid enrollment token auto-enrolls (script flow); anything else is held for admin approval.
          if (presentedEnrollment && (await isValidDeployToken(presentedEnrollment))) {
            mintedToken = mintAgentToken();
          } else {
            // An agent the admin just approved-with-update reconnects here
            // tokenless; inside its window and from the same address, the
            // approval completes without a second click.
            if (this.redeemUpdateTicket(agentId, client?.metadata.ip)) {
              preApproved = true;
            }
            if (!preApproved) {
              const reason = presentedEnrollment
                ? "Install token expired - approve on the dashboard or run a fresh install script"
                : existing
                  ? "Existing agent has no token yet - approve to migrate it"
                  : "Registered without credentials - approve on the dashboard";
              this.holdPendingAgent(clientId, registrationData, reason);
              return;
            }
          }
        }
      }

      // Mark this client as an agent connection
      if (client) {
        client.metadata.agentId = agentId;
        client.metadata.isAgent = true;
        log.info(
          ` WebSocket client ${clientId} marked as agent ${agentId}`,
          "WebSocketHub"
        );
      }

      // Create agent configuration for AgentManager
      const agentConfig = {
        agentId: agentId,
        name: registrationData.name || agentId,
        agentType: registrationData.agent_type, // "os_linux", "os_windows", "ipmi_host", "ipmi_network"
        profileId: registrationData.profile_id, // BMC profile ID self-reported by IPMI agents
        version: registrationData.agent_version || "1.0.0-websocket",
        platform: registrationData.platform || "unknown", // "linux", "windows", "macos"
        architecture: registrationData.architecture, // "x64", "arm64"
        apiEndpoint: `http://${client?.metadata.ip || "unknown"}:8080`, // Mock endpoint
        websocketEndpoint: `ws://${client?.metadata.ip || "unknown"}:8081`, // Mock endpoint
        updateInterval: registrationData.update_interval || 3000, // From client config or default
        capabilities: registrationData.capabilities || {
          sensors: [],
          fans: [],
        },
      };

      // Register agent with AgentManager
      try {
        await this.agentManager.registerAgent(agentConfig);
        log.info(
          ` Agent ${agentId} registered successfully via WebSocket`,
          "WebSocketHub"
        );

        // Load saved configuration from database
        const db = Database.getInstance();
        const system = await db.get(
          "SELECT config_data FROM systems WHERE agent_id = $1",
          [agentId]
        );
        const savedConfig = system?.config_data || {};

        const regInterval = registrationData.update_interval;
        const normalizedRegInterval = regInterval > 100 ? Math.round(regInterval / 1000) : regInterval;

        // Helper to get strictly validated value from savedConfig -> registration -> default
        const getValid = <T>(key: string, saved: T | undefined, reg: T | undefined, validArray: T[], defaultValue: T): T => {
          if (saved !== undefined && validArray.includes(saved)) return saved;
          if (reg !== undefined && validArray.includes(reg)) return reg;
          return defaultValue;
        };

        const finalConfig = {
          update_interval: getValid(
            'updateInterval',
            savedConfig.update_interval,
            normalizedRegInterval,
            validUpdateIntervals,
            defaultUpdateInterval
          ),
          fan_step_percent: getValid(
            'fanStep',
            savedConfig.fan_step_percent,
            registrationData.fan_step_percent,
            validFanSteps,
            defaultFanStep
          ),
          hysteresis_temp: getValid(
            'hysteresis',
            savedConfig.hysteresis_temp,
            registrationData.hysteresis_temp,
            validHysteresis,
            defaultHysteresis
          ),
          emergency_temp: getValid(
            'emergencyTemp',
            savedConfig.emergency_temp,
            registrationData.emergency_temp,
            validEmergencyTemps,
            defaultEmergencyTemp
          ),
          log_level: getValid(
            'logLevel',
            savedConfig.log_level?.toUpperCase(),
            registrationData.log_level?.toUpperCase(),
            validLogLevels,
            defaultLogLevel
          ),
          failsafe_speed: getValid(
            'failsafeSpeed',
            savedConfig.failsafe_speed,
            registrationData.failsafe_speed,
            validFailsafeSpeeds,
            defaultFailsafeSpeed
          ),
          // Shared Consent Logic for fan control: 
          // If the agent reports false (local override), the system stays false.
          // Otherwise, we use the saved database configuration or system default.
          enable_fan_control: (registrationData.capabilities?.fan_control === false)
            ? false
            : (savedConfig.enable_fan_control ?? true),
        };

        // Set configuration in AgentManager
        if (finalConfig.update_interval !== undefined) {
          this.agentManager.setAgentUpdateInterval(
            agentId,
            finalConfig.update_interval
          );
          log.info(
            ` Agent ${agentId} update interval: ${finalConfig.update_interval}s`,
            "WebSocketHub"
          );
        }
        if (finalConfig.fan_step_percent !== undefined) {
          this.agentManager.setAgentFanStep(
            agentId,
            finalConfig.fan_step_percent
          );
          log.info(
            ` Agent ${agentId} fan step: ${finalConfig.fan_step_percent}%`,
            "WebSocketHub"
          );
        }
        if (finalConfig.hysteresis_temp !== undefined) {
          this.agentManager.setAgentHysteresis(
            agentId,
            finalConfig.hysteresis_temp
          );
          log.info(
            ` Agent ${agentId} hysteresis: ${finalConfig.hysteresis_temp}°C`,
            "WebSocketHub"
          );
        }
        if (finalConfig.emergency_temp !== undefined) {
          this.agentManager.setAgentEmergencyTemp(
            agentId,
            finalConfig.emergency_temp
          );
          log.info(
            ` Agent ${agentId} emergency temp: ${finalConfig.emergency_temp}°C`,
            "WebSocketHub"
          );
        }
        if (finalConfig.log_level !== undefined) {
          this.agentManager.setAgentLogLevel(agentId, finalConfig.log_level);
          log.info(
            ` Agent ${agentId} log level: ${finalConfig.log_level}`,
            "WebSocketHub"
          );
        }
        if (finalConfig.failsafe_speed !== undefined) {
          this.agentManager.setAgentFailsafeSpeed(agentId, finalConfig.failsafe_speed);
          log.info(
            ` Agent ${agentId} failsafe speed: ${finalConfig.failsafe_speed}%`,
            "WebSocketHub"
          );
        }
        if (finalConfig.enable_fan_control !== undefined) {
          this.agentManager.setAgentEnableFanControl(agentId, finalConfig.enable_fan_control);
          log.info(
            ` Agent ${agentId} enable fan control: ${finalConfig.enable_fan_control} (Shared Consent)`,
            "WebSocketHub"
          );
        }

        // Enrollment: persist the token hash now that the systems row exists,
        // and hand the plaintext to the agent inside the registered response
        // (the agent persists it and drops its enrollment_token).
        if (mintedToken) {
          await db.run(
            "UPDATE systems SET auth_token_hash = $1 WHERE agent_id = $2",
            [hashAgentToken(mintedToken), agentId]
          );
          log.info(`Agent ${agentId} enrolled - auth token issued`, "WebSocketHub");
          // Clear the Unsecured badge live
          this.agentManager.emit("agentConfigUpdated", {
            agentId,
            config: { unsecured: false },
          });
        }

        // Send registration confirmation with configuration
        this.sendToClient(clientId, "registered", {
          agentId: agentId,
          status: "success",
          message: "Agent registered successfully",
          timestamp: new Date().toISOString(),
          configuration: finalConfig, // Send configuration to agent so it can apply it
          ...(mintedToken ? { auth_token: mintedToken } : {}),
        });

        if (preApproved && chainSelfUpdate) {
          // Update the old build first; the reconnect on the new binary
          // completes the approval and receives the token.
          const staged = UpdateDownloadService.getInstance().getLocalStatus().version;
          const sourceIp = this.clients.get(clientId)?.metadata.ip;
          this.updateReconnectTickets.set(agentId, {
            ip: sourceIp,
            deadline: Date.now() + UPDATE_RECONNECT_WINDOW_MS,
          });
          setTimeout(() => {
            this.commandDispatcher
              .sendCommand(agentId, "selfUpdate", { version: staged }, "normal")
              .then(() => {
                log.info(
                  `Agent ${agentId} accepted update to ${staged} - expecting reconnect from ${sourceIp} within ${UPDATE_RECONNECT_WINDOW_MS / 1000}s`,
                  "WebSocketHub"
                );
                // Let dashboards show UPDATING instead of a bare offline
                this.broadcast(
                  "agentUpdating",
                  { agentId, version: staged, windowMs: UPDATE_RECONNECT_WINDOW_MS },
                  ["agents:all", "systems:all"]
                );
              })
              .catch((err) => {
                this.updateReconnectTickets.delete(agentId);
                log.warn(
                  `Agent ${agentId} did not accept selfUpdate: ${err?.message ?? err}`,
                  "WebSocketHub"
                );
              });
          }, 2000);
        }

        // Approved agent: push its permanent token. Hash commits only on the agent's ack, so pre-auth binaries stay connectable (shown Unsecured) until self-update.
        if (preApproved && !chainSelfUpdate) {
          const approvalToken = mintAgentToken();
          setTimeout(() => {
            this.commandDispatcher
              .sendCommand(agentId, "setAuthToken", { authToken: approvalToken })
              .then(async () => {
                await db.run(
                  "UPDATE systems SET auth_token_hash = $1 WHERE agent_id = $2",
                  [hashAgentToken(approvalToken), agentId]
                );
                log.info(`Agent ${agentId} secured via setAuthToken`, "WebSocketHub");
                // Clear the Unsecured badge live
                this.agentManager.emit("agentConfigUpdated", {
                  agentId,
                  config: { unsecured: false },
                });
              })
              .catch((err) => {
                log.debug(
                  `Agent ${agentId} did not accept setAuthToken (pre-auth binary?): ${err?.message ?? err}`,
                  "WebSocketHub"
                );
              });
          }, 2000);
        }

        // DB-priority profile sync: if DB has a profile_id that differs from agent's,
        // tell the agent to reload so it fetches the authoritative profile from the API.
        if (agentConfig.agentType === 'ipmi_host' || agentConfig.agentType === 'ipmi_network') {
          const dbSystem = await db.get(
            'SELECT profile_id FROM systems WHERE agent_id = $1',
            [agentId]
          );
          const dbProfileId = dbSystem?.profile_id;
          const agentProfileId = agentConfig.profileId;

          if (dbProfileId && dbProfileId !== agentProfileId) {
            log.info(
              `Profile mismatch for ${agentId}: DB="${dbProfileId}" vs agent="${agentProfileId || 'none'}". Sending reloadProfile.`,
              'WebSocketHub'
            );
            // Small delay to let the agent finish processing registration before reload
            setTimeout(() => {
              this.sendCommandToAgent(agentId, {
                type: 'reloadProfile',
                commandId: `profile-sync-${Date.now()}`,
                payload: {},
              });
            }, 2000);
          }
        }

        // Sync excluded-sensor list to agent so its offline failsafe respects
        // the user's hide selection. Sent after registered confirmation so the
        // agent has finished applying initial config first. Same 2000ms delay
        // as the reloadProfile sync above for consistency.
        setTimeout(() => {
          this.commandDispatcher.syncExcludedSensors(agentId);
        }, 2000);

        // Notify other clients about new agent
        this.broadcast("agentRegistered", agentConfig, ["agents:all"]);
      } catch (error) {
        log.error(`Failed to register agent ${agentId}`, "WebSocketHub", error);
        this.sendToClient(clientId, "registrationError", {
          error: error instanceof Error ? error.message : "Registration failed",
        });
      }
    } catch (error) {
      log.error(
        `Error handling agent registration for ${clientId}`,
        "WebSocketHub",
        error
      );
      this.sendToClient(clientId, "registrationError", {
        error: "Registration processing failed",
      });
    }
  }

  /**
   * Hold a credential-less agent for admin approval. The connection
   * stays open (so approval can promote it instantly) but the client is never
   * marked isAgent - existing gates ignore its telemetry and responses.
   */
  private holdPendingAgent(
    clientId: string,
    registrationData: any,
    reason: string
  ): void {
    const agentId = registrationData.agentId;
    const previous = this.pendingAgents.get(agentId);

    // Same agent retrying (reconnect after dismiss/restart): the new
    // connection supersedes the old entry
    if (previous && previous.clientId !== clientId) {
      this.clients
        .get(previous.clientId)
        ?.websocket.close(4408, "superseded by newer registration");
    }

    if (!previous && this.pendingAgents.size >= MAX_PENDING_AGENTS) {
      log.warn(
        `Pending-approval queue full (${MAX_PENDING_AGENTS}) - turning away agent ${agentId}`,
        "WebSocketHub"
      );
      this.sendToClient(clientId, "registrationError", {
        error: "Hub pending-approval queue is full",
      });
      this.clients.get(clientId)?.websocket.close(4403, "pending queue full");
      return;
    }

    const client = this.clients.get(clientId);
    const entry: PendingAgent = {
      clientId,
      registrationData,
      agentId,
      name: registrationData.name || agentId,
      ip: client?.metadata.ip,
      agentType: registrationData.agent_type,
      platform: registrationData.platform,
      version: registrationData.agent_version,
      reason,
      requestedAt: new Date().toISOString(),
    };
    this.pendingAgents.set(agentId, entry);

    log.info(`Agent ${agentId} held for approval: ${reason}`, "WebSocketHub");
    this.sendToClient(clientId, "registrationPending", { agentId, reason });
    this.broadcast("agentPendingApproval", this.pendingAgentView(entry), [
      "agents:all",
      "systems:all",
    ]);
  }

  /**
   * Single-use reconnect ticket for an approved-with-update agent: deleted on
   * sight; only an in-window reconnect from the same address completes the
   * approval without a second admin click.
   */
  private redeemUpdateTicket(agentId: string, sourceIp?: string): boolean {
    const ticket = this.updateReconnectTickets.get(agentId);
    if (!ticket) return false;
    this.updateReconnectTickets.delete(agentId);
    if (Date.now() <= ticket.deadline && ticket.ip && sourceIp === ticket.ip) {
      log.info(
        `Agent ${agentId} reconnected from ${sourceIp} within the update window - completing approval`,
        "WebSocketHub"
      );
      return true;
    }
    log.info(
      `Agent ${agentId} reconnected ${Date.now() > ticket.deadline ? "after the update window closed" : `from unexpected address ${sourceIp}`} - holding for approval`,
      "WebSocketHub"
    );
    return false;
  }

  /** Metadata-only view of a pending agent (never the raw registration data) */
  private pendingAgentView(entry: PendingAgent) {
    const { clientId, registrationData, ...view } = entry;
    return {
      ...view,
      // Lets the UI label the approve action honestly: below this version,
      // approving a Linux/IPMI agent also updates it.
      belowTokenVersion:
        compareSemver(entry.version || "0.0.0", MIN_TOKEN_CAPABLE_AGENT_VERSION) < 0,
    };
  }

  public getPendingAgents() {
    return Array.from(this.pendingAgents.values()).map((e) =>
      this.pendingAgentView(e)
    );
  }

  /**
   * Admin approved a pending agent: run the normal registration for the held
   * connection (row, config sync, registered response) with the approval
   * path pushing its permanent token via setAuthToken.
   */
  public async approvePendingAgent(
    agentId: string
  ): Promise<{ ok: boolean; error?: string }> {
    const entry = this.pendingAgents.get(agentId);
    if (!entry) {
      return { ok: false, error: "No pending agent with that ID" };
    }

    // Credential recovery guard: if the real agent came back online while
    // this claim sat pending, approving would hand its identity away.
    const liveConflict = Array.from(this.clients.entries()).some(
      ([cid, c]) =>
        cid !== entry.clientId &&
        c.metadata.isAgent &&
        c.metadata.agentId === agentId
    );
    if (liveConflict) {
      return {
        ok: false,
        error: "This system is already online and secured - dismiss this request instead",
      };
    }

    // Old Linux/IPMI builds can't store a pushed token, so approval also
    // updates them - which needs new-enough binaries staged on the hub.
    // A failed check leaves the agent pending so the click can be retried.
    const agentType = entry.agentType ?? entry.registrationData?.agent_type;
    const chainSelfUpdate =
      (agentType === "os_linux" || agentType === "ipmi_host") &&
      compareSemver(entry.version || "0.0.0", MIN_TOKEN_CAPABLE_AGENT_VERSION) < 0;
    if (chainSelfUpdate) {
      const staged = UpdateDownloadService.getInstance().getLocalStatus().version;
      if (!staged || compareSemver(staged, MIN_TOKEN_CAPABLE_AGENT_VERSION) < 0) {
        return {
          ok: false,
          error: `Stage ${MIN_TOKEN_CAPABLE_AGENT_VERSION} binaries in Fleet Maintenance first`,
        };
      }
    }

    this.pendingAgents.delete(agentId);
    this.broadcast("agentPendingRemoved", { agentId }, [
      "agents:all",
      "systems:all",
    ]);

    const client = this.clients.get(entry.clientId);
    if (!client || client.websocket.readyState !== WebSocket.OPEN) {
      return {
        ok: false,
        error:
          "Agent is no longer connected - it will reappear on its next reconnect",
      };
    }

    log.info(
      `Pending agent ${agentId} approved by admin${chainSelfUpdate ? " (old build - chaining update)" : ""}`,
      "WebSocketHub"
    );
    await this.handleAgentRegistration(
      entry.clientId,
      entry.registrationData,
      true,
      chainSelfUpdate
    );
    return { ok: true };
  }

  /**
   * Admin dismissed a pending agent: drop the entry and close the connection.
   * Not a ban - the agent re-pends on its next reconnect; permanent silence
   * means uninstalling the agent on that machine.
   */
  public dismissPendingAgent(agentId: string): { ok: boolean; error?: string } {
    const entry = this.pendingAgents.get(agentId);
    if (!entry) {
      return { ok: false, error: "No pending agent with that ID" };
    }

    this.pendingAgents.delete(agentId);
    this.broadcast("agentPendingRemoved", { agentId }, [
      "agents:all",
      "systems:all",
    ]);
    this.clients.get(entry.clientId)?.websocket.close(4403, "dismissed");
    log.info(`Pending agent ${agentId} dismissed by admin`, "WebSocketHub");
    return { ok: true };
  }

  /**
   * Handle client unsubscription
   */
  private handleUnsubscription(
    clientId: string,
    subscriptions: string[]
  ): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const subscription of subscriptions) {
      this.removeClientSubscription(client, subscription);
    }

    log.info(
      ` Client ${clientId} unsubscribed from: ${subscriptions.join(", ")}`,
      "WebSocketHub"
    );

    this.sendToClient(clientId, "unsubscribed", {
      subscriptions: Array.from(client.subscriptions),
    });
  }

  /**
   * Send initial data for new subscriptions
   */
  private async sendInitialDataForSubscriptions(
    clientId: string,
    subscriptions: string[]
  ): Promise<void> {
    for (const subscription of subscriptions) {
      if (subscription === "systems:all") {
        // Request full sync instead of sending raw aggregated data
        // This ensures frontend gets proper database format with all fields
        await this.handleFullSyncRequest(clientId);
      } else if (subscription.startsWith("system:")) {
        // Send specific system data
        const agentId = subscription.replace("system:", "");
        const systemData = this.dataAggregator.getSystemData(agentId);
        if (systemData) {
          this.sendToClient(clientId, "systemData", systemData);
        }
      } else if (subscription === "agents:all") {
        // Send agent statuses
        const agentStatuses = this.agentManager.getAllAgentStatuses();
        this.sendToClient(clientId, "agentStatuses", agentStatuses);
      }
    }
  }

  /**
   * Handle get system data request
   */
  private handleGetSystemData(clientId: string, agentId?: string): void {
    if (agentId) {
      const systemData = this.dataAggregator.getSystemData(agentId);
      this.sendToClient(clientId, "systemData", systemData);
    } else {
      const systemsData = this.dataAggregator.getAllSystemsData();
      this.sendToClient(clientId, "systemsData", systemsData);
    }
  }

  /**
   * Handle get overview request
   */
  private async handleGetOverview(clientId: string): Promise<void> {
    const overview = this.dataAggregator.getSystemOverview();

    // Add license limit info
    const tier = await licenseManager.getCurrentTier();
    const agentLimit = tier.agentLimit;
    const isUnlimited = agentLimit === Infinity;

    const enrichedOverview = {
      ...overview,
      agentLimit: isUnlimited ? "unlimited" : agentLimit,
      overLimit: !isUnlimited && overview.totalSystems > agentLimit,
      tierName: tier.name,
    };

    this.sendToClient(clientId, "overview", enrichedOverview);
  }

  /**
   * Handle full sync request (frontend requests complete state)
   * Matches the format of GET /api/systems route
   */
  private async handleFullSyncRequest(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    log.info(` Client ${clientId} requested full sync`, "WebSocketHub");

    try {
      // Get systems from database (same as /api/systems route)
      const systems = await this.dataAggregator.getAllSystems();
      const readOnlyStatus = await this.agentManager.getAgentsReadOnlyStatus();

      // Enhance with real-time data (same mapping used by first-update fullState)
      const enhancedSystems = systems.map((system) => {
        const systemData = this.dataAggregator.getSystemData(system.agent_id);
        return this.buildEnhancedSystemState(
          system,
          systemData,
          readOnlyStatus.get(system.agent_id) || false
        );
      });
      
      // Calculate real-time global overview stats
      const overviewStats = this.dataAggregator.getSystemOverview();
      const tier = await licenseManager.getCurrentTier();
      const agentLimit = tier.agentLimit;
      const isUnlimited = agentLimit === Infinity;

      const fullOverview = {
        ...overviewStats,
        agentLimit: isUnlimited ? 'unlimited' : agentLimit,
        overLimit: !isUnlimited && overviewStats.totalSystems > agentLimit,
        tierName: tier.name
      };

      // Send full state to client with combined overview stats
      this.sendToClient(clientId, "fullState", { systems: enhancedSystems, overview: fullOverview });
      log.info(
        ` Sent full sync (${enhancedSystems.length} systems) to client ${clientId}`,
        "WebSocketHub"
      );
    } catch (error) {
      log.error(
        `Error in handleFullSyncRequest for client ${clientId}`,
        "WebSocketHub",
        error
      );
    }
  }

  /**
   * Get system row from DB-style systems list by agent_id
   */
  private async getSystemRecordByAgentId(agentId: string): Promise<any | null> {
    const systems = await this.dataAggregator.getAllSystems();
    return systems.find((system) => system.agent_id === agentId) || null;
  }

  /**
   * Build frontend-compatible fullState system payload
   * Used by both handleFullSyncRequest and first-update fullState broadcast.
   */
  private buildEnhancedSystemState(
    system: any,
    systemData?: AggregatedSystemData,
    isReadOnly: boolean = false
  ): any {
    const agentId = system.agent_id;
    const agentStatus = this.agentManager.getAgentStatus(agentId);

    // The token hash never leaves the hub; the UI only needs the boolean
    const { auth_token_hash, ...publicSystem } = system;

    return {
      ...publicSystem,
      unsecured: !auth_token_hash,
      status: agentStatus?.status || systemData?.status || system.status,
      real_time_status: agentStatus?.status || systemData?.status || "unknown",
      last_seen: systemData?.lastUpdate?.toISOString() || system.last_seen || null,
      last_data_received:
        agentStatus?.lastDataReceived || systemData?.lastUpdate?.toISOString() || null,
      current_temperatures: systemData?.sensors || [],
      current_fan_speeds: systemData?.fans || [],
      system_health: systemData?.systemHealth || null,
      current_update_interval: this.agentManager.getAgentUpdateInterval(agentId),
      fan_step_percent: this.agentManager.getAgentFanStep(agentId),
      hysteresis_temp: this.agentManager.getAgentHysteresis(agentId),
      emergency_temp: this.agentManager.getAgentEmergencyTemp(agentId),
      log_level: this.agentManager.getAgentLogLevel(agentId),
      failsafe_speed: this.agentManager.getAgentFailsafeSpeed(agentId),
      enable_fan_control: this.agentManager.getAgentEnableFanControl(agentId),
      read_only: isReadOnly,
      access_status: isReadOnly ? "over_limit" : "active",
      last_error: agentStatus?.connectionInfo?.lastError ?? null,
    };
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
        timestamp: new Date().toISOString(),
      };

      client.websocket.send(JSON.stringify(message));
    } catch (error) {
      log.error(
        `Error sending message to client ${clientId}`,
        "WebSocketHub",
        error
      );
    }
  }

  // The only places a client's subscriptions are mutated. Each updates the
  // per-client Set and `subscriptionIndex` together so they stay consistent;
  // route any new (un)subscribe path through these rather than touching
  // `client.subscriptions` directly.

  /** Add one subscription for a client, mirroring it into the index. */
  private addClientSubscription(client: ClientConnection, subscription: string): void {
    client.subscriptions.add(subscription);
    let ids = this.subscriptionIndex.get(subscription);
    if (!ids) {
      ids = new Set();
      this.subscriptionIndex.set(subscription, ids);
    }
    ids.add(client.id);
  }

  /** Remove one subscription for a client, mirroring it into the index. */
  private removeClientSubscription(client: ClientConnection, subscription: string): void {
    client.subscriptions.delete(subscription);
    const ids = this.subscriptionIndex.get(subscription);
    if (ids) {
      ids.delete(client.id);
      if (ids.size === 0) this.subscriptionIndex.delete(subscription); // drop empty channels (dynamic system:<id> ones accumulate otherwise)
    }
  }

  /** Remove a client from every subscription set it belonged to (on disconnect). */
  private removeClientFromIndex(client: ClientConnection): void {
    for (const subscription of client.subscriptions) {
      const ids = this.subscriptionIndex.get(subscription);
      if (ids) {
        ids.delete(client.id);
        if (ids.size === 0) this.subscriptionIndex.delete(subscription);
      }
    }
  }

  /**
   * Broadcast a message to every client subscribed to any of the given
   * channels. Recipient ids are resolved through `subscriptionIndex` and
   * unioned into a Set, so a client subscribed to several of the target
   * channels still receives a single copy. Each recipient is re-checked for an
   * open socket, so a stale index entry is harmless.
   */
  private broadcast(type: string, data: any, subscriptions: string[]): void {
    const message = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    // Union the clientIds across all target subscriptions (dedup => one send each).
    const recipientIds = new Set<string>();
    for (const subscription of subscriptions) {
      const ids = this.subscriptionIndex.get(subscription);
      if (ids) {
        for (const id of ids) recipientIds.add(id);
      }
    }

    for (const clientId of recipientIds) {
      const client = this.clients.get(clientId);
      // Skip vanished or closing connections (stale index entries are harmless).
      if (!client || client.websocket.readyState !== WebSocket.OPEN) {
        continue;
      }
      try {
        client.websocket.send(messageStr);
        sentCount++;
      } catch (error) {
        log.error(
          `Error broadcasting to client ${clientId}`,
          "WebSocketHub",
          error
        );
      }
    }

    if (sentCount > 0) {
      log.debug(`Broadcasted message`, "WebSocketHub", {
        type,
        clientCount: sentCount,
      });
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

        if (
          client.websocket.readyState !== WebSocket.OPEN ||
          timeSinceLastActivity > timeout
        ) {
          clientsToRemove.push(clientId);
        }
      }

      for (const clientId of clientsToRemove) {
        this.handleClientDisconnection(clientId);
      }

      if (clientsToRemove.length > 0) {
        log.info(
          ` Cleaned up ${clientsToRemove.length} inactive WebSocket connections`,
          "WebSocketHub"
        );
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
    const xForwardedFor = request.headers["x-forwarded-for"];
    if (xForwardedFor) {
      const ips = Array.isArray(xForwardedFor)
        ? xForwardedFor[0]
        : xForwardedFor;
      const firstIp = ips.split(",")[0].trim();
      return this.cleanIpAddress(firstIp);
    }

    // Check for X-Real-IP header
    const xRealIp = request.headers["x-real-ip"];
    if (xRealIp) {
      const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
      return this.cleanIpAddress(ip);
    }

    // Fall back to socket address
    const socketIp = request.socket.remoteAddress || "unknown";
    return this.cleanIpAddress(socketIp);
  }

  /**
   * Clean IPv6-mapped IPv4 addresses
   */
  private cleanIpAddress(ip: string): string {
    // Convert IPv6-mapped IPv4 (::ffff:192.168.1.1) to IPv4 (192.168.1.1)
    if (ip.startsWith("::ffff:")) {
      return ip.substring(7);
    }
    // Convert localhost variations
    if (ip === "::1" || ip === "127.0.0.1") {
      return "localhost";
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
      "systems:all",
      "agents:all",
      "commands:all",
      "system:{agentId}", // Template for specific system subscriptions
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
    return Array.from(this.clients.values()).map((client) => ({
      id: client.id,
      subscriptions: Array.from(client.subscriptions),
      lastActivity: client.lastActivity,
      connectedAt: client.metadata.connectedAt,
      ip: client.metadata.ip,
      userAgent: client.metadata.userAgent,
    }));
  }

  /**
   * Broadcast agent name change to all subscribed clients
   */
  public broadcastNameChange(agentId: string, newName: string): void {
    const delta = {
      agentId,
      timestamp: new Date().toISOString(),
      changes: {
        name: newName,
      },
    };
    this.broadcast("systemDelta", delta, [`system:${agentId}`, "systems:all"]);
    log.debug(`Broadcasted name change for agent ${agentId}: ${newName}`, "WebSocketHub");
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
              type: "command",
              data: command,
              timestamp: new Date().toISOString(),
            };
            client.websocket.send(JSON.stringify(message));
            log.debug(`Command sent to agent`, "WebSocketHub", {
              agentId,
              commandType: command.type,
            });
            return true;
          } catch (error) {
            log.error(
              `Error sending command to agent ${agentId}`,
              "WebSocketHub",
              error
            );
            return false;
          }
        } else {
          log.warn(
            `Agent ${agentId} WebSocket not open (state: ${client.websocket.readyState})`,
            "WebSocketHub"
          );
          return false;
        }
      }
    }

    log.warn(
      `Agent ${agentId} not found in WebSocket connections`,
      "WebSocketHub"
    );
    return false;
  }

  /**
   * Send command to all connected agents
   */
  public broadcastCommandToAgents(command: any): string[] {
    const successfulAgents: string[] = [];

    for (const [clientId, client] of this.clients.entries()) {
      if (client.metadata.isAgent && client.metadata.agentId) {
        const success = this.sendCommandToAgent(
          client.metadata.agentId,
          command
        );
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
      const isActive = now - client.lastActivity.getTime() < activeTimeout;
      if (isActive) activeClients++;

      totalSubscriptions += client.subscriptions.size;

      for (const subscription of client.subscriptions) {
        subscriptionBreakdown[subscription] =
          (subscriptionBreakdown[subscription] || 0) + 1;
      }
    }

    return {
      totalClients: this.clients.size,
      activeClients,
      totalSubscriptions,
      subscriptionBreakdown,
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
    this.subscriptionIndex.clear();

    if (this.wss) {
      this.wss.close();
    }

    this.removeAllListeners();
    log.info(" WebSocket hub cleaned up", "WebSocketHub");
  }
}
