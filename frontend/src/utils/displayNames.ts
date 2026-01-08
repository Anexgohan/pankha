/**
 * Display name utilities for sensors and fans.
 * Centralized logic for determining user-friendly display names.
 */

/**
 * Get display name with priority: label → name → id
 * 
 * @param id - The sensor/fan ID (fallback)
 * @param name - The sensor/fan name from the agent
 * @param label - User-defined label from the backend
 * @returns The best available display name
 */
export function getDisplayName(id: string, name: string, label: string): string {
  // Priority: 1. Actual label from backend, 2. Name from backend, 3. ID as last resort
  if (label && label !== id) {
    return label;
  }

  if (name && name !== id) {
    return name;
  }

  return id;
}

/**
 * Get display name for a sensor.
 * Alias for getDisplayName with semantic clarity.
 */
export const getSensorDisplayName = getDisplayName;

/**
 * Get display name for a fan.
 * Alias for getDisplayName with semantic clarity.
 */
export const getFanDisplayName = getDisplayName;
