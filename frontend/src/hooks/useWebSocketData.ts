import { useState, useEffect, useCallback, useRef } from "react";
import type { SystemData } from "../types/api";
import WebSocketService from "../services/websocket";

// Delta update structure from backend
interface SystemDelta {
  agentId: string;
  timestamp: string;
  changes: {
    status?: "online" | "offline" | "error";
    sensors?: Record<string, Partial<any>>;
    fans?: Record<string, Partial<any>>;
    systemHealth?: Partial<any>;
    // Agent configuration changes (sent immediately when user modifies settings)
    current_update_interval?: number;
    // filter_duplicate_sensors removed (deprecated)
    // duplicate_sensor_tolerance removed (deprecated)
    fan_step_percent?: number;
    hysteresis_temp?: number;
    emergency_temp?: number;
    log_level?: string;
    enable_fan_control?: boolean;
    name?: string; // Agent name change
  };
}

interface UseWebSocketDataReturn {
  systems: SystemData[];
  isConnected: boolean;
  connectionState: "connecting" | "connected" | "disconnected" | "error";
  error: string | null;
  lastUpdate: Date;
  reconnect: () => void;
}

/**
 * Pure WebSocket hook with delta updates - NO HTTP POLLING!
 *
 * Features:
 * - Real-time updates via WebSocket only
 * - Delta merging for 95% bandwidth reduction
 * - Automatic reconnection with exponential backoff
 * - Full sync request after reconnection
 */
export function useWebSocketData(): UseWebSocketDataReturn {
  const [systems, setSystems] = useState<SystemData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const wsRef = useRef<WebSocketService | null>(null);
  const mountedRef = useRef(true);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Merge delta into existing systems state
   */
  const mergeDelta = useCallback((delta: SystemDelta) => {
    setSystems((prevSystems) => {
      const systemIndex = prevSystems.findIndex(
        (s) => s.agent_id === delta.agentId
      );

      if (systemIndex === -1) {
        console.error(
          "🚫 GHOST SYSTEM ALERT! Received delta for unknown system:",
          {
            agentId: delta.agentId,
            changes: Object.keys(delta.changes),
            currentSystems: prevSystems.map((s) => ({
              agent_id: s.agent_id,
              name: s.name,
            })),
          }
        );
        // Do NOT create a new system from delta - deltas should only update existing systems
        return prevSystems;
      }

      const updatedSystems = [...prevSystems];
      const system = { ...updatedSystems[systemIndex] };

      // Apply status change
      if (delta.changes.status) {
        system.status = delta.changes.status;
        system.real_time_status = delta.changes.status;
      }

      // Apply sensor changes
      if (delta.changes.sensors) {
        system.current_temperatures = system.current_temperatures?.map(
          (sensor) => {
            const changes = delta.changes.sensors![sensor.id];
            if (changes) {
              return { ...sensor, ...changes };
            }
            return sensor;
          }
        );
      }

      // Apply fan changes
      if (delta.changes.fans) {
        system.current_fan_speeds = system.current_fan_speeds?.map((fan) => {
          const changes = delta.changes.fans![fan.id];
          if (changes) {
            return { ...fan, ...changes };
          }
          return fan;
        });
      }

      // Apply system health changes
      if (delta.changes.systemHealth && system.system_health) {
        system.system_health = {
          ...system.system_health,
          ...delta.changes.systemHealth,
        };
      }

      // Apply configuration changes
      // These fields are updated when user changes settings via GUI
      if (delta.changes.current_update_interval !== undefined) {
        system.current_update_interval = delta.changes.current_update_interval;
      }
      // filter_duplicate_sensors delta handling removed (deprecated)
      // duplicate_sensor_tolerance delta handling removed (deprecated)
      if (delta.changes.fan_step_percent !== undefined) {
        system.fan_step_percent = delta.changes.fan_step_percent;
      }
      if (delta.changes.hysteresis_temp !== undefined) {
        system.hysteresis_temp = delta.changes.hysteresis_temp;
      }
      if (delta.changes.emergency_temp !== undefined) {
        system.emergency_temp = delta.changes.emergency_temp;
      }
      if (delta.changes.log_level !== undefined) {
        system.log_level = delta.changes.log_level;
      }
      if (delta.changes.enable_fan_control !== undefined) {
        system.enable_fan_control = delta.changes.enable_fan_control;
      }
      if (delta.changes.name !== undefined) {
        system.name = delta.changes.name;
      }

      system.last_seen = delta.timestamp;
      updatedSystems[systemIndex] = system;

      return updatedSystems;
    });

    setLastUpdate(new Date(delta.timestamp));
  }, []);

  /**
   * Handle full state update
   */
  const handleFullState = useCallback((data: SystemData[]) => {
    console.log("📦 Received full state:", data.length, "systems");

    if (!mountedRef.current) return;

    // Merge with existing systems (in case of partial sync)
    setSystems((prevSystems) => {
      const merged = [...prevSystems];

      data.forEach((newSystem) => {
        // Defensive: Validate system has required fields
        if (!newSystem.name || !newSystem.agent_id) {
          console.error(
            "🚫 GHOST SYSTEM DETECTED in full state! Missing required fields:",
            {
              name: newSystem.name,
              agent_id: newSystem.agent_id,
              id: newSystem.id,
              fullSystem: newSystem,
            }
          );
          return; // Skip this invalid system
        }

        // Defensive: Skip systems without valid agent_id
        if (newSystem.agent_id.trim() === "") {
          console.warn("⚠️ Skipping system with empty agent_id:", newSystem);
          return;
        }

        const index = merged.findIndex(
          (s) => s.agent_id === newSystem.agent_id
        );
        if (index >= 0) {
          merged[index] = newSystem; // Update existing
        } else {
          console.log(
            "➕ Adding new system:",
            newSystem.name,
            "(" + newSystem.agent_id + ")"
          );
          merged.push(newSystem); // Add new
        }
      });

      return merged;
    });

    setLastUpdate(new Date());
  }, []);

  /**
   * Handle delta update
   */
  const handleDelta = useCallback(
    (data: SystemDelta) => {
      console.log(
        "📊 Received delta for:",
        data.agentId,
        "changes:",
        Object.keys(data.changes)
      );
      mergeDelta(data);
    },
    [mergeDelta]
  );

  /**
   * Handle system offline
   */
  const handleSystemOffline = useCallback((data: { agentId: string }) => {
    console.log("❌ System offline:", data.agentId);

    if (!mountedRef.current) return;

    setSystems((prevSystems) =>
      prevSystems.map((s) =>
        s.agent_id === data.agentId
          ? { ...s, status: "offline", real_time_status: "offline" }
          : s
      )
    );
  }, []);

  /**
   * Handle agent registered (agent reconnected)
   */
  const handleAgentRegistered = useCallback((data: any) => {
    console.log("✅ Agent registered/reconnected:", data.agentId);

    if (!mountedRef.current) return;

    // Request full sync to get complete data for this agent
    if (wsRef.current) {
      console.log("🔄 Requesting full sync after agent registration");
      wsRef.current.send("requestFullSync");
    }
  }, []);

  /**
   * Handle agent unregistered (agent stopped/gracefully disconnected)
   */
  const handleAgentUnregistered = useCallback((data: { agentId: string }) => {
    console.log("🛑 Agent unregistered/stopped:", data.agentId);

    if (!mountedRef.current) return;

    setSystems((prevSystems) =>
      prevSystems.map((s) =>
        s.agent_id === data.agentId
          ? { ...s, status: "offline", real_time_status: "offline" }
          : s
      )
    );
  }, []);

  /**
   * Handle agent error
   */
  const handleAgentError = useCallback(
    (data: { agentId: string; error?: any }) => {
      console.log("⚠️ Agent error:", data.agentId, data.error);

      if (!mountedRef.current) return;

      setSystems((prevSystems) =>
        prevSystems.map((s) =>
          s.agent_id === data.agentId
            ? { ...s, status: "error", real_time_status: "error" }
            : s
        )
      );
    },
    []
  );

  /**
   * Handle WebSocket connection
   */
  const handleConnect = useCallback(() => {
    console.log("✅ WebSocket connected");

    if (!mountedRef.current) return;

    setIsConnected(true);
    setConnectionState("connected");
    setError(null);

    // Subscribe to all systems
    if (wsRef.current) {
      wsRef.current.subscribe(["systems:all"]);
      wsRef.current.send("requestFullSync");
    }
  }, []);

  // Note: handleDisconnect and handleError are handled by the WebSocket service's
  // auto-reconnection logic and the connect() catch block

  /**
   * Handle agent config updated
   */
  const handleAgentConfigUpdated = useCallback(
    (data: { agentId: string; config: any }) => {
      console.log("⚙️ Agent config updated:", data.agentId, data.config);

      if (!mountedRef.current) return;

      setSystems((prevSystems) => {
        const updated = prevSystems.map((s) => {
          if (s.agent_id === data.agentId) {
            const newConfig: any = { ...data.config };

            if (newConfig.update_interval !== undefined) {
              newConfig.current_update_interval = newConfig.update_interval;
              delete newConfig.update_interval;
            }

            return { ...s, ...newConfig };
          }
          return s;
        });
        return updated;
      });
    },
    []
  );

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setConnectionState("connecting");

    // Determine WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const wsPort = import.meta.env.VITE_WS_PORT || "3002";
    const wsUrl = `${protocol}//${host}:${wsPort}`;

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    // Create WebSocket instance
    wsRef.current = new WebSocketService(wsUrl);

    // Setup event handlers
    wsRef.current.on("connected", handleConnect);
    wsRef.current.on("fullState", (data: unknown) =>
      handleFullState(data as SystemData[])
    );
    wsRef.current.on("systemDelta", (data: unknown) =>
      handleDelta(data as SystemDelta)
    );
    wsRef.current.on("systemOffline", (data: unknown) =>
      handleSystemOffline(data as { agentId: string })
    );
    wsRef.current.on("agentRegistered", (data: unknown) =>
      handleAgentRegistered(data)
    );
    wsRef.current.on("agentUnregistered", (data: unknown) =>
      handleAgentUnregistered(data as { agentId: string })
    );
    wsRef.current.on("agentError", (data: unknown) =>
      handleAgentError(data as { agentId: string; error?: any })
    );
    wsRef.current.on("agentConfigUpdated", (data: unknown) =>
      handleAgentConfigUpdated(data as { agentId: string; config: any })
    );

    // Connect
    wsRef.current
      .connect()
      .then(() => {
        console.log("✅ WebSocket connected successfully");
      })
      .catch((err) => {
        console.error("❌ WebSocket connection failed:", err);
        if (mountedRef.current) {
          setConnectionState("error");
          setError("Failed to connect to server");

          // Auto-reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              console.log("🔄 Auto-reconnecting...");
              connect();
            }
          }, 5000);
        }
      });
  }, [
    handleConnect,
    handleFullState,
    handleDelta,
    handleSystemOffline,
    handleAgentRegistered,
    handleAgentUnregistered,
    handleAgentError,
    handleAgentConfigUpdated,
  ]);

  /**
   * Initial connection
   */
  useEffect(() => {
    // IMPORTANT: Reset mounted flag on each mount.
    // React StrictMode (dev) double-mounts components: effect runs → cleanup → effect runs again.
    // Without this reset, mountedRef stays false after cleanup, causing handleConnect to skip
    // subscribing/syncing, leaving the UI stuck on "Connecting to server..."
    // See: commit b453a64 accidentally removed this line, breaking npm run dev.
    mountedRef.current = true;

    connect();

    return () => {
      // Cleanup on unmount
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return {
    systems,
    isConnected,
    connectionState,
    error,
    lastUpdate,
    reconnect: connect,
  };
}
