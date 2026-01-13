import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { getSensorHistory } from '../../services/api';
import { useDashboardSettings } from '../../contexts/DashboardSettingsContext';
import type { HistoryDataPoint, SensorHistory, SensorReading } from '../../types/api';
import WebSocketService from '../../services/websocket';

/** API response shape for history endpoint */
interface HistoryApiResponse {
  data: HistoryDataPoint[];
  data_points: number;
  total_available: number;
}

/** Delta update structure for sensor data */
interface SystemDelta {
  agentId: string;
  timestamp: string;
  changes: {
    sensors?: Record<string, Partial<SensorReading>>;
  };
}

// 15 minutes in milliseconds
const LIVE_BUFFER_DURATION_MS = 15 * 60 * 1000;
// Auto-refresh DB history every 60 seconds
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;

/**
 * Hook to manage fetching and caching of historical sensor data.
 * 
 * Features:
 * - Lazy loading on section expansion
 * - Real-time WebSocket append (Tier 0: last 15 minutes)
 * - Automatic DB refresh every 60 seconds while expanded
 * - Seamless merge of live + historical data
 */
export const useSensorHistory = (systemId: number, agentId?: string) => {
  // DB history (Tier 1+)
  const [dbHistory, setDbHistory] = useState<SensorHistory>({});
  // Live buffer (Tier 0) - maps sensor name to recent points
  const [liveBuffer, setLiveBuffer] = useState<SensorHistory>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { graphScale } = useDashboardSettings();
  const lastFetched = useRef<number>(0);
  const lastScale = useRef<number>(graphScale);
  const isExpanded = useRef<boolean>(false);
  const refreshInterval = useRef<NodeJS.Timeout | null>(null);

  // Group flat history points by sensor/fan name for easy lookup
  const processHistory = useCallback((data: HistoryDataPoint[]) => {
    const grouped: SensorHistory = {};

    data.forEach(point => {
      const name = point.sensor_name || point.fan_name;
      if (!name) return;

      if (!grouped[name]) {
        grouped[name] = [];
      }

      // Ensure temperature is a number (API might return decimal as string)
      const temp = typeof point.temperature === 'string'
        ? parseFloat(point.temperature)
        : point.temperature;

      grouped[name].push({
        ...point,
        temperature: isNaN(temp as number) ? 0 : temp
      });
    });

    return grouped;
  }, []);

  const fetchHistory = useCallback(async (hours?: number, refresh: boolean = false) => {
    // Use provided hours or fallback to graphScale from context
    const hoursToFetch = hours !== undefined ? hours : graphScale;

    // Only fetch if forced refresh or if we haven't fetched in the last 30 seconds
    // (reduced from 4 minutes to allow more frequent updates)
    const now = Date.now();
    if (!refresh && (now - lastFetched.current < 30000) && lastFetched.current !== 0) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await getSensorHistory(systemId, hoursToFetch);
      // Backend returns { data: [...] } or array directly - handle both
      const dataArray = Array.isArray(result)
        ? result
        : (result as HistoryApiResponse).data || [];
      const groupedHistory = processHistory(dataArray);
      setDbHistory(groupedHistory);
      lastFetched.current = now;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sensor history');
      console.error('Error fetching sensor history:', err);
    } finally {
      setLoading(false);
    }
  }, [systemId, graphScale, processHistory]);

  // Handle incoming WebSocket delta updates
  const handleDeltaUpdate = useCallback((delta: SystemDelta) => {
    // Only process updates for this system's agent
    if (!agentId || delta.agentId !== agentId) return;
    
    const { changes, timestamp } = delta;
    if (!changes.sensors) return;

    const sensors = changes.sensors; // Capture for type narrowing
    const now = Date.now();
    const cutoffTime = now - LIVE_BUFFER_DURATION_MS;

    setLiveBuffer(prevBuffer => {
      const newBuffer = { ...prevBuffer };
      
      // Append new sensor readings
      for (const [sensorId, sensorData] of Object.entries(sensors)) {
        if (sensorData.temperature === undefined) continue;
        
        const newPoint: HistoryDataPoint = {
          timestamp,
          temperature: sensorData.temperature,
          sensor_name: sensorId
        };

        if (!newBuffer[sensorId]) {
          newBuffer[sensorId] = [];
        }

        // Append the new point
        newBuffer[sensorId] = [...newBuffer[sensorId], newPoint];
        
        // Trim old points (older than 15 minutes)
        newBuffer[sensorId] = newBuffer[sensorId].filter(
          point => new Date(point.timestamp).getTime() > cutoffTime
        );
      }
      
      return newBuffer;
    });
  }, [agentId]);

  // Subscribe to WebSocket delta events
  useEffect(() => {
    const wsService = new WebSocketService();
    
    const handler = (data: unknown) => {
      handleDeltaUpdate(data as SystemDelta);
    };
    
    wsService.on('systemDelta', handler);
    
    return () => {
      wsService.off('systemDelta', handler);
    };
  }, [handleDeltaUpdate]);

  // Auto-refresh DB history while section is expanded
  const startAutoRefresh = useCallback(() => {
    if (refreshInterval.current) return;
    
    refreshInterval.current = setInterval(() => {
      fetchHistory(graphScale, true);
    }, AUTO_REFRESH_INTERVAL_MS);
  }, [fetchHistory, graphScale]);

  const stopAutoRefresh = useCallback(() => {
    if (refreshInterval.current) {
      clearInterval(refreshInterval.current);
      refreshInterval.current = null;
    }
  }, []);

  // Track expansion state and manage auto-refresh
  const setExpanded = useCallback((expanded: boolean) => {
    isExpanded.current = expanded;
    if (expanded) {
      fetchHistory();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  }, [fetchHistory, startAutoRefresh, stopAutoRefresh]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAutoRefresh();
    };
  }, [stopAutoRefresh]);

  // React to graph scale changes - refetch with new window
  useEffect(() => {
    if (graphScale !== lastScale.current) {
      lastScale.current = graphScale;
      fetchHistory(graphScale, true);
    }
  }, [graphScale, fetchHistory]);

  // Merge DB history with live buffer
  // Live buffer takes precedence for recent data (last 15 min)
  const mergedHistory = useMemo(() => {
    const merged: SensorHistory = {};
    const allSensorNames = new Set([
      ...Object.keys(dbHistory),
      ...Object.keys(liveBuffer)
    ]);

    for (const sensorName of allSensorNames) {
      const dbPoints = dbHistory[sensorName] || [];
      const livePoints = liveBuffer[sensorName] || [];
      
      if (livePoints.length === 0) {
        // No live data, use DB only
        merged[sensorName] = dbPoints;
      } else if (dbPoints.length === 0) {
        // No DB data, use live only
        merged[sensorName] = livePoints;
      } else {
        // Get the oldest live point timestamp to know where to cut DB data
        const oldestLiveTime = new Date(livePoints[0].timestamp).getTime();
        
        // Filter DB points to exclude anything that overlaps with live buffer
        const filteredDbPoints = dbPoints.filter(
          point => new Date(point.timestamp).getTime() < oldestLiveTime
        );
        
        // Merge: DB points (older) + Live points (recent)
        merged[sensorName] = [...filteredDbPoints, ...livePoints];
      }
    }

    return merged;
  }, [dbHistory, liveBuffer]);

  return {
    history: mergedHistory,
    loading,
    error,
    fetchHistory,
    setExpanded
  };
};
