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
  1: 3 * 60 * 1000, // 1h view -> 3 min threshold
  6: 5 * 60 * 1000, // 6h view -> 5 min threshold
  24: 10 * 60 * 1000, // 24h view -> 10 min threshold
  168: 30 * 60 * 1000, // 7d view -> 30 min threshold
  720: 90 * 60 * 1000, // 30d view -> 90 min threshold
};
const MIN_GAP_THRESHOLD_MS = 3 * 60 * 1000; // Minimum 3 minutes to be considered a gap
const GAP_THRESHOLD_MULTIPLIER = 3; // A gap is 3x the expected interval

// 15 minutes in milliseconds
const LIVE_BUFFER_DURATION_MS = 15 * 60 * 1000;
// Auto-refresh DB history every 60 seconds
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
// Compact deque-like buffers when front-trim grows large
const LIVE_BUFFER_COMPACT_THRESHOLD = 256;

interface SeriesStore {
  points: HistoryDataPoint[];
  tsMs: number[];
}

interface LiveSeriesBuffer {
  points: HistoryDataPoint[];
  tsMs: number[];
  startIndex: number;
}

interface QueuedLivePoint {
  timestamp: string;
  tsMs: number;
  temperature: number;
}

/** API response shape for history endpoint */
interface HistoryApiResponse {
  data: HistoryDataPoint[];
  data_points: number;
  total_available: number;
}

function toTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function normalizeTemperature(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function lowerBound(sortedValues: number[], target: number): number {
  let left = 0;
  let right = sortedValues.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (sortedValues[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; code?: string };
  return err.name === 'CanceledError' || err.name === 'AbortError' || err.code === 'ERR_CANCELED';
}

/**
 * Detect gaps in sensor data and mark points that follow a gap.
 * O(n) single pass algorithm using pre-parsed timestamp values.
 */
function detectAndMarkGaps(
  points: HistoryDataPoint[],
  tsMs: number[],
  graphScale: number
): HistoryDataPoint[] {
  if (points.length < 2) return points;

  // Calculate median interval from first 10 points for adaptive threshold
  const intervals: number[] = [];
  const sampleSize = Math.min(10, points.length - 1);

  for (let i = 1; i <= sampleSize; i++) {
    intervals.push(tsMs[i] - tsMs[i - 1]);
  }

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

  const result: HistoryDataPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const delta = tsMs[i] - tsMs[i - 1];

    if (delta > threshold) {
      const prevPoint = points[i - 1];
      const currPoint = points[i];
      const gapInfo: GapInfo = {
        startTime: prevPoint.timestamp,
        endTime: currPoint.timestamp,
        durationMs: delta,
        startValue: prevPoint.temperature ?? prevPoint.fan_speed ?? 0,
        endValue: currPoint.temperature ?? currPoint.fan_speed ?? 0,
      };
      result.push({ ...currPoint, gapBefore: gapInfo });
    } else {
      result.push(points[i]);
    }
  }

  return result;
}

/**
 * Hook to manage fetching and caching of historical sensor data.
 *
 * Features:
 * - Lazy loading on section expansion
 * - Batched real-time WebSocket appends (Tier 0: last 15 minutes)
 * - Automatic DB refresh every 60 seconds while expanded
 * - Seamless merge of live + historical data
 */
export const useSensorHistory = (
  systemId: number,
  agentId?: string,
  isCardVisible: boolean = true
) => {
  const [dbSeries, setDbSeries] = useState<Record<string, SeriesStore>>({});
  const [liveVersion, setLiveVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpandedState, setIsExpandedState] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );

  const { graphScale } = useDashboardSettings();

  const lastFetched = useRef<number>(0);
  const lastScale = useRef<number>(graphScale);
  const isExpanded = useRef<boolean>(false);
  const refreshInterval = useRef<NodeJS.Timeout | null>(null);

  const isCardVisibleRef = useRef<boolean>(isCardVisible);
  const isDocumentVisibleRef = useRef<boolean>(isDocumentVisible);

  const liveBuffersRef = useRef<Map<string, LiveSeriesBuffer>>(new Map());
  const pendingLiveUpdatesRef = useRef<Map<string, QueuedLivePoint[]>>(new Map());
  const liveFlushRafRef = useRef<number | null>(null);
  const liveFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLiveChangedSensorsRef = useRef<Set<string>>(new Set());

  const activeRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const mergedHistoryRef = useRef<SensorHistory>({});
  const previousDbSeriesRef = useRef<Record<string, SeriesStore>>(dbSeries);
  const previousGraphScaleRef = useRef<number>(graphScale);

  useEffect(() => {
    isCardVisibleRef.current = isCardVisible;
  }, [isCardVisible]);

  useEffect(() => {
    isDocumentVisibleRef.current = isDocumentVisible;
  }, [isDocumentVisible]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Group flat history points by sensor/fan name and precompute timestamps.
  const processHistory = useCallback((data: HistoryDataPoint[]) => {
    const grouped: Record<string, SeriesStore> = {};

    for (const point of data) {
      const name = point.sensor_name || point.fan_name;
      if (!name) continue;

      if (!grouped[name]) {
        grouped[name] = { points: [], tsMs: [] };
      }

      const normalizedPoint: HistoryDataPoint = {
        ...point,
        temperature: normalizeTemperature(point.temperature),
      };

      grouped[name].points.push(normalizedPoint);
      grouped[name].tsMs.push(toTimestampMs(normalizedPoint.timestamp));
    }

    return grouped;
  }, []);

  const pruneLiveBuffers = useCallback((cutoffTime: number): Set<string> => {
    const changed = new Set<string>();

    for (const [sensorId, buffer] of liveBuffersRef.current.entries()) {
      const originalStart = buffer.startIndex;
      while (buffer.startIndex < buffer.tsMs.length && buffer.tsMs[buffer.startIndex] <= cutoffTime) {
        buffer.startIndex++;
      }

      if (buffer.startIndex !== originalStart) {
        changed.add(sensorId);
      }

      if (buffer.startIndex >= LIVE_BUFFER_COMPACT_THRESHOLD && buffer.startIndex * 2 >= buffer.points.length) {
        buffer.points = buffer.points.slice(buffer.startIndex);
        buffer.tsMs = buffer.tsMs.slice(buffer.startIndex);
        buffer.startIndex = 0;
        changed.add(sensorId);
      }

      if (buffer.startIndex >= buffer.points.length) {
        if (buffer.points.length > 0) {
          changed.add(sensorId);
        }
        buffer.points = [];
        buffer.tsMs = [];
        buffer.startIndex = 0;
      }
    }

    return changed;
  }, []);

  const flushPendingLiveUpdates = useCallback(() => {
    const pending = pendingLiveUpdatesRef.current;
    if (pending.size === 0) return;

    const cutoffTime = Date.now() - LIVE_BUFFER_DURATION_MS;
    const changedSensors = new Set<string>();

    for (const [sensorId, queuedPoints] of pending.entries()) {
      if (queuedPoints.length === 0) continue;

      let buffer = liveBuffersRef.current.get(sensorId);
      if (!buffer) {
        buffer = { points: [], tsMs: [], startIndex: 0 };
        liveBuffersRef.current.set(sensorId, buffer);
      }

      for (const queued of queuedPoints) {
        buffer.points.push({
          timestamp: queued.timestamp,
          temperature: queued.temperature,
          sensor_name: sensorId,
        });
        buffer.tsMs.push(queued.tsMs);
      }
      changedSensors.add(sensorId);
    }

    pending.clear();

    const prunedSensors = pruneLiveBuffers(cutoffTime);
    for (const sensorId of prunedSensors) {
      changedSensors.add(sensorId);
    }

    if (changedSensors.size > 0) {
      lastLiveChangedSensorsRef.current = changedSensors;
      setLiveVersion((value) => value + 1);
    }
  }, [pruneLiveBuffers]);

  const scheduleLiveFlush = useCallback(() => {
    if (liveFlushRafRef.current !== null || liveFlushTimerRef.current !== null) {
      return;
    }

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      liveFlushRafRef.current = window.requestAnimationFrame(() => {
        liveFlushRafRef.current = null;
        flushPendingLiveUpdates();
      });
      return;
    }

    liveFlushTimerRef.current = setTimeout(() => {
      liveFlushTimerRef.current = null;
      flushPendingLiveUpdates();
    }, 16);
  }, [flushPendingLiveUpdates]);

  const fetchHistory = useCallback(async (hours?: number, refresh: boolean = false) => {
    // Use provided hours or fallback to graphScale from context
    const hoursToFetch = hours !== undefined ? hours : graphScale;

    // Only fetch if forced refresh or if we haven't fetched in the last 30 seconds
    const now = Date.now();
    if (!refresh && (now - lastFetched.current < 30000) && lastFetched.current !== 0) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;

    const controller = typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await getSensorHistory(systemId, hoursToFetch, {
        signal: controller?.signal,
      });
      if (activeRequestIdRef.current !== requestId) return;

      // Backend returns { data: [...] } or array directly - handle both
      const dataArray = Array.isArray(result)
        ? result
        : (result as HistoryApiResponse).data || [];

      setDbSeries(processHistory(dataArray));
      lastFetched.current = now;
    } catch (err) {
      if (activeRequestIdRef.current !== requestId || isAbortError(err)) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to fetch sensor history');
      console.error('Error fetching sensor history:', err);
    } finally {
      if (activeRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [systemId, graphScale, processHistory]);

  // Handle incoming WebSocket delta updates (batched).
  const handleDeltaUpdate = useCallback((delta: SystemDelta) => {
    // Only process updates for this system's agent
    if (!agentId || delta.agentId !== agentId) return;

    const { changes, timestamp } = delta;
    if (!changes.sensors) return;

    const tsMs = toTimestampMs(timestamp);
    const pending = pendingLiveUpdatesRef.current;

    for (const [sensorId, sensorData] of Object.entries(changes.sensors)) {
      if (sensorData.temperature === undefined) continue;

      if (!pending.has(sensorId)) {
        pending.set(sensorId, []);
      }

      pending.get(sensorId)!.push({
        timestamp,
        tsMs,
        temperature: sensorData.temperature,
      });
    }

    scheduleLiveFlush();
  }, [agentId, scheduleLiveFlush]);

  // Subscribe to shared delta stream from the existing dashboard WebSocket
  useEffect(() => {
    return subscribeToSystemDelta(handleDeltaUpdate);
  }, [handleDeltaUpdate]);

  // Periodic pruning keeps live tail strict even if no new deltas arrive.
  useEffect(() => {
    const timer = setInterval(() => {
      const changedSensors = pruneLiveBuffers(Date.now() - LIVE_BUFFER_DURATION_MS);
      if (changedSensors.size > 0) {
        lastLiveChangedSensorsRef.current = changedSensors;
        setLiveVersion((value) => value + 1);
      }
    }, 30_000);

    return () => {
      clearInterval(timer);
    };
  }, [pruneLiveBuffers]);

  // Auto-refresh DB history while section is expanded
  const startAutoRefresh = useCallback(() => {
    if (refreshInterval.current) return;

    refreshInterval.current = setInterval(() => {
      if (!isExpanded.current) return;
      if (!isCardVisibleRef.current) return;
      if (!isDocumentVisibleRef.current) return;
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
    setIsExpandedState(expanded);

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
      abortControllerRef.current?.abort();
      if (liveFlushRafRef.current !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(liveFlushRafRef.current);
      }
      if (liveFlushTimerRef.current !== null) {
        clearTimeout(liveFlushTimerRef.current);
      }
    };
  }, [stopAutoRefresh]);

  // React to graph scale changes - refetch with new window
  useEffect(() => {
    if (graphScale !== lastScale.current) {
      lastScale.current = graphScale;
      if (isExpanded.current) {
        fetchHistory(graphScale, true);
      }
    }
  }, [graphScale, fetchHistory]);

  const shouldComputeMergedHistory = isExpandedState && isCardVisible && isDocumentVisible;

  // Merge DB history with live buffer, then detect gaps.
  // Live buffer takes precedence for recent data (last 15 min).
  const mergedHistory = useMemo(() => {
    if (!shouldComputeMergedHistory) {
      return mergedHistoryRef.current;
    }

    const nextMerged: SensorHistory = {};
    const previousMerged = mergedHistoryRef.current;
    const dbChanged = previousDbSeriesRef.current !== dbSeries;
    const scaleChanged = previousGraphScaleRef.current !== graphScale;
    const liveChangedSensors = lastLiveChangedSensorsRef.current;
    const cutoffTime = Date.now() - LIVE_BUFFER_DURATION_MS;

    const allSeriesNames = new Set([
      ...Object.keys(dbSeries),
      ...Array.from(liveBuffersRef.current.keys()),
    ]);

    for (const sensorName of allSeriesNames) {
      const canReusePrevious =
        !dbChanged &&
        !scaleChanged &&
        !liveChangedSensors.has(sensorName) &&
        previousMerged[sensorName] !== undefined;

      if (canReusePrevious) {
        nextMerged[sensorName] = previousMerged[sensorName];
        continue;
      }

      const dbData = dbSeries[sensorName];
      const dbPoints = dbData?.points ?? [];
      const dbTs = dbData?.tsMs ?? [];

      const liveBuffer = liveBuffersRef.current.get(sensorName);
      let livePoints: HistoryDataPoint[] = [];
      let liveTs: number[] = [];

      if (liveBuffer) {
        while (liveBuffer.startIndex < liveBuffer.tsMs.length && liveBuffer.tsMs[liveBuffer.startIndex] <= cutoffTime) {
          liveBuffer.startIndex++;
        }

        if (liveBuffer.startIndex >= LIVE_BUFFER_COMPACT_THRESHOLD && liveBuffer.startIndex * 2 >= liveBuffer.points.length) {
          liveBuffer.points = liveBuffer.points.slice(liveBuffer.startIndex);
          liveBuffer.tsMs = liveBuffer.tsMs.slice(liveBuffer.startIndex);
          liveBuffer.startIndex = 0;
        }

        if (liveBuffer.startIndex < liveBuffer.points.length) {
          livePoints = liveBuffer.points.slice(liveBuffer.startIndex);
          liveTs = liveBuffer.tsMs.slice(liveBuffer.startIndex);
        }
      }

      let combinedPoints: HistoryDataPoint[];
      let combinedTs: number[];

      if (livePoints.length === 0) {
        combinedPoints = dbPoints;
        combinedTs = dbTs;
      } else if (dbPoints.length === 0) {
        combinedPoints = livePoints;
        combinedTs = liveTs;
      } else {
        const oldestLiveTime = liveTs[0];
        const dbCutoffIndex = lowerBound(dbTs, oldestLiveTime);
        const filteredDbPoints = dbPoints.slice(0, dbCutoffIndex);
        const filteredDbTs = dbTs.slice(0, dbCutoffIndex);
        combinedPoints = [...filteredDbPoints, ...livePoints];
        combinedTs = [...filteredDbTs, ...liveTs];
      }

      nextMerged[sensorName] = detectAndMarkGaps(combinedPoints, combinedTs, graphScale);
    }

    mergedHistoryRef.current = nextMerged;
    previousDbSeriesRef.current = dbSeries;
    previousGraphScaleRef.current = graphScale;
    lastLiveChangedSensorsRef.current = new Set();
    return nextMerged;
  }, [dbSeries, liveVersion, graphScale, shouldComputeMergedHistory]);

  return {
    history: mergedHistory,
    loading,
    error,
    fetchHistory,
    setExpanded,
  };
};

