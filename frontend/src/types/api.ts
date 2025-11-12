// API Response Types
export interface SystemData {
  id: number;
  name: string;
  agent_id: string;
  ip_address?: string;
  api_endpoint: string;
  websocket_endpoint: string;
  status: 'online' | 'offline' | 'error' | 'installing';
  last_seen?: string;
  last_data_received?: string;
  sensor_count: number;
  fan_count: number;
  real_time_status?: string;
  current_temperatures?: SensorReading[];
  current_fan_speeds?: FanReading[];
  current_update_interval?: number;
  filter_duplicate_sensors?: boolean;
  duplicate_sensor_tolerance?: number;
  fan_step_percent?: number;
  hysteresis_temp?: number;
  emergency_temp?: number;
  log_level?: string;
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
  status: 'ok' | 'warning' | 'critical';
  maxTemp?: number;
  critTemp?: number;
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
  status: 'ok' | 'error' | 'stopped';
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
}

export interface WebSocketMessage {
  type: string;
  data?: unknown;
  timestamp: string;
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