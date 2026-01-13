import { useState, useCallback, useRef } from 'react';
import { getSensorHistory } from '../../services/api';
import type { HistoryDataPoint, SensorHistory } from '../../types/api';

/**
 * Hook to manage fetching and caching of historical sensor data.
 * Optimized for lazy loading on section expansion and background refreshing.
 */
export const useSensorHistory = (systemId: number) => {
  const [history, setHistory] = useState<SensorHistory>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalHours, setGlobalHours] = useState<number>(24);
  const lastFetched = useRef<number>(0);

  // Group flat history points by sensor/fan name for easy lookup
  const processHistory = (data: HistoryDataPoint[]) => {
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
  };

  // Fetch global setting once
  const fetchGlobalSetting = useCallback(async () => {
    try {
      const { getSetting } = await import('../../services/api');
      const setting = await getSetting('graph_history_hours');
      if (setting && setting.setting_value) {
        setGlobalHours(parseInt(setting.setting_value, 10));
      }
    } catch (err) {
      console.error('Failed to fetch global graph hours setting:', err);
    }
  }, []);

  const fetchHistory = useCallback(async (hours?: number, refresh: boolean = false) => {
    // Use provided hours or fallback to globalHours
    const hoursToFetch = hours !== undefined ? hours : globalHours;
    
    // Only fetch if forced refresh or if we haven't fetched in the last 4 minutes 
    const now = Date.now();
    if (!refresh && (now - lastFetched.current < 240000) && lastFetched.current !== 0) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await getSensorHistory(systemId, hoursToFetch);
      // Backend returns { data: [...] }, ensure we use the array
      const dataArray = Array.isArray(result) ? result : (result as any).data || [];
      const groupedHistory = processHistory(dataArray);
      setHistory(groupedHistory);
      lastFetched.current = now;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sensor history');
      console.error('Error fetching sensor history:', err);
    } finally {
      setLoading(false);
    }
  }, [systemId, globalHours]); // Added globalHours to dependency

  // Fetch global settings on mount
  useState(() => {
    fetchGlobalSetting();
  });

  return {
    history,
    loading,
    error,
    fetchHistory
  };
};
