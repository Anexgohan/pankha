import { API_BASE_URL } from './api';

// Auth REST client. Same-origin (Vite proxies /api in dev), so the session
// cookie rides along automatically on every call.

export type Role = 'viewer' | 'operator' | 'admin';

export interface AuthMe {
  authenticated: boolean;
  username?: string;
  role?: Role;
  setup_required?: boolean;
  registration_enabled?: boolean;
  auth_reset_active?: boolean;
}

export interface UserRow {
  id: number;
  username: string;
  role: Role;
  created_at?: string;
  updated_at?: string;
}

export interface RegistrationSettings {
  enabled: boolean;
  default_role: Role;
}

export interface PendingAgent {
  agentId: string;
  name: string;
  ip?: string;
  agentType?: string;
  platform?: string;
  version?: string;
  reason: string;
  requestedAt: string;
  // Hub-computed: approving an old Linux/IPMI build also updates it
  belowTokenVersion?: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body as T;
}

export const getMe = () => request<AuthMe>('/api/auth/me');

export const login = (username: string, password: string) =>
  request<{ username: string; role: Role }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const logout = () => request<{ message: string }>('/api/auth/logout', { method: 'POST' });

export const setupAdmin = (username: string, password: string) =>
  request<{ username: string; role: Role }>('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const registerAccount = (username: string, password: string) =>
  request<{ username: string; role: Role }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{ message: string }>('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });

export const listUsers = () => request<UserRow[]>('/api/auth/users');

export const createUser = (username: string, password: string, role: Role) =>
  request<UserRow>('/api/auth/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });

export const updateUser = (id: number, changes: { role?: Role; password?: string }) =>
  request<{ message: string }>(`/api/auth/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  });

export const deleteUser = (id: number) =>
  request<{ message: string }>(`/api/auth/users/${id}`, { method: 'DELETE' });

export const getRegistrationSettings = () =>
  request<RegistrationSettings>('/api/auth/registration');

export const updateRegistrationSettings = (changes: Partial<RegistrationSettings>) =>
  request<RegistrationSettings>('/api/auth/registration', {
    method: 'PUT',
    body: JSON.stringify(changes),
  });

export const getPendingAgents = () => request<PendingAgent[]>('/api/systems/pending');

export const approvePendingAgent = (agentId: string) =>
  request<{ message: string }>(`/api/systems/pending/${encodeURIComponent(agentId)}/approve`, {
    method: 'POST',
  });

export const dismissPendingAgent = (agentId: string) =>
  request<{ message: string }>(`/api/systems/pending/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  });
