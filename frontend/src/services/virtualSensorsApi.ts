import { API_BASE_URL } from './api';
import type { VirtualSensor } from '../types/api';

export interface VirtualSensorUsage {
  fan: string;
  system: string;
}

export interface CreateVirtualSensorPayload {
  system_id: number;
  name: string;
  operation: 'max' | 'avg' | 'median';
  sensor_ids: number[];
}

export type UpdateVirtualSensorPayload = Partial<{
  name: string;
  operation: 'max' | 'avg' | 'median';
  sensor_ids: number[];
}>;

const BASE = `${API_BASE_URL}/api/virtual-sensors`;

interface ApiEnvelope {
  success?: boolean;
  error?: string;
  message?: string;
  data?: unknown;
}

async function parseOrThrow(response: Response, fallback: string): Promise<ApiEnvelope> {
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope;
  if (!response.ok) {
    throw new Error(body.error || body.message || fallback);
  }
  return body;
}

/** List a system's virtual sensors with their members. */
export const getVirtualSensors = async (systemId: number): Promise<VirtualSensor[]> => {
  const response = await fetch(`${BASE}/${systemId}`);
  const body = await parseOrThrow(response, 'Failed to fetch virtual sensors');
  return (body.data as VirtualSensor[]) || [];
};

/** Create a virtual sensor. Returns the new id. */
export const createVirtualSensor = async (payload: CreateVirtualSensorPayload): Promise<number> => {
  const response = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await parseOrThrow(response, 'Failed to create virtual sensor');
  return (body.data as { id: number } | undefined)?.id as number;
};

/** Update a virtual sensor (any subset of name / operation / sensor_ids). */
export const updateVirtualSensor = async (id: number, payload: UpdateVirtualSensorPayload): Promise<void> => {
  const response = await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await parseOrThrow(response, 'Failed to update virtual sensor');
};

/** Delete a virtual sensor. Returns the fans that were unassigned as a result. */
export const deleteVirtualSensor = async (id: number): Promise<VirtualSensorUsage[]> => {
  const response = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  const body = await parseOrThrow(response, 'Failed to delete virtual sensor');
  return (body.data as { unassigned_fans?: VirtualSensorUsage[] } | undefined)?.unassigned_fans || [];
};

/** Fans currently controlled by this virtual sensor (for the delete confirmation). */
export const getVirtualSensorUsage = async (id: number): Promise<VirtualSensorUsage[]> => {
  const response = await fetch(`${BASE}/${id}/usage`);
  const body = await parseOrThrow(response, 'Failed to fetch usage');
  return (body.data as VirtualSensorUsage[]) || [];
};

/** Reorder a system's virtual sensors. `orderedIds` is the new top-to-bottom order. */
export const updateVirtualSensorOrder = async (
  systemId: number,
  orderedIds: number[],
): Promise<void> => {
  const response = await fetch(`${BASE}/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemId, orderedIds }),
  });
  await parseOrThrow(response, 'Failed to reorder virtual sensors');
};
