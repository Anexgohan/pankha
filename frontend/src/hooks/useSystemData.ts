import { useEffect, useState, useCallback, useRef } from 'react';
import type { SystemData, SystemOverview } from '../types/api';
import { getSystems, getOverview } from '../services/api';
import WebSocketService from '../services/websocket';

interface UseSystemDataOptions {
  enableWebSocket?: boolean;
  pollingInterval?: number;
}

interface UseSystemDataReturn {
  systems: SystemData[];
  overview: SystemOverview | null;
  loading: boolean;
  error: string | null;
  lastUpdate: Date;
  refreshData: () => Promise<void>;
  isWebSocketConnected: boolean;
}

/**
 * Hook for managing system data with WebSocket real-time updates and HTTP polling fallback
 *
 * Features:
 * - WebSocket for real-time updates when available
 * - Automatic fallback to HTTP polling
 * - Reconnection logic with exponential backoff
 * - Initial data load via HTTP
 */
export function useSystemData(options: UseSystemDataOptions = {}): UseSystemDataReturn {
  const {
    enableWebSocket = true,
    pollingInterval = 3000
  } = options;

  const [systems, setSystems] = useState<SystemData[]>([]);
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);

  const wsRef = useRef<WebSocketService | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  /**
   * Fetch data from HTTP API
   */
  const fetchData = useCallback(async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) {
        setLoading(true);
      }

      const [systemsData, overviewData] = await Promise.all([
        getSystems(),
        getOverview()
      ]);

      if (mountedRef.current) {
        setSystems(systemsData);
        setOverview(overviewData);
        setError(null);
        setLastUpdate(new Date());
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
        console.error('Dashboard refresh error:', err);
      }
    } finally {
      if (isInitialLoad && mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  /**
   * Start HTTP polling fallback
   */
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(() => {
      if (mountedRef.current && !isWebSocketConnected) {
        console.log('⚡ Polling for updates (WebSocket not connected)...');
        fetchData(false);
      }
    }, pollingInterval);
  }, [pollingInterval, isWebSocketConnected, fetchData]);

  /**
   * Stop HTTP polling
   */
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  /**
   * Handle WebSocket system data update
   */
  const handleSystemData = useCallback((data: any) => {
    console.log('📊 Received WebSocket system data:', data);

    if (!mountedRef.current) return;

    // Update specific system in the list
    setSystems(prevSystems => {
      const index = prevSystems.findIndex(s => s.agent_id === data.agentId);
      if (index !== -1) {
        const updated = [...prevSystems];
        updated[index] = {
          ...updated[index],
          current_temperatures: data.sensors || [],
          current_fan_speeds: data.fans || [],
          status: data.status,
          real_time_status: data.status
        };
        return updated;
      }
      return prevSystems;
    });

    setLastUpdate(new Date());
  }, []);

  /**
   * Handle WebSocket connection
   */
  const handleConnect = useCallback(() => {
    console.log('✅ WebSocket connected - stopping HTTP polling');
    setIsWebSocketConnected(true);
    stopPolling();
  }, [stopPolling]);

  /**
   * Initialize WebSocket connection
   */
  useEffect(() => {
    if (!enableWebSocket) {
      console.log('📡 WebSocket disabled - using HTTP polling only');
      startPolling();
      return;
    }

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const wsPort = import.meta.env.VITE_WS_PORT || '3002';
    const wsUrl = `${protocol}//${host}:${wsPort}`;

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    // Create WebSocket instance
    wsRef.current = new WebSocketService(wsUrl);

    // Setup event handlers
    wsRef.current.on('systemData', handleSystemData);
    wsRef.current.on('connected', handleConnect);

    // Connect
    wsRef.current.connect()
      .then(() => {
        console.log('✅ WebSocket connected successfully');

        // Subscribe to all systems updates
        wsRef.current?.subscribe(['systems:all']);

        // Mark as connected
        setIsWebSocketConnected(true);
      })
      .catch((err) => {
        console.error('❌ WebSocket connection failed:', err);
        console.log('📡 Falling back to HTTP polling');
        setIsWebSocketConnected(false);
        startPolling();
      });

    // Cleanup
    return () => {
      if (wsRef.current) {
        wsRef.current.off('systemData', handleSystemData);
        wsRef.current.off('connected', handleConnect);
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enableWebSocket, handleSystemData, handleConnect, startPolling]);

  /**
   * Initial data load
   */
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  /**
   * Monitor WebSocket connection state and start/stop polling accordingly
   */
  useEffect(() => {
    if (isWebSocketConnected) {
      stopPolling();
    } else {
      startPolling();
    }
  }, [isWebSocketConnected, startPolling, stopPolling]);

  /**
   * Periodically check WebSocket connection state
   */
  useEffect(() => {
    if (!enableWebSocket || !wsRef.current) return;

    const checkConnection = setInterval(() => {
      const isConnected = wsRef.current?.isConnected() ?? false;

      if (isWebSocketConnected && !isConnected) {
        console.log('❌ WebSocket disconnected - falling back to HTTP polling');
        setIsWebSocketConnected(false);
      } else if (!isWebSocketConnected && isConnected) {
        console.log('✅ WebSocket reconnected - stopping HTTP polling');
        setIsWebSocketConnected(true);
      }
    }, 2000); // Check every 2 seconds

    return () => clearInterval(checkConnection);
  }, [enableWebSocket, isWebSocketConnected]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopPolling();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [stopPolling]);

  return {
    systems,
    overview,
    loading,
    error,
    lastUpdate,
    refreshData: () => fetchData(false),
    isWebSocketConnected
  };
}
