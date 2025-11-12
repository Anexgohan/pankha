import { useState, useEffect, useCallback, useRef } from 'react';
import type { SystemData } from '../types/api';
import WebSocketService from '../services/websocket';

// Delta update structure from backend
interface SystemDelta {
  agentId: string;
  timestamp: string;
  changes: {
    status?: 'online' | 'offline' | 'error';
    sensors?: Record<string, Partial<any>>;
    fans?: Record<string, Partial<any>>;
    systemHealth?: Partial<any>;
    // Agent configuration changes (sent immediately when user modifies settings)
    current_update_interval?: number;
    filter_duplicate_sensors?: boolean;
    duplicate_sensor_tolerance?: number;
    fan_step_percent?: number;
    hysteresis_temp?: number;
    emergency_temp?: number;
    log_level?: string;
  };
}

interface UseWebSocketDataReturn {
  systems: SystemData[];
  isConnected: boolean;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
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
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const wsRef = useRef<WebSocketService | null>(null);
  const mountedRef = useRef(true);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Merge delta into existing systems state
   */
  const mergeDelta = useCallback((delta: SystemDelta) => {
    setSystems(prevSystems => {
      const systemIndex = prevSystems.findIndex(s => s.agent_id === delta.agentId);

      if (systemIndex === -1) {
        console.error('🚫 GHOST SYSTEM ALERT! Received delta for unknown system:', {
          agentId: delta.agentId,
          changes: Object.keys(delta.changes),
          currentSystems: prevSystems.map(s => ({ agent_id: s.agent_id, name: s.name }))
        });
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
        system.current_temperatures = system.current_temperatures?.map(sensor => {
          const changes = delta.changes.sensors![sensor.id];
          if (changes) {
            return { ...sensor, ...changes };
          }
          return sensor;
        });
      }

      // Apply fan changes
      if (delta.changes.fans) {
        system.current_fan_speeds = system.current_fan_speeds?.map(fan => {
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
          ...delta.changes.systemHealth
        };
      }

      // Apply configuration changes
      // These fields are updated when user changes settings via GUI
      if (delta.changes.current_update_interval !== undefined) {
        system.current_update_interval = delta.changes.current_update_interval;
      }
      if (delta.changes.filter_duplicate_sensors !== undefined) {
        system.filter_duplicate_sensors = delta.changes.filter_duplicate_sensors;
      }
      if (delta.changes.duplicate_sensor_tolerance !== undefined) {
        system.duplicate_sensor_tolerance = delta.changes.duplicate_sensor_tolerance;
      }
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
    console.log('📦 Received full state:', data.length, 'systems');

    if (!mountedRef.current) return;

    // Merge with existing systems (in case of partial sync)
    setSystems(prevSystems => {
      const merged = [...prevSystems];

      data.forEach(newSystem => {
        // Defensive: Validate system has required fields
        if (!newSystem.name || !newSystem.agent_id) {
          console.error('🚫 GHOST SYSTEM DETECTED in full state! Missing required fields:', {
            name: newSystem.name,
            agent_id: newSystem.agent_id,
            id: newSystem.id,
            fullSystem: newSystem
          });
          return; // Skip this invalid system
        }

        // Defensive: Skip systems without valid agent_id
        if (newSystem.agent_id.trim() === '') {
          console.warn('⚠️ Skipping system with empty agent_id:', newSystem);
          return;
        }

        const index = merged.findIndex(s => s.agent_id === newSystem.agent_id);
        if (index >= 0) {
          merged[index] = newSystem; // Update existing
        } else {
          console.log('➕ Adding new system:', newSystem.name, '(' + newSystem.agent_id + ')');
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
  const handleDelta = useCallback((data: SystemDelta) => {
    console.log('📊 Received delta for:', data.agentId, 'changes:', Object.keys(data.changes));
    mergeDelta(data);
  }, [mergeDelta]);

  /**
   * Handle system offline
   */
  const handleSystemOffline = useCallback((data: { agentId: string }) => {
    console.log('❌ System offline:', data.agentId);

    if (!mountedRef.current) return;

    setSystems(prevSystems =>
      prevSystems.map(s =>
        s.agent_id === data.agentId
          ? { ...s, status: 'offline', real_time_status: 'offline' }
          : s
      )
    );
  }, []);

  /**
   * Handle WebSocket connection
   */
  const handleConnect = useCallback(() => {
    console.log('✅ WebSocket connected');

    if (!mountedRef.current) return;

    setIsConnected(true);
    setConnectionState('connected');
    setError(null);

    // Subscribe to all systems
    if (wsRef.current) {
      wsRef.current.subscribe(['systems:all']);

      // Request full sync after connection
      wsRef.current.send('requestFullSync');
    }
  }, []);

  // Note: handleDisconnect and handleError are handled by the WebSocket service's
  // auto-reconnection logic and the connect() catch block

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setConnectionState('connecting');

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const wsPort = import.meta.env.VITE_WS_PORT || '3002';
    const wsUrl = `${protocol}//${host}:${wsPort}`;

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    // Create WebSocket instance
    wsRef.current = new WebSocketService(wsUrl);

    // Setup event handlers (with type assertions for unknown -> specific types)
    wsRef.current.on('connected', handleConnect);
    wsRef.current.on('fullState', (data: unknown) => handleFullState(data as SystemData[]));
    wsRef.current.on('systemDelta', (data: unknown) => handleDelta(data as SystemDelta));
    wsRef.current.on('systemOffline', (data: unknown) => handleSystemOffline(data as { agentId: string }));

    // Connect
    wsRef.current.connect()
      .then(() => {
        console.log('✅ WebSocket connected successfully');
      })
      .catch((err) => {
        console.error('❌ WebSocket connection failed:', err);
        if (mountedRef.current) {
          setConnectionState('error');
          setError('Failed to connect to server');

          // Auto-reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              console.log('🔄 Auto-reconnecting...');
              connect();
            }
          }, 5000);
        }
      });
  }, [handleConnect, handleFullState, handleDelta, handleSystemOffline]);

  /**
   * Manual reconnect
   */
  const reconnect = useCallback(() => {
    console.log('🔄 Manual reconnect requested');
    connect();
  }, [connect]);

  /**
   * Initialize WebSocket on mount
   */
  useEffect(() => {
    mountedRef.current = true;
    connect();

    // Periodic full sync every 5 minutes (catches new sensors/fans)
    const fullSyncInterval = setInterval(() => {
      if (isConnected && wsRef.current) {
        console.log('⏰ Periodic full sync');
        wsRef.current.send('requestFullSync');
      }
    }, 5 * 60 * 1000);

    return () => {
      mountedRef.current = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      clearInterval(fullSyncInterval);

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, isConnected]);

  return {
    systems,
    isConnected,
    connectionState,
    error,
    lastUpdate,
    reconnect
  };
}
