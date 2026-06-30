import { useCallback, useEffect, useRef, useState } from 'react';
import type { SensorReading, HistoryDataPoint, VirtualSensor } from '../../types/api';
import { getVirtualSensors } from '../../services/virtualSensorsApi';
import { computeAggregate, deriveChipName } from '../../utils/sensorUtils';
import { getSensorDisplayName } from '../../utils/displayNames';

// User-facing operation word used in the row subtitle / tooltip ("Average of ...").
const OP_WORD: Record<VirtualSensor['operation'], string> = {
  max: 'Max',
  avg: 'Average',
  median: 'Middle',
};

// Tier-0 live buffer window (matches the dashboard's live sensor buffer).
const BUFFER_MS = 15 * 60 * 1000;

export interface VirtualSensorRow {
  def: VirtualSensor;          // raw definition (id, name, operation, members)
  reading: SensorReading;      // synthetic row for <SensorItem>
  subtitle: string;            // concise, e.g. "Average of 8 sensors"
  tooltip: string;             // full hover text, members grouped by chip per line
  history: HistoryDataPoint[]; // client-side Tier-0 buffer (no DB history in v1)
}

/**
 * Loads a system's virtual sensor definitions and turns them into synthetic
 * SensorReadings, computing each value client-side from the live member
 * temperatures in `currentTemperatures`. Also maintains a 15-minute Tier-0
 * sparkline buffer per virtual sensor, since virtual values are never reported
 * by an agent and so never appear in systemDelta.
 */
export function useVirtualSensors(
  systemId: number,
  currentTemperatures: SensorReading[] | undefined
): { rows: VirtualSensorRow[]; reload: () => Promise<void>; loading: boolean } {
  const [defs, setDefs] = useState<VirtualSensor[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<VirtualSensorRow[]>([]);
  const bufferRef = useRef<Map<number, HistoryDataPoint[]>>(new Map());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setDefs(await getVirtualSensors(systemId));
    } catch {
      setDefs([]);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Recompute synthetic readings and append to the Tier-0 buffer whenever the
  // member temperatures or the definitions change.
  useEffect(() => {
    const readingByDbId = new Map<number, SensorReading>();
    for (const s of currentTemperatures ?? []) {
      if (s.dbId != null) readingByDbId.set(s.dbId, s);
    }
    const nowIso = new Date().toISOString();
    const cutoff = Date.now() - BUFFER_MS;

    const next: VirtualSensorRow[] = defs.map((def) => {
      const memberTemps = def.members
        .map((m) => readingByDbId.get(m.sensor_id)?.temperature)
        .filter((t): t is number => t != null);
      const value = computeAggregate(def.operation, memberTemps);

      const buf = bufferRef.current.get(def.id) ?? [];
      if (value != null) buf.push({ timestamp: nowIso, temperature: value });
      while (buf.length > 0 && new Date(buf[0].timestamp).getTime() < cutoff) buf.shift();
      bufferRef.current.set(def.id, buf);

      const reading: SensorReading = {
        id: `__virtual__${def.id}`,
        name: def.name,
        label: def.name,
        type: 'virtual',
        temperature: value ?? NaN,
        status: 'ok',
        isVirtual: true,
        operation: def.operation,
        memberIds: def.members.map((m) => m.sensor_id),
      };

      const word = OP_WORD[def.operation];
      // Tooltip: members grouped by chip, one line per group, for readability.
      const byChip = new Map<string, string[]>();
      for (const m of def.members) {
        const r = readingByDbId.get(m.sensor_id);
        const chip = r ? deriveChipName(r.id) : 'unavailable';
        const display = r ? getSensorDisplayName(r.id, r.name, r.label) : m.sensor_name;
        const arr = byChip.get(chip) ?? [];
        arr.push(display);
        byChip.set(chip, arr);
      }
      const tooltip = `${word} of:\n` + [...byChip.values()].map((names) => names.join(', ')).join('\n');

      return {
        def,
        reading,
        subtitle: `${word} of ${def.members.length} sensor${def.members.length === 1 ? '' : 's'}`,
        tooltip,
        history: [...buf],
      };
    });

    setRows(next);
    // currentTemperatures is a fresh array each WebSocket update, which is the
    // intended trigger for recompute + buffer append.
  }, [defs, currentTemperatures]);

  return { rows, reload, loading };
}
