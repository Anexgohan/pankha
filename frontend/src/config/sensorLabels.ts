// Central mapping of hardware identifiers to user-friendly labels displayed in the
// dashboard. The data lives in `sensor-labels.json` so automation can update it safely.

import rawSensorLabels from './sensor-labels.json';

export const SENSOR_LABELS: Record<string, string> = rawSensorLabels as Record<string, string>;

export const getSensorLabel = (chipId: string): string => {
  // Try exact match first, then case-insensitive lookup
  const result = SENSOR_LABELS[chipId] || SENSOR_LABELS[chipId.toLowerCase()] || chipId.toUpperCase();
  console.log('getSensorLabel:', chipId, '->', result, 'available keys:', Object.keys(SENSOR_LABELS));
  return result;
};
