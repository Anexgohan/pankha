import { useState, useCallback, useRef, useEffect } from 'react';
import { getSensorHistory } from '../../services/api';
import { useDashboardSettings } from '../../contexts/DashboardSettingsContext';
import type { HistoryDataPoint, SensorHistory } from '../../types/api';

/** API response shape for history endpoint */
interface HistoryApiResponse {
  data: HistoryDataPoint[];
  data_points: number;
  total_available: number;
}

/**
 * Hook to manage fetching and caching of historical sensor data.
 * Optimized for lazy loading on section expansion and background refreshing.
 */
export const useSensorHistory = (systemId: number) => {
  const [history, setHistory] = useState<SensorHistory>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { graphScale } = useDashboardSettings();
  const lastFetched = useRef<number>(0);
  const lastScale = useRef<number>(graphScale);

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

    // Only fetch if forced refresh or if we haven't fetched in the last 4 minutes
    const now = Date.now();
    if (!refresh && (now - lastFetched.current < 240000) && lastFetched.current !== 0) {
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
      setHistory(groupedHistory);
      lastFetched.current = now;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sensor history');
      console.error('Error fetching sensor history:', err);
    } finally {
      setLoading(false);
    }
  }, [systemId, graphScale, processHistory]);

  // React to graph scale changes - refetch with new window
  useEffect(() => {
    if (graphScale !== lastScale.current) {
      lastScale.current = graphScale;
      fetchHistory(graphScale, true);
    }
  }, [graphScale, fetchHistory]);

  return {
    history,
    loading,
    error,
    fetchHistory
  };
};
