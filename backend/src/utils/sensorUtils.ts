/**
 * Sensor Utility Functions (Backend)
 *
 * Shared chip name extraction logic for sensor grouping.
 * deriveChipName() must stay in sync with frontend's deriveChipName() in frontend/src/utils/sensorUtils.ts
 */

/**
 * Derive chip/group name from a sensor ID string.
 *
 * Uses a 3-strategy cascade to handle various sensor ID formats:
 * - Strategy 1: Indexed chip — "chip_N" prefix (e.g., nvidiagpu_0, gpu-nvidia_0, amdcpu_0)
 * - Strategy 2: Non-indexed chip — "chip_" prefix (e.g., k10temp, it8628, acpitz)
 * - Strategy 3: Fallback — everything before first underscore, or the full ID
 *
 * Uses [^_]+ (anything except underscore) to handle any chip naming convention
 * (hyphens, dots, etc.) without needing to whitelist specific characters.
 */
export function deriveChipName(sensorId: string): string {
  // Strategy 1: indexed chip — e.g., nvidiagpu_0, gpu-nvidia_0, amdcpu_0, nvme_0
  const indexedChipMatch = sensorId.match(/^([^_]+_\d+)/);
  if (indexedChipMatch?.[1]) return indexedChipMatch[1];

  // Strategy 2: non-indexed chip — e.g., k10temp, it8628, acpitz
  const nonIndexedChipMatch = sensorId.match(/^([^_]+)_/);
  if (nonIndexedChipMatch?.[1]) return nonIndexedChipMatch[1];

  // Strategy 3: fallback — no underscores in ID, return as-is
  return sensorId.split('_')[0] || sensorId;
}
