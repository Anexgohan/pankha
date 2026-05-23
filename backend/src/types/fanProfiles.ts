// Fan Profile and Curve Management Types

export interface FanProfile {
  id: number;
  system_id?: number;           // null for global profiles
  profile_name: string;
  description?: string;
  profile_type: string;
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
  temperature: number;          // Temperature threshold (°C)
  fan_speed: number;           // Fan speed percentage (0-100)
  point_order: number;         // Order of points in curve
  created_at: string;
}

export interface FanProfileAssignment {
  id: number;
  fan_id: number;
  profile_id: number;
  sensor_id?: number;          // Which sensor to monitor
  is_active: boolean;
  assigned_at: string;
  fan_name?: string;           // Populated from join
  profile_name?: string;       // Populated from join
  sensor_name?: string;        // Populated from join
}

export interface CreateFanProfileRequest {
  profile_name: string;
  description?: string;
  profile_type?: string;
  is_global?: boolean;
  system_id?: number;
  // Optional override for the created_by column. Defaults to 'user' when omitted.
  // Used by the default-profile loader to mark seeded rows as 'system'.
  created_by?: string;
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
  sensor_id?: number;
}

export interface FanCurveCalculationResult {
  temperature: number;
  calculated_speed: number;
  profile_used: string;
  interpolated: boolean;
}

export interface SystemFanControlState {
  system_id: number;
  fans: Array<{
    fan_id: number;
    fan_name: string;
    current_speed: number;
    target_speed: number;
    profile_id?: number;
    profile_name?: string;
    monitoring_sensor_id?: number;
    monitoring_sensor_name?: string;
    current_temperature?: number;
    last_curve_calculation?: FanCurveCalculationResult;
  }>;
}

export interface FanProfileStats {
  total_profiles: number;
  system_profiles: number;
  user_profiles: number;
  active_assignments: number;
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
  profile_type: string;
  curve_points: Array<{
    temperature: number;
    fan_speed: number;
  }>;
}

export interface ImportFanProfilesRequest {
  profiles: ExportableFanProfile[];
  resolve_conflicts: 'skip' | 'rename' | 'overwrite';
  make_global?: boolean;
  // Optional created_by value applied to every imported profile. Defaults to 'user'.
  // Used by the default-profile loader to re-seed system rows correctly.
  created_by_override?: string;
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

// Fan Profile Type lookup (table fan_profile_types). Distinct from FanProfile.
export interface FanProfileType {
  name: string;
  is_system: boolean;
  color: string | null;       // 7-char hex (#RRGGBB) or null - badge renderer reads via --badge-color
  in_use_count: number;       // populated from a COUNT(*) against fan_profiles.profile_type
  created_at: string;
}

export interface CreateFanProfileTypeRequest {
  name: string;
  color?: string;             // 7-char hex; optional, defaults to a neutral grey on create
}