/**
 * Aggregated System Data Types
 *
 * These types are shared between DataAggregator and DeltaComputer
 * to ensure consistency in data structure and delta computation.
 */

export interface SensorReading {
  id: string;
  name: string;
  label: string;
  type: string;
  temperature: number;
  status: 'ok' | 'caution' | 'warning' | 'critical';
  maxTemp?: number;
  critTemp?: number;
  dbId?: number;
  isHidden?: boolean;
}

export interface FanReading {
  id: string;
  name: string;
  label: string;
  speed: number;
  rpm: number;
  targetSpeed: number;
  status: 'ok' | 'error' | 'stopped';
  dbId?: number;
}

export interface SystemHealth {
  cpuUsage: number;
  memoryUsage: number;
  agentUptime: number;
}

/**
 * Aggregated system data structure
 *
 * This interface is used by:
 * - DataAggregator: to create and store aggregated data
 * - DeltaComputer: to compute deltas between states
 * - WebSocketHub: to broadcast system data to clients
 *
 * IMPORTANT: Any changes to this interface must be coordinated across all three services
 */
export interface AggregatedSystemData {
  systemId: number;
  agentId: string;
  systemName: string;
  status: 'online' | 'offline' | 'error';
  lastUpdate: Date;
  sensors: SensorReading[];
  fans: FanReading[];
  systemHealth: SystemHealth;

  // Agent configuration fields
  // NOTE: These values are included so DeltaComputer can detect config changes
  // and send delta updates when user modifies settings via GUI
  current_update_interval?: number;
  filter_duplicate_sensors?: boolean;
  duplicate_sensor_tolerance?: number;
  fan_step_percent?: number;
  hysteresis_temp?: number;
  emergency_temp?: number;
  log_level?: string;
}
