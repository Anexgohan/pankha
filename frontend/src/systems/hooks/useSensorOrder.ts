import { useCallback, useEffect, useState } from 'react';
import { getSensorOrder } from '../../services/api';
import type { SensorOrderMaps } from '../../types/api';

const EMPTY: SensorOrderMaps = { sensors: {}, groups: {} };

/**
 * Fetches a system's shared/DB-backed sensor + group display order (Phase 2).
 * Off the WebSocket path: fetched once per system and refetched after a reorder.
 * Absent positions are simply missing from the maps, so consumers fall back to the
 * default order via sortByOrder's tiebreaker.
 */
export function useSensorOrder(systemId: number | undefined) {
  const [order, setOrder] = useState<SensorOrderMaps>(EMPTY);

  const refetch = useCallback(async () => {
    if (systemId == null) return;
    try {
      setOrder(await getSensorOrder(systemId));
    } catch {
      setOrder(EMPTY); // order is non-critical; default ordering still applies
    }
  }, [systemId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { order, refetch };
}
