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
      return '#4CAF50';
    case 'offline':
      return '#9E9E9E';
    case 'error':
      return '#F44336';
    default:
      return '#FF9800';
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
