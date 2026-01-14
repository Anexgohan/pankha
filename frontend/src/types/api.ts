// API Response Types
export interface SystemData {
  id: number;
  name: string;
  agent_id: string;
  agent_version?: string;
  ip_address?: string;
  api_endpoint: string;
  websocket_endpoint: string;
  status: "online" | "offline" | "error" | "installing";
  last_seen?: string;
  last_data_received?: string;
  sensor_count: number;
  fan_count: number;
  real_time_status?: string;
  current_temperatures?: SensorReading[];
  current_fan_speeds?: FanReading[];
  current_update_interval?: number;
  fan_step_percent?: number;
  hysteresis_temp?: number;
  emergency_temp?: number;
  log_level?: string;
  failsafe_speed?: number;
  enable_fan_control?: boolean;
  // License limit fields
  read_only?: boolean; // Agent is over license limit (can view but not control)
  access_status?: "active" | "over_limit";
  system_health?: {
    cpuUsage: number;
    memoryUsage: number;
    agentUptime: number;
  };
}

export interface SensorReading {
  id: string;
  name: string;
  label: string;
  type: string;
  temperature: number;
  status: "ok" | "warning" | "critical";
  maxTemp?: number;
  critTemp?: number;
  hardwareName?: string; // Full hardware name (e.g., "AMD Ryzen 9 3900X", "NVIDIA GeForce RTX 2070 SUPER")
  dbId?: number; // Database record ID for fan_profile_assignments
  isHidden?: boolean; // Sensor is hidden by user (individually or via group)
}

export interface FanReading {
  id: string;
  name: string;
  label: string;
  speed: number;
  rpm: number;
  targetSpeed: number;
  status: "ok" | "error" | "stopped";
  dbId?: number; // Database record ID for fan_profile_assignments
}

export interface SystemOverview {
  totalSystems: number;
  onlineSystems: number;
  offlineSystems: number;
  systemsWithErrors: number;
  totalSensors: number;
  totalFans: number;
  avgTemperature: number;
  highestTemperature: number;
  // License limit info
  agentLimit?: number | "unlimited";
  overLimit?: boolean;
  tierName?: string;
}

export interface WebSocketMessage {
  type: string;
  data?: unknown;
  timestamp: string;
}

export interface HistoryDataPoint {
  timestamp: string;
  temperature?: number;
  fan_speed?: number;
  fan_rpm?: number;
  sensor_name?: string;
  sensor_label?: string;
  sensor_type?: string;
  fan_name?: string;
  fan_label?: string;
  /** Gap marker - present on point AFTER a gap (injected during processing) */
  gapBefore?: GapInfo;
}

/** Gap metadata for visualization */
export interface GapInfo {
  startTime: string;    // ISO timestamp of last point before gap
  endTime: string;      // ISO timestamp of first point after gap
  durationMs: number;   // Gap duration in milliseconds
  startValue: number;   // Y value at gap start (for constrained rect height)
  endValue: number;     // Y value at gap end
}

export interface SensorHistory {
  [sensorName: string]: HistoryDataPoint[];
}

export interface SystemHealth {
  agent_id: string;
  status: string;
  last_seen?: string;
  last_data_received?: string;
  real_time_data?: {
    sensors: SensorReading[];
    fans: FanReading[];
    systemHealth: {
      cpuUsage: number;
      memoryUsage: number;
      agentUptime: number;
    };
  };
}
