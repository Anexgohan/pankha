/**
 * Status color utilities for consistent UI styling.
 * Centralizes color logic for various status indicators.
 */

/**
 * Get color for agent connection status.
 * Used in SystemCard for system status indicators.
 */
export function getAgentStatusColor(status: string): string {
  switch (status) {
    case 'online':
      return 'var(--temp-normal-text)';
    case 'offline':
      return 'var(--text-tertiary)';
    case 'error':
      return 'var(--temp-critical-text)';
    default:
      return 'var(--temp-warning-text)';
  }
}

/**
 * Get color for import operation result status.
 * Used in ProfileImportExport for import status indicators.
 */
export function getImportStatusColor(status: string): string {
  switch (status) {
    case 'imported':
      return '#4CAF50';
    case 'skipped':
      return '#FF9800';
    case 'error':
      return '#F44336';
    default:
      return '#9E9E9E';
  }
}

/**
 * Generic status color lookup with configurable color map.
 * Use for custom status types.
 */
export function getStatusColor(
  status: string,
  colorMap: Record<string, string>,
  fallback = 'var(--text-tertiary)'
): string {
  return colorMap[status] ?? fallback;
}

/**
 * Get status class for a temperature value.
 * Accepts optional thresholds for user-configurable color coding.
 */
export function getTemperatureClass(
  temp: number,
  critTemp?: number,
  thresholds?: { caution: number; warning: number; critical: number }
): string {
  const t = thresholds || { caution: 60, warning: 70, critical: 85 };
  if (critTemp && temp >= critTemp) return "critical";
  if (temp >= t.critical) return "critical";
  if (temp >= t.warning) return "warning";
  if (temp >= t.caution) return "caution";
  return "normal";
}

/**
 * Get status class for a fan RPM value based on its percentage of max capacity.
 */
export function getFanRPMClass(
  rpm: number,
  allFans: { name: string; rpm: number; min_rpm?: number; max_rpm?: number }[]
): string {
  if (rpm === 0) return "normal";

  // Find the global min/max RPM across all fans to determine percentile
  // This helps visualize which fans are working harder relative to the whole system
  const validFans = allFans.filter(f => f.rpm > 0);
  if (validFans.length === 0) return "normal";

  const maxRPM = Math.max(...validFans.map(f => f.rpm));
  const minRPM = Math.min(...validFans.map(f => f.rpm));
  
  if (maxRPM === minRPM) return "normal";
  
  const range = maxRPM - minRPM;
  const percentile = (rpm - minRPM) / range;

  if (percentile >= 0.85) return "critical"; // Highest RPM (red)
  if (percentile >= 0.7) return "warning"; // High RPM (orange)
  if (percentile >= 0.4) return "caution"; // Medium RPM (yellow)
  return "normal"; // Low RPM (green)
}
