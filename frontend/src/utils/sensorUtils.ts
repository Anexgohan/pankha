/**
 * Sensor utility functions for grouping and sorting sensors.
 *
 * deriveChipName() must stay in sync with backend's deriveChipName() in backend/src/utils/sensorUtils.ts
 */

import type { SensorReading } from '../types/api';

/**
 * Compare two sensor group IDs alphabetically.
 */
export function compareSensorGroups(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Sort sensor group entries alphabetically.
 * Use with Object.entries(sensorGroups).
 */
export function sortSensorGroups(
  groups: Record<string, SensorReading[]>
): [string, SensorReading[]][] {
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Sort an array of group IDs alphabetically.
 */
export function sortSensorGroupIds(groupIds: string[]): string[] {
  return [...groupIds].sort((a, b) => a.localeCompare(b));
}

/**
 * Derive chip/group name from a sensor ID string.
 *
 * Uses a 3-strategy cascade to handle various sensor ID formats:
 * - Strategy 1: Indexed chip - "chip_N" prefix (e.g., nvidiagpu_0, gpu-nvidia_0, amdcpu_0)
 * - Strategy 2: Non-indexed chip - "chip_" prefix (e.g., k10temp, it8628, acpitz)
 * - Strategy 3: Fallback - everything before first underscore, or the full ID
 *
 * Uses [^_]+ (anything except underscore) to handle any chip naming convention
 * (hyphens, dots, etc.) without needing to whitelist specific characters.
 */
export function deriveChipName(sensorId: string): string {
  // Strategy 1: indexed chip - e.g., nvidiagpu_0, gpu-nvidia_0, amdcpu_0, nvme_0
  const indexedChipMatch = sensorId.match(/^([^_]+_\d+)/);
  if (indexedChipMatch?.[1]) return indexedChipMatch[1];

  // Strategy 2: non-indexed chip - e.g., k10temp, it8628, acpitz
  const nonIndexedChipMatch = sensorId.match(/^([^_]+)_/);
  if (nonIndexedChipMatch?.[1]) return nonIndexedChipMatch[1];

  // Strategy 3: fallback - no underscores in ID, return as-is
  return sensorId.split('_')[0] || sensorId;
}

/**
 * Derive group ID from a SensorReading. Convenience wrapper around deriveChipName.
 */
export function deriveSensorGroupId(sensor: SensorReading): string {
  return deriveChipName(sensor.id);
}

export type SensorAggregateOp = 'max' | 'avg' | 'median';

/**
 * Aggregate a set of temperatures by operation. Returns null for an empty set.
 * Mirrors the backend resolver in FanProfileController.getSensorTemperature() so
 * the dashboard display and the control loop agree on a virtual sensor's value.
 */
export function computeAggregate(op: SensorAggregateOp, temps: number[]): number | null {
  if (temps.length === 0) return null;
  if (op === 'avg') return temps.reduce((a, b) => a + b, 0) / temps.length;
  if (op === 'median') {
    const sorted = [...temps].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return Math.max(...temps);
}

/**
 * Group sensors by chip type for organized display.
 * Returns a record mapping chip IDs to arrays of sensors.
 */
export function groupSensorsByChip(
  sensors: SensorReading[]
): Record<string, SensorReading[]> {
  const groups: Record<string, SensorReading[]> = {};

  sensors.forEach((sensor) => {
    const chipName = deriveSensorGroupId(sensor);
    if (!groups[chipName]) {
      groups[chipName] = [];
    }
    groups[chipName].push(sensor);
  });

  return groups;
}
