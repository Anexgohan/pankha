/**
 * Sensor Utility Functions (Backend)
 *
 * Shared chip name extraction logic for sensor grouping.
 * Must stay in sync with frontend's deriveSensorGroupId() in frontend/src/utils/sensorUtils.ts
 */

/**
 * Derive chip/group name from a sensor ID.
 *
 * Uses a 3-strategy cascade to handle various sensor ID formats:
 * - Strategy 1: Indexed chip (nvidiagpu_0, amdcpu_0) from IDs like nvidiagpu_0_temperature1
 * - Strategy 2: Non-indexed chip (k10temp, it8628) from IDs like k10temp_tctl
 * - Strategy 3: Fallback split on first underscore
 */
export function deriveChipName(sensorId: string): string {
  // Strategy 1: indexed chip pattern - e.g., nvidiagpu_0, amdcpu_0
  const indexedChipMatch = sensorId.match(/^([a-z0-9]+_\d+)/i);
  if (indexedChipMatch?.[1]) return indexedChipMatch[1];

  // Strategy 2: non-indexed chip pattern - e.g., k10temp, it8628
  const nonIndexedChipMatch = sensorId.match(/^([a-z0-9]+)_/i);
  if (nonIndexedChipMatch?.[1]) return nonIndexedChipMatch[1];

  // Strategy 3: fallback
  return sensorId.split('_')[0] || sensorId;
}
