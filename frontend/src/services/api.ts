import axios from 'axios';
import type { SystemData, SystemOverview, SystemHealth } from '../types/api';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// Health and Overview
export const getHealth = async () => {
  const response = await api.get('/health');
  return response.data;
};

export const getOverview = async (): Promise<SystemOverview> => {
  const response = await api.get('/api/overview');
  return response.data;
};

// Systems
export const getSystems = async (): Promise<SystemData[]> => {
  const response = await api.get('/api/systems');
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
export const updateSensorLabel = async (systemId: number, sensorId: number, label: string): Promise<void> => {
  const response = await api.put(`/api/systems/${systemId}/sensors/${sensorId}/label`, {
    label
  });
  return response.data;
};

export const updateFanLabel = async (systemId: number, fanId: number, label: string): Promise<void> => {
  const response = await api.put(`/api/systems/${systemId}/fans/${fanId}/label`, {
    label
  });
  return response.data;
};

// Fan Control
export const setFanSpeed = async (systemId: number, fanId: string, speed: number, priority: string = 'normal') => {
  const response = await api.put(`/api/systems/${systemId}/fans/${fanId}`, {
    speed,
    priority
  });
  return response.data;
};

export const applyFanProfile = async (systemId: number, profileName: string) => {
  const response = await api.put(`/api/systems/${systemId}/profile`, {
    profile_name: profileName
  });
  return response.data;
};

// Agent Configuration
export const setAgentUpdateInterval = async (systemId: number, interval: number, priority: string = 'normal') => {
  const response = await api.put(`/api/systems/${systemId}/update-interval`, {
    interval,
    priority
  });
  return response.data;
};

export const setSensorDeduplication = async (systemId: number, enabled: boolean, priority: string = 'normal') => {
  const response = await api.put(`/api/systems/${systemId}/sensor-deduplication`, {
    enabled,
    priority
  });
  return response.data;
};

export const setSensorTolerance = async (systemId: number, tolerance: number, priority: string = 'normal') => {
  const response = await api.put(`/api/systems/${systemId}/sensor-tolerance`, {
    tolerance,
    priority
  });
  return response.data;
};

export const setFanStep = async (systemId: number, step: number, priority: string = 'normal') => {
  const response = await api.put(`/api/systems/${systemId}/fan-step`, {
    step,
    priority
  });
  return response.data;
};

export const setHysteresis = async (systemId: number, hysteresis: number, priority: string = 'normal') => {
  const response = await api.put(`/api/systems/${systemId}/hysteresis`, {
    hysteresis,
    priority
  });
  return response.data;
};

export const setEmergencyTemp = async (systemId: number, temp: number, priority: string = 'normal') => {
  const response = await api.put(`/api/systems/${systemId}/emergency-temp`, {
    temp,
    priority
  });
  return response.data;
};

export const setLogLevel = async (systemId: number, level: string, priority: string = 'normal') => {
  const response = await api.put(`/api/systems/${systemId}/log-level`, {
    level,
    priority
  });
  return response.data;
};

// Emergency
export const emergencyStop = async () => {
  const response = await api.post('/api/emergency-stop');
  return response.data;
};

// Backend Controller
export const getControllerStatus = async () => {
  const response = await api.get('/api/systems/controller/status');
  return response.data;
};

export const setControllerInterval = async (interval: number) => {
  const response = await api.put('/api/systems/controller/interval', { interval });
  return response.data;
};

// WebSocket info
export const getWebSocketInfo = async () => {
  const response = await api.get('/api/websocket/info');
  return response.data;
};

// Fan Profile Assignments
export const getFanAssignments = async (systemId: number) => {
  const response = await api.get(`/api/fan-profiles/assignments/${systemId}`);
  return response.data.data; // Extract the data array from the response
};

// License Management
export const getLicense = async () => {
  const response = await api.get('/api/license');
  return response.data;
};

export const setLicense = async (licenseKey: string) => {
  const response = await api.post('/api/license', { licenseKey });
  return response.data;
};

export const getPricing = async () => {
  const response = await api.get('/api/license/pricing');
  return response.data;
};

export default api;