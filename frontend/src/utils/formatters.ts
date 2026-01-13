/**
 * Formatting utilities for consistent UI display.
 * Centralizes number and date formatting logic.
 */

/**
 * Format temperature for UI display.
 * @param temp - Temperature value (may be null/undefined)
 * @param fallback - Fallback string when temp is falsy
 * @returns Formatted temperature string like "65.3°C"
 */
export function formatTemperature(
  temp: number | null | undefined,
  fallback = 'N/A'
): string {
  if (temp == null) return fallback;
  return `${temp.toFixed(1)}°C`;
}

/**
 * Format RPM for UI display.
 * @param rpm - RPM value
 * @returns Formatted RPM string like "1250 RPM"
 */
export function formatRPM(rpm: number): string {
  return `${Math.round(rpm)} RPM`;
}

/**
 * Format relative time (e.g., "5m ago", "2h ago").
 * @param lastSeen - ISO date string of last seen time
 * @param timezone - Server timezone for cutoff formatting
 * @returns Human-readable relative time string
 */
export function formatLastSeen(lastSeen?: string, timezone: string = 'UTC'): string {
  if (!lastSeen) return 'Never';
  const date = new Date(lastSeen);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString([], { timeZone: timezone });
}

/**
 * Format date in server timezone.
 * @param dateStr - ISO date string
 * @param timezone - Server timezone
 * @returns Formatted date string
 */
export function formatDate(dateStr: string, timezone: string = 'UTC'): string {
  return new Date(dateStr).toLocaleDateString([], { timeZone: timezone });
}

/**
 * Format percentage for UI display.
 * @param value - Percentage value (0-100)
 * @returns Formatted percentage string like "75%"
 */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
