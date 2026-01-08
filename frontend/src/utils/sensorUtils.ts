/**
 * Sensor utility functions for grouping and sorting sensors
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
 * Derive group ID from sensor ID using hardware-agnostic pattern extraction.
 * Handles various sensor ID formats from Windows/Linux agents.
 */
export function deriveSensorGroupId(sensor: SensorReading): string {
  // Strategy:
  // 1. Look for "Chip ID" pattern: [alphanumeric]_[digits] (e.g. nvidiagpu_0, amdcpu_0)
  //    This covers most Windows/Linux indexed chips.
  const indexedChipMatch = sensor.id.match(/^([a-z0-9]+_\d+)/i);
  if (indexedChipMatch?.[1]) {
    return indexedChipMatch[1];
  }

  // 2. Look for "Chip ID" pattern without index: [alphanumeric]_ (e.g. k10temp_tctl, it8628_fan1)
  //    This covers Linux chips that don't have an index suffix on the chip name itself.
  const nonIndexedChipMatch = sensor.id.match(/^([a-z0-9]+)_/i);
  if (nonIndexedChipMatch?.[1]) {
    return nonIndexedChipMatch[1];
  }

  // 3. Fallback to old logic for safety (e.g. if ID has no underscores)
  const standardMatch = sensor.id.match(/^([a-z0-9_]+?)_\d+$/i);
  if (standardMatch?.[1]) {
    return standardMatch[1];
  }

  // Fallback to sensor type
  return sensor.type || 'other';
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
