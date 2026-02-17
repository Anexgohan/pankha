import { API_BASE_URL } from './api';
import type { ActionResponse } from './api';

export interface FanProfile {
  id: number;
  system_id?: number;
  profile_name: string;
  description?: string;
  profile_type: 'silent' | 'balanced' | 'performance' | 'custom';
  is_global: boolean;
  is_active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
  curve_points?: FanCurvePoint[];
  assignments?: FanProfileAssignment[];
}

export interface FanCurvePoint {
  id: number;
  profile_id: number;
  temperature: number;
  fan_speed: number;
  point_order: number;
  created_at: string;
}

export interface FanProfileAssignment {
  id: number;
  fan_id: number;
  profile_id: number;
  sensor_id?: number | string; // Can be a sensor dbId (number) or special identifier like "__highest__" or "__group__<name>" (string)
  is_active: boolean;
  assigned_at: string;
  fan_name?: string;
  profile_name?: string;
  sensor_name?: string;
}

export interface CreateFanProfileRequest {
  profile_name: string;
  description?: string;
  profile_type?: 'silent' | 'balanced' | 'performance' | 'custom';
  is_global?: boolean;
  system_id?: number;
  curve_points: Array<{
    temperature: number;
    fan_speed: number;
  }>;
}

export interface UpdateFanProfileRequest {
  profile_name?: string;
  description?: string;
  is_active?: boolean;
  curve_points?: Array<{
    temperature: number;
    fan_speed: number;
  }>;
}

export interface FanProfileAssignmentRequest {
  fan_id: number;
  profile_id: number;
  sensor_id?: number | string; // Can be a sensor dbId (number) or special identifier like "__highest__" or "__group__<name>" (string)
}

export interface FanProfileStats {
  total_profiles: number;
  global_profiles: number;
  system_profiles: number;
  active_assignments: number;
  profiles_by_type: {
    silent: number;
    balanced: number;
    performance: number;
    custom: number;
  };
}

// Import/Export Types
export interface FanProfileExport {
  format: string;
  version: string;
  exported_at: string;
  exported_by: string;
  profiles: ExportableFanProfile[];
}

export interface ExportableFanProfile {
  profile_name: string;
  description?: string;
  profile_type: 'silent' | 'balanced' | 'performance' | 'custom';
  curve_points: Array<{
    temperature: number;
    fan_speed: number;
  }>;
}

export interface ImportFanProfilesRequest {
  profiles: ExportableFanProfile[];
  resolve_conflicts: 'skip' | 'rename' | 'overwrite';
  make_global?: boolean;
}

export interface ImportResult {
  success: boolean;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  profiles: Array<{
    name: string;
    status: 'imported' | 'skipped' | 'error';
    message?: string;
    new_id?: number;
  }>;
}

export interface ExportOptions {
  profile_ids?: number[];
  include_assignments?: boolean;
  include_system_profiles?: boolean;
}

// Default Profiles Types
export interface DefaultProfileInfo {
  profile_name: string;
  description?: string;
  profile_type: string;
  exists_in_db: boolean;
}

export interface LoadDefaultsRequest {
  profile_names?: string[];
  resolve_conflicts: 'skip' | 'rename' | 'overwrite';
}

/**
 * Get all fan profiles
 */
export const getFanProfiles = async (systemId?: number, includeGlobal: boolean = true): Promise<FanProfile[]> => {
  const params = new URLSearchParams();
  if (systemId) {
    params.append('system_id', systemId.toString());
  }
  if (!includeGlobal) {
    params.append('include_global', 'false');
  }
  
  const url = `${API_BASE_URL}/api/fan-profiles${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch fan profiles: ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.data;
};

/**
 * Get fan profile statistics
 */
export const getFanProfileStats = async (): Promise<FanProfileStats> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/stats`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch fan profile stats: ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.data;
};

/**
 * Get a specific fan profile by ID
 */
export const getFanProfile = async (profileId: number): Promise<FanProfile> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/${profileId}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch fan profile: ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.data;
};

/**
 * Create a new fan profile
 */
export const createFanProfile = async (request: CreateFanProfileRequest): Promise<FanProfile> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to create fan profile: ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.data;
};

/**
 * Update an existing fan profile
 */
export const updateFanProfile = async (profileId: number, request: UpdateFanProfileRequest): Promise<FanProfile> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/${profileId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to update fan profile: ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.data;
};

/**
 * Delete a fan profile
 */
export const deleteFanProfile = async (profileId: number): Promise<ActionResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/${profileId}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to delete fan profile: ${response.statusText}`);
  }

  return await response.json();
};

/**
 * Assign a profile to a fan
 */
export const assignProfileToFan = async (request: FanProfileAssignmentRequest): Promise<FanProfileAssignment> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to assign profile to fan: ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.data;
};

/**
 * Calculate fan speed for given temperature and fan
 */
export const calculateFanSpeed = async (fanId: number, temperature: number): Promise<any> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/calculate-speed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fan_id: fanId, temperature }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to calculate fan speed: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
};

/**
 * Export fan profiles to JSON format
 */
export const exportFanProfiles = async (options?: ExportOptions): Promise<FanProfileExport> => {
  const params = new URLSearchParams();

  if (options?.profile_ids && options.profile_ids.length > 0) {
    params.append('profile_ids', options.profile_ids.join(','));
  }

  if (options?.include_system_profiles !== undefined) {
    params.append('include_system_profiles', options.include_system_profiles.toString());
  }

  const url = `${API_BASE_URL}/api/fan-profiles/export${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to export fan profiles: ${response.statusText}`);
  }

  return await response.json();
};

/**
 * Import fan profiles from JSON format
 */
export const importFanProfiles = async (request: ImportFanProfilesRequest): Promise<ImportResult> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to import fan profiles: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
};

/**
 * Download exported fan profiles as a file
 */
export const downloadFanProfilesExport = async (options?: ExportOptions): Promise<void> => {
  try {
    const exportData = await exportFanProfiles(options);

    // Create blob and download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `fan-profiles-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();

    // Cleanup after a delay to ensure download starts
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (error) {
    throw new Error(`Failed to download fan profiles export: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Get available default fan profiles with their current status
 */
export const getDefaultProfiles = async (): Promise<DefaultProfileInfo[]> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/defaults`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to fetch default profiles: ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.data;
};

/**
 * Load default fan profiles (all or selected)
 */
export const loadDefaultProfiles = async (request: LoadDefaultsRequest): Promise<ImportResult> => {
  const response = await fetch(`${API_BASE_URL}/api/fan-profiles/load-defaults`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to load default profiles: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
};
