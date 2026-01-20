import axios from "axios";
import type { SystemData, SystemOverview, SystemHealth, HistoryDataPoint } from "../types/api";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// Health and Overview
export const getHealth = async () => {
  const response = await api.get("/health");
  return response.data;
};

export const getOverview = async (): Promise<SystemOverview> => {
  const response = await api.get("/api/overview");
  return response.data;
};

// Systems
export const getSystems = async (): Promise<SystemData[]> => {
  const response = await api.get("/api/systems");
  return response.data;
};

export const getSystem = async (id: number): Promise<SystemData> => {
  const response = await api.get(`/api/systems/${id}`);
  return response.data;
};

export const getSystemStatus = async (id: number): Promise<SystemHealth> => {
  const response = await api.get(`/api/systems/${id}/status`);
  return response.data;
};

export const deleteSystem = async (id: number): Promise<void> => {
  await api.delete(`/api/systems/${id}`);
};

export const getSensors = async (id: number) => {
  const response = await api.get(`/api/systems/${id}/sensors`);
  return response.data;
};

export const getFans = async (id: number) => {
  const response = await api.get(`/api/systems/${id}/fans`);
  return response.data;
};

// Sensor and Fan Labels
export const updateSensorLabel = async (
  systemId: number,
  sensorId: number,
  label: string
): Promise<void> => {
  const response = await api.put(
    `/api/systems/${systemId}/sensors/${sensorId}/label`,
    {
      label,
    }
  );
  return response.data;
};

export const updateFanLabel = async (
  systemId: number,
  fanId: number,
  label: string
): Promise<void> => {
  const response = await api.put(
    `/api/systems/${systemId}/fans/${fanId}/label`,
    {
      label,
    }
  );
  return response.data;
};

// Agent Name
export const updateAgentName = async (
  systemId: number,
  name: string
): Promise<void> => {
  const response = await api.put(`/api/systems/${systemId}/name`, {
    name,
  });
  return response.data;
};

// Fan Control
export const setFanSpeed = async (
  systemId: number,
  fanId: string,
  speed: number,
  priority: string = "normal"
) => {
  const response = await api.put(`/api/systems/${systemId}/fans/${fanId}`, {
    speed,
    priority,
  });
  return response.data;
};

export const applyFanProfile = async (
  systemId: number,
  profileName: string
) => {
  const response = await api.put(`/api/systems/${systemId}/profile`, {
    profile_name: profileName,
  });
  return response.data;
};

// Agent Configuration
export const setAgentUpdateInterval = async (
  systemId: number,
  interval: number,
  priority: string = "normal"
) => {
  const response = await api.put(`/api/systems/${systemId}/update-interval`, {
    interval,
    priority,
  });
  return response.data;
};

export const setFanStep = async (
  systemId: number,
  step: number,
  priority: string = "normal"
) => {
  const response = await api.put(`/api/systems/${systemId}/fan-step`, {
    step,
    priority,
  });
  return response.data;
};

export const setHysteresis = async (
  systemId: number,
  hysteresis: number,
  priority: string = "normal"
) => {
  const response = await api.put(`/api/systems/${systemId}/hysteresis`, {
    hysteresis,
    priority,
  });
  return response.data;
};

export const setEmergencyTemp = async (
  systemId: number,
  temp: number,
  priority: string = "normal"
) => {
  const response = await api.put(`/api/systems/${systemId}/emergency-temp`, {
    temp,
    priority,
  });
  return response.data;
};

export const setLogLevel = async (
  systemId: number,
  level: string,
  priority: string = "normal"
) => {
  const response = await api.put(`/api/systems/${systemId}/log-level`, {
    level,
    priority,
  });
  return response.data;
};

export const setFailsafeSpeed = async (
  systemId: number,
  speed: number,
  priority: string = "normal"
) => {
  const response = await api.put(`/api/systems/${systemId}/failsafe-speed`, {
    speed,
    priority,
  });
  return response.data;
};

export const setEnableFanControl = async (
  systemId: number,
  enabled: boolean,
  priority: string = "normal"
) => {
  const response = await api.put(
    `/api/systems/${systemId}/enable-fan-control`,
    {
      enabled,
      priority,
    }
  );
  return response.data;
};

// Emergency
export const emergencyStop = async () => {
  const response = await api.post("/api/emergency-stop");
  return response.data;
};

// Backend Controller
export const getControllerStatus = async () => {
  const response = await api.get("/api/systems/controller/status");
  return response.data;
};

export const setControllerInterval = async (interval: number) => {
  const response = await api.put("/api/systems/controller/interval", {
    interval,
  });
  return response.data;
};

// WebSocket info
export const getWebSocketInfo = async () => {
  const response = await api.get("/api/websocket/info");
  return response.data;
};

// Fan Profile Assignments
export const getFanAssignments = async (systemId: number) => {
  const response = await api.get(`/api/fan-profiles/assignments/${systemId}`);
  return response.data.data; // Extract the data array from the response
};

// License Management
export const getLicense = async () => {
  const response = await api.get("/api/license");
  return response.data;
};

export const setLicense = async (licenseKey: string) => {
  const response = await api.post("/api/license", { licenseKey });
  return response.data;
};

export const getPricing = async () => {
  const response = await api.get("/api/license/pricing");
  return response.data;
};

export const deleteLicense = async () => {
  const response = await api.delete("/api/license");
  return response.data;
};

// Backend Settings
export const getSettings = async () => {
  const response = await api.get("/api/systems/settings");
  return response.data;
};

export const getSetting = async (key: string) => {
  const response = await api.get(`/api/systems/settings/${key}`);
  return response.data;
};

export const updateSetting = async (key: string, value: string | number) => {
  const response = await api.put(`/api/systems/settings/${key}`, { value });
  return response.data;
};

// Sensor Visibility
export const updateSensorVisibility = async (
  systemId: number,
  sensorId: number,
  isHidden: boolean
): Promise<void> => {
  await api.put(`/api/systems/${systemId}/sensors/${sensorId}/visibility`, {
    is_hidden: isHidden,
  });
};

export const updateGroupVisibility = async (
  systemId: number,
  groupId: string,
  isHidden: boolean
): Promise<void> => {
  await api.put(`/api/systems/${systemId}/sensor-groups/${groupId}/visibility`, {
    is_hidden: isHidden,
  });
};

// Historical Data
export const getSensorHistory = async (
  systemId: number,
  hours: number = 24
): Promise<HistoryDataPoint[]> => {
  const endTime = new Date();
  const startTime = new Date();
  startTime.setHours(startTime.getHours() - hours);

  // Calculate limit based on hours (5 min interval = 12 points/hour * sensors * hours + buffer)
  // 5000 covers ~24h for 15 sensors/fans, or ~12h for 30 sensors.
  // For now, hardcode a higher safe limit.
  const response = await api.get(`/api/systems/${systemId}/history`, {
    params: {
      end_time: endTime.toISOString(),
      start_time: startTime.toISOString(),
      limit: 10000, // Increased from default 1000 to prevent truncation
    },
  });
  return response.data.data;
};

// Deployment - Token-based Linux installation
export interface DeploymentConfig {
  log_level: string;
  failsafe_speed: number;
  emergency_temp: number;
  update_interval: number;
  fan_step: number;
  hysteresis: number;
  path_mode: 'standard' | 'portable';
}

export interface DeploymentTemplate {
  token: string;
  expires_at: string;
}

export const createDeploymentTemplate = async (
  config: DeploymentConfig
): Promise<DeploymentTemplate> => {
  const response = await api.post("/api/deploy/templates", { config });
  return response.data;
};

// Agent Self-Update
export const selfUpdateAgent = async (systemId: number) => {
  const response = await api.post(`/api/systems/${systemId}/update`);
  return response.data;
};

// Local Hub Update Management
export interface HubStatus {
  version: string | null;
  timestamp: string | null;
  files: {
    x86_64: boolean;
    aarch64: boolean;
  };
}

export const getHubStatus = async (): Promise<HubStatus> => {
  const response = await api.get("/api/deploy/hub/status");
  return response.data;
};

export const stageUpdateToHub = async (version: string): Promise<{ message: string; version: string }> => {
  const response = await api.post("/api/deploy/hub/stage", { version });
  return response.data;
};


