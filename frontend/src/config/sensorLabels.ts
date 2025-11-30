// Central mapping of hardware identifiers to user-friendly labels displayed in the
// dashboard. The data lives in `sensor-labels.json` so automation can update it safely.

import rawSensorLabels from './sensor-labels.json';

export const SENSOR_LABELS: Record<string, string> = rawSensorLabels as Record<string, string>;

export const getSensorLabel = (chipId: string): string => {
  // Handle raw IDs like "nvidiagpu_0" -> "nvidiagpu"
  // Also handles "k10temp" (no index)
  const baseId = chipId.split('_')[0].toLowerCase();
  
  // Try exact match first, then base ID
  const result = SENSOR_LABELS[chipId] || SENSOR_LABELS[baseId] || SENSOR_LABELS[chipId.toLowerCase()] || chipId.toUpperCase();
  // console.log('getSensorLabel:', chipId, '->', baseId, '->', result);
  return result;
};
