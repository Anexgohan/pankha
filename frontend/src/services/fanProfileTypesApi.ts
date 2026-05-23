import { API_BASE_URL } from './api';

/**
 * Client for /api/fan-profile-types.
 *
 * System types (silent / balanced / optimal / performance / custom) are seeded
 * from schema.sql with is_system=true and cannot be deleted. User-added types
 * have is_system=false and can be removed when no profile still references
 * them.
 */
export interface FanProfileType {
  name: string;
  is_system: boolean;
  color: string | null;
  in_use_count: number;
  created_at: string;
}

/**
 * Discriminated error shape returned by the manager when a delete is blocked.
 * The route translates each `reason` to a status code (403 / 404 / 409) but the
 * client only needs the reason string to render the right toast.
 */
export type DeleteTypeError =
  | { ok: false; status: number; reason: 'not_found' | 'is_system' | 'in_use'; in_use_count?: number; message: string };

export async function getFanProfileTypes(): Promise<FanProfileType[]> {
  const res = await fetch(`${API_BASE_URL}/api/fan-profile-types`);
  if (!res.ok) {
    throw new Error(`Failed to load profile types: HTTP ${res.status}`);
  }
  const body = await res.json();
  return (body.data || []) as FanProfileType[];
}

/**
 * Create a user-defined profile type. Returns the created row on success.
 * Throws on validation failure (400) or duplicate name (409).
 *
 * `color` is optional - the server defaults to neutral grey if omitted.
 */
export async function createFanProfileType(name: string, color?: string): Promise<FanProfileType> {
  const res = await fetch(`${API_BASE_URL}/api/fan-profile-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...(color ? { color } : {}) })
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `Failed to create profile type (HTTP ${res.status})`);
  }
  return body.data as FanProfileType;
}

/**
 * Recolor an existing profile type (system or user). Recoloring is cosmetic
 * only, so this works for system types too - the is_system lock only blocks
 * deletion. Returns the updated row on success.
 */
export async function updateFanProfileTypeColor(name: string, color: string): Promise<FanProfileType> {
  const res = await fetch(`${API_BASE_URL}/api/fan-profile-types/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color })
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `Failed to update profile type color (HTTP ${res.status})`);
  }
  return body.data as FanProfileType;
}

/**
 * Delete a user-defined profile type.
 *
 * Returns `{ ok: true }` on success. On block, returns a structured error so
 * the caller can render the appropriate toast (system-type vs in-use vs other).
 */
export async function deleteFanProfileType(name: string): Promise<{ ok: true } | DeleteTypeError> {
  const res = await fetch(`${API_BASE_URL}/api/fan-profile-types/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  });
  if (res.ok) {
    return { ok: true };
  }
  const body = await res.json().catch(() => ({}));
  let reason: 'not_found' | 'is_system' | 'in_use' = 'not_found';
  if (res.status === 403) reason = 'is_system';
  else if (res.status === 409) reason = 'in_use';
  return {
    ok: false,
    status: res.status,
    reason,
    in_use_count: body.in_use_count,
    message: body.error || `Delete failed (HTTP ${res.status})`
  };
}
