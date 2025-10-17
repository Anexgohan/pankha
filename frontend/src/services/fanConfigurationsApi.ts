import { API_BASE_URL } from './api';

export interface FanConfiguration {
  id: number;
  fan_id: number;
  sensor_id: number | string; // Can be numeric sensor dbId or special identifier like "__highest__"
  fan_name?: string;
  sensor_name?: string;
}

/**
 * Set the control sensor for a fan (independent of profile)
 */
export const setFanSensor = async (fanId: number, sensorId: number | string | null): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-configurations/sensor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fan_id: fanId,
      sensor_id: sensorId || null
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to set fan sensor');
  }

  return response.json();
};

/**
 * Get fan configurations for a system
 */
export const getFanConfigurations = async (systemId: number): Promise<FanConfiguration[]> => {
  try {
    const url = `${API_BASE_URL}/api/fan-configurations/${systemId}`;
    console.log('Fetching fan configurations from:', url);
    const response = await fetch(url);

    if (!response.ok) {
      console.error('Fan configurations fetch failed with status:', response.status);
      throw new Error('Failed to fetch fan configurations');
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error in getFanConfigurations:', error);
    throw error;
  }
};
