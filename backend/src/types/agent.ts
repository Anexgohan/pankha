// Agent-related type definitions
export interface AgentConfig {
  agentId: string;
  name: string;
  version: string;
  apiEndpoint: string; // 'http://192.168.1.100:8080'
  websocketEndpoint: string; // 'ws://192.168.1.100:8081'
  authToken: string;
  updateInterval: number; // milliseconds
  capabilities: AgentCapabilities;
}

export interface AgentCapabilities {
  sensors: SensorInfo[];
  fans: FanInfo[];
}

export interface SensorInfo {
  id: string;
  name: string; // 'Tctl', 'temp1', 'Composite'
  label: string; // User-friendly name
  chip: string; // 'k10temp-pci-00c3'
  type: "cpu" | "gpu" | "motherboard" | "nvme" | "acpi" | "other";
  currentTemp: number; // Current reading
  maxTemp?: number; // Hardware maximum
  critTemp?: number; // Critical threshold
  tempRegex: string; // For parsing sensor output
  hwmonPath: string; // Hardware path
  tempInputPath: string; // Direct temperature file path
  isAvailable: boolean; // Currently readable
}

export interface FanInfo {
  id: string;
  name: string; // 'fan1', 'fan2'
  label: string; // 'CPU_FAN', 'SYS_FAN1'
  pwmPath: string; // '/sys/class/hwmon/hwmon4/pwm1'
  pwmEnablePath: string; // PWM enable control
  rpmPath: string; // Fan RPM reading path
  currentRpm: number; // Current RPM reading
  isControllable: boolean; // Can be PWM controlled
  minSpeed: number;
  maxSpeed: number;
  dbId?: number; // Database record ID for fan_profile_assignments
  safetyLimits: {
    maxTemp: number; // Emergency full speed trigger
    minSpeed: number; // Never go below this
  };
}

// Real-time Data Protocol
export interface AgentDataPacket {
  agentId: string;
  timestamp: number;
  sensors: Array<{
    id: string;
    temperature: number;
    type?: string; // Sensor type (cpu, gpu, etc.)
    max_temp?: number; // Maximum safe temperature
    crit_temp?: number; // Critical temperature threshold
    status?: "ok" | "caution" | "warning" | "critical"; // Optional - calculated on server if not provided
  }>;
  fans: Array<{
    id: string;
    speed: number; // Current speed percentage
    rpm: number; // Current RPM
    targetSpeed: number; // Requested speed
    status: "ok" | "error" | "stopped";
  }>;
  systemHealth: {
    cpuUsage: number;
    memoryUsage: number;
    agentUptime: number;
  };
}

// Command Protocol
export interface FanControlCommand {
  commandId: string;
  agentId: string;
  type:
    | "setFanSpeed"
    | "setProfile"
    | "emergencyStop"
    | "getStatus"
    | "updateSensorMapping"
    | "rescanSensors"
    | "setUpdateInterval"
    | "setFanStep"
    | "setHysteresis"
    | "setEmergencyTemp"
    | "setLogLevel"
    | "setFailsafeSpeed"
    | "setEnableFanControl"
    | "setAgentName";
  payload: {
    fanId?: string;
    speed?: number;
    profileName?: string;
    sensorMappings?: Array<{
      fanId: string;
      primarySensorId: string;
      secondarySensorId?: string;
      logic: "max" | "avg" | "primary_only";
    }>;
    interval?: number; // For setUpdateInterval command
    step?: number; // For setFanStep command
    hysteresis?: number; // For setHysteresis command
    temp?: number; // For setEmergencyTemp command
    level?: string; // For setLogLevel command
    failsafeSpeed?: number; // For setFailsafeSpeed command (0-100%)
    enabled?: boolean; // For setEnableFanControl command
    name?: string; // For setAgentName command
  };
  timestamp: number;
  priority: "low" | "normal" | "high" | "emergency";
}

export interface SensorDetectionResult {
  agentId: string;
  detectedSensors: Array<{
    chip: string; // Hardware chip identifier
    sensors: Array<{
      name: string; // Raw sensor name from hardware
      label: string; // User-friendly label
      type: "cpu" | "gpu" | "motherboard" | "nvme" | "acpi" | "other";
      currentTemp: number;
      maxTemp?: number;
      critTemp?: number;
      hwmonPath: string;
      tempInputPath: string;
      isWorking: boolean;
    }>;
  }>;
  detectedFans: Array<{
    name: string; // Raw fan name (fan1, fan2, etc.)
    label: string; // User-friendly label
    pwmPath: string;
    rpmPath: string;
    currentRpm: number;
    isControllable: boolean;
    testResults: {
      minSpeedTested: number;
      maxSpeedTested: number;
      responseTime: number; // Milliseconds to respond
    };
  }>;
  systemInfo: {
    cpuModel: string;
    motherboard: string;
    sensors_output: string; // Raw 'sensors' command output
  };
}

export interface AgentStatus {
  agentId: string;
  status: "online" | "offline" | "error" | "installing";
  lastSeen: Date;
  lastDataReceived: Date;
  connectionInfo: {
    apiEndpoint: string;
    websocketEndpoint: string;
    responseTime: number;
    errorCount: number;
    lastError?: string;
  };
}
