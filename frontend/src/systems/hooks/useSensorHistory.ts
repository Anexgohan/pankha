import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { getSensorHistory } from '../../services/api';
import { useDashboardSettings } from '../../contexts/DashboardSettingsContext';
import type { HistoryDataPoint, SensorHistory, GapInfo } from '../../types/api';
import {
  subscribeToSystemDelta,
  type SystemDelta,
} from '../../hooks/useWebSocketData';

// Gap detection thresholds by graph scale (in ms)
// Used as fallback when data is too sparse to calculate adaptive threshold
const SCALE_THRESHOLDS: Record<number, number> = {
  1:   3 * 60 * 1000,    // 1h view → 3 min threshold
  6:   5 * 60 * 1000,    // 6h view → 5 min threshold
  24:  10 * 60 * 1000,   // 24h view → 10 min threshold
  168: 30 * 60 * 1000,   // 7d view → 30 min threshold
  720: 90 * 60 * 1000,   // 30d view → 90 min threshold
};
const MIN_GAP_THRESHOLD_MS = 3 * 60 * 1000; // Minimum 3 minutes to be considered a gap
const GAP_THRESHOLD_MULTIPLIER = 3; // A gap is 3x the expected interval

/**
 * Detect gaps in sensor data and mark points that follow a gap.
 * O(n) single pass algorithm.
 * 
 * @param points - Array of data points sorted by timestamp
 * @param graphScale - Current graph scale in hours (for fallback threshold)
 * @returns Points with gapBefore metadata where applicable
 */
function detectAndMarkGaps(
  points: HistoryDataPoint[],
  graphScale: number
): HistoryDataPoint[] {
  if (points.length < 2) return points;

  // Calculate median interval from first 10 points for adaptive threshold
  const intervals: number[] = [];
  const sampleSize = Math.min(10, points.length - 1);
  
  for (let i = 1; i <= sampleSize; i++) {
    const prevTime = new Date(points[i - 1].timestamp).getTime();
    const currTime = new Date(points[i].timestamp).getTime();
    intervals.push(currTime - prevTime);
  }

  // Sort and get median
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)] || 60000;

  // Calculate threshold: use adaptive if enough data, otherwise fallback to scale-based
  const adaptiveThreshold = Math.max(
    medianInterval * GAP_THRESHOLD_MULTIPLIER,
    MIN_GAP_THRESHOLD_MS
  );
  const threshold = points.length > 10
    ? adaptiveThreshold
    : (SCALE_THRESHOLDS[graphScale] ?? MIN_GAP_THRESHOLD_MS);

  // Single pass: mark gaps
  const result: HistoryDataPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prevPoint = points[i - 1];
    const currPoint = points[i];
    const prevTime = new Date(prevPoint.timestamp).getTime();
    const currTime = new Date(currPoint.timestamp).getTime();
    const delta = currTime - prevTime;

    if (delta > threshold) {
      // Gap detected - mark this point
      const gapInfo: GapInfo = {
        startTime: prevPoint.timestamp,
        endTime: currPoint.timestamp,
        durationMs: delta,
        startValue: prevPoint.temperature ?? prevPoint.fan_speed ?? 0,
        endValue: currPoint.temperature ?? currPoint.fan_speed ?? 0,
      };
      result.push({ ...currPoint, gapBefore: gapInfo });
    } else {
      result.push(currPoint);
    }
  }

  return result;
}

/** API response shape for history endpoint */
interface HistoryApiResponse {
  data: HistoryDataPoint[];
  data_points: number;
  total_available: number;
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

  // Subscribe to shared delta stream from the existing dashboard WebSocket
  useEffect(() => {
    return subscribeToSystemDelta(handleDeltaUpdate);
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

  // Merge DB history with live buffer, then detect gaps
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
      
      let combinedPoints: HistoryDataPoint[];
      
      if (livePoints.length === 0) {
        // No live data, use DB only
        combinedPoints = dbPoints;
      } else if (dbPoints.length === 0) {
        // No DB data, use live only
        combinedPoints = livePoints;
      } else {
        // Get the oldest live point timestamp to know where to cut DB data
        const oldestLiveTime = new Date(livePoints[0].timestamp).getTime();
        
        // Filter DB points to exclude anything that overlaps with live buffer
        const filteredDbPoints = dbPoints.filter(
          point => new Date(point.timestamp).getTime() < oldestLiveTime
        );
        
        // Merge: DB points (older) + Live points (recent)
        combinedPoints = [...filteredDbPoints, ...livePoints];
      }
      
      // Detect and mark gaps in the combined data
      merged[sensorName] = detectAndMarkGaps(combinedPoints, graphScale);
    }

    return merged;
  }, [dbHistory, liveBuffer, graphScale]);

  return {
    history: mergedHistory,
    loading,
    error,
    fetchHistory,
    setExpanded
  };
};
