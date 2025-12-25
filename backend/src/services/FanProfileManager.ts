import { EventEmitter } from 'events';
import Database from '../database/database';
import { log } from '../utils/logger';
import {
  FanProfile,
  FanCurvePoint,
  FanProfileAssignment,
  CreateFanProfileRequest,
  UpdateFanProfileRequest,
  FanProfileAssignmentRequest,
  FanCurveCalculationResult,
  SystemFanControlState,
  FanProfileStats,
  FanProfileExport,
  ExportableFanProfile,
  ImportFanProfilesRequest,
  ImportResult,
  ExportOptions
} from '../types/fanProfiles';

export class FanProfileManager extends EventEmitter {
  private static instance: FanProfileManager;
  private db: Database;
  private activeProfileCalculations: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    super();
    this.db = Database.getInstance();
  }

  public static getInstance(): FanProfileManager {
    if (!FanProfileManager.instance) {
      FanProfileManager.instance = new FanProfileManager();
    }
    return FanProfileManager.instance;
  }

  /**
   * Get all fan profiles, optionally filtered by system
   */
  public async getFanProfiles(systemId?: number, includeGlobal: boolean = true): Promise<FanProfile[]> {
    try {
      let sql = `
        SELECT fp.*,
               COUNT(fcp.id) as curve_point_count,
               COUNT(fpa.id) as assignment_count
        FROM fan_profiles fp
        LEFT JOIN fan_curve_points fcp ON fp.id = fcp.profile_id
        LEFT JOIN fan_profile_assignments fpa ON fp.id = fpa.profile_id AND fpa.is_active = TRUE
      `;

      const params: any[] = [];

      if (systemId && includeGlobal) {
        sql += ` WHERE (fp.system_id = $1 OR fp.is_global = TRUE)`;
        params.push(systemId);
      } else if (systemId) {
        sql += ` WHERE fp.system_id = $1`;
        params.push(systemId);
      } else if (includeGlobal) {
        sql += ` WHERE fp.is_global = TRUE`;
      }
      
      sql += ` GROUP BY fp.id ORDER BY fp.profile_type, fp.profile_name`;
      
      const profiles = await this.db.all(sql, params);
      
      // Get curve points for each profile
      for (const profile of profiles) {
        profile.curve_points = await this.getFanCurvePoints(profile.id);
        profile.assignments = await this.getFanProfileAssignments(profile.id);
      }
      
      return profiles as FanProfile[];

    } catch (error) {
      log.error('Error fetching fan profiles', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Get a specific fan profile by ID
   */
  public async getFanProfile(profileId: number): Promise<FanProfile | null> {
    try {
      const profile = await this.db.get(
        'SELECT * FROM fan_profiles WHERE id = $1',
        [profileId]
      );
      
      if (!profile) return null;
      
      profile.curve_points = await this.getFanCurvePoints(profileId);
      profile.assignments = await this.getFanProfileAssignments(profileId);
      
      return profile as FanProfile;

    } catch (error) {
      log.error('Error fetching fan profile', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Create a new fan profile
   */
  public async createFanProfile(request: CreateFanProfileRequest): Promise<FanProfile> {
    try {
      // Validate curve points
      this.validateCurvePoints(request.curve_points);
      
      // Insert profile
      const result = await this.db.run(
        `INSERT INTO fan_profiles (
          system_id, profile_name, description, profile_type, is_global, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id`,
        [
          request.system_id || null,
          request.profile_name,
          request.description || null,
          request.profile_type || 'custom',
          request.is_global || false,
          'user'
        ]
      );

      const profileId = result.rows[0].id;

      // Insert curve points
      for (let i = 0; i < request.curve_points.length; i++) {
        const point = request.curve_points[i];
        await this.db.run(
          'INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES ($1, $2, $3, $4)',
          [profileId, point.temperature, point.fan_speed, i + 1]
        );
      }

      log.success(`Fan profile created: ${request.profile_name} (ID: ${profileId})`, 'FanProfileManager');
      this.emit('profileCreated', { profileId, profileName: request.profile_name });
      
      const createdProfile = await this.getFanProfile(profileId!);
      return createdProfile!;

    } catch (error) {
      log.error('Error creating fan profile', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Update an existing fan profile
   */
  public async updateFanProfile(profileId: number, request: UpdateFanProfileRequest): Promise<FanProfile> {
    try {
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (request.profile_name !== undefined) {
        updateFields.push(`profile_name = $${paramIndex++}`);
        updateValues.push(request.profile_name);
      }

      if (request.description !== undefined) {
        updateFields.push(`description = $${paramIndex++}`);
        updateValues.push(request.description);
      }

      if (request.is_active !== undefined) {
        updateFields.push(`is_active = $${paramIndex++}`);
        updateValues.push(request.is_active);
      }

      if (updateFields.length > 0) {
        updateValues.push(profileId);
        await this.db.run(
          `UPDATE fan_profiles SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
          updateValues
        );
      }
      
      // Update curve points if provided
      if (request.curve_points) {
        this.validateCurvePoints(request.curve_points);

        // Delete existing curve points
        await this.db.run('DELETE FROM fan_curve_points WHERE profile_id = $1', [profileId]);

        // Insert new curve points
        for (let i = 0; i < request.curve_points.length; i++) {
          const point = request.curve_points[i];
          await this.db.run(
            'INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES ($1, $2, $3, $4)',
            [profileId, point.temperature, point.fan_speed, i + 1]
          );
        }
      }

      log.success(`Fan profile updated: ID ${profileId}`, 'FanProfileManager');
      this.emit('profileUpdated', { profileId });
      
      const updatedProfile = await this.getFanProfile(profileId);
      return updatedProfile!;

    } catch (error) {
      log.error('Error updating fan profile', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Delete a fan profile
   */
  public async deleteFanProfile(profileId: number): Promise<void> {
    try {
      // Check if profile exists
      const profile = await this.db.get(
        'SELECT * FROM fan_profiles WHERE id = $1',
        [profileId]
      );

      if (!profile) {
        throw new Error('Profile not found');
      }

      // Delete profile (cascade will handle curve points and assignments)
      await this.db.run('DELETE FROM fan_profiles WHERE id = $1', [profileId]);

      log.success(`Fan profile deleted: ID ${profileId}`, 'FanProfileManager');
      this.emit('profileDeleted', { profileId });

    } catch (error) {
      log.error('Error deleting fan profile', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Assign a profile to a fan
   */
  public async assignProfileToFan(request: FanProfileAssignmentRequest): Promise<FanProfileAssignment> {
    try {
      // Remove any existing assignment for this fan
      await this.db.run(
        'DELETE FROM fan_profile_assignments WHERE fan_id = $1',
        [request.fan_id]
      );

      // Determine if sensor_id is a special identifier or regular sensor ID
      let sensorDbId: number | null = null;
      let sensorIdentifier: string | null = null;

      if (request.sensor_id !== undefined && request.sensor_id !== null) {
        if (typeof request.sensor_id === 'string') {
          // It's a special identifier like "__highest__" or "__group__<name>"
          sensorIdentifier = request.sensor_id;
        } else {
          // It's a regular sensor database ID
          sensorDbId = request.sensor_id;
        }
      }

      // Create new assignment
      const result = await this.db.run(
        `INSERT INTO fan_profile_assignments (fan_id, profile_id, sensor_id, sensor_identifier, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [request.fan_id, request.profile_id, sensorDbId, sensorIdentifier, true]
      );

      log.success(`Profile assigned: Fan ${request.fan_id} -> Profile ${request.profile_id}${sensorIdentifier ? ` (Identifier: ${sensorIdentifier})` : sensorDbId ? ` (Sensor: ${sensorDbId})` : ''}`, 'FanProfileManager');
      this.emit('profileAssigned', { fanId: request.fan_id, profileId: request.profile_id });

      const assignment = await this.getFanProfileAssignment(result.rows[0].id);
      return assignment!;

    } catch (error) {
      log.error('Error assigning profile to fan', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Calculate fan speed based on temperature and assigned profile
   */
  public async calculateFanSpeed(fanId: number, currentTemperature: number): Promise<FanCurveCalculationResult | null> {
    try {
      // Get fan's assigned profile
      const assignment = await this.db.get(`
        SELECT fpa.*, fp.profile_name, fp.profile_type
        FROM fan_profile_assignments fpa
        JOIN fan_profiles fp ON fpa.profile_id = fp.id
        WHERE fpa.fan_id = $1 AND fpa.is_active = TRUE
      `, [fanId]);
      
      if (!assignment) {
        return null; // No profile assigned
      }
      
      // Get curve points for the profile
      const curvePoints = await this.getFanCurvePoints(assignment.profile_id);
      
      if (curvePoints.length === 0) {
        return null; // No curve defined
      }
      
      // Sort points by temperature
      curvePoints.sort((a, b) => a.temperature - b.temperature);
      
      let calculatedSpeed: number = curvePoints[Math.floor(curvePoints.length / 2)].fan_speed; // Default fallback
      let interpolated = false;
      
      // Find appropriate speed based on temperature
      if (currentTemperature <= curvePoints[0].temperature) {
        // Below first point - use minimum speed
        calculatedSpeed = curvePoints[0].fan_speed;
      } else if (currentTemperature >= curvePoints[curvePoints.length - 1].temperature) {
        // Above last point - use maximum speed
        calculatedSpeed = curvePoints[curvePoints.length - 1].fan_speed;
      } else {
        // Interpolate between points
        for (let i = 0; i < curvePoints.length - 1; i++) {
          const lower = curvePoints[i];
          const upper = curvePoints[i + 1];
          
          if (currentTemperature >= lower.temperature && currentTemperature <= upper.temperature) {
            // Linear interpolation
            const tempRatio = (currentTemperature - lower.temperature) / (upper.temperature - lower.temperature);
            calculatedSpeed = Math.round(lower.fan_speed + (upper.fan_speed - lower.fan_speed) * tempRatio);
            interpolated = true;
            break;
          }
        }
      }
      
      return {
        temperature: currentTemperature,
        calculated_speed: Math.max(0, Math.min(100, calculatedSpeed)),
        profile_used: assignment.profile_name,
        interpolated
      };

    } catch (error) {
      log.error('Error calculating fan speed', 'FanProfileManager', error);
      return null;
    }
  }

  /**
   * Get fan curve points for a profile
   */
  private async getFanCurvePoints(profileId: number): Promise<FanCurvePoint[]> {
    return await this.db.all(
      'SELECT * FROM fan_curve_points WHERE profile_id = $1 ORDER BY point_order',
      [profileId]
    ) as FanCurvePoint[];
  }

  /**
   * Get profile assignments for a profile
   */
  private async getFanProfileAssignments(profileId: number): Promise<FanProfileAssignment[]> {
    return await this.db.all(`
      SELECT fpa.*, f.fan_name, s.sensor_name
      FROM fan_profile_assignments fpa
      LEFT JOIN fans f ON fpa.fan_id = f.id
      LEFT JOIN sensors s ON fpa.sensor_id = s.id
      WHERE fpa.profile_id = $1 AND fpa.is_active = TRUE
    `, [profileId]) as FanProfileAssignment[];
  }

  /**
   * Get a specific profile assignment
   */
  private async getFanProfileAssignment(assignmentId: number): Promise<FanProfileAssignment | null> {
    return await this.db.get(`
      SELECT fpa.*, f.fan_name, fp.profile_name, s.sensor_name
      FROM fan_profile_assignments fpa
      LEFT JOIN fans f ON fpa.fan_id = f.id
      LEFT JOIN fan_profiles fp ON fpa.profile_id = fp.id
      LEFT JOIN sensors s ON fpa.sensor_id = s.id
      WHERE fpa.id = $1
    `, [assignmentId]) as FanProfileAssignment | null;
  }

  /**
   * Validate curve points
   */
  private validateCurvePoints(points: Array<{ temperature: number; fan_speed: number }>): void {
    if (points.length < 2) {
      throw new Error('Fan curve must have at least 2 points');
    }
    
    // Sort by temperature for validation
    const sortedPoints = [...points].sort((a, b) => a.temperature - b.temperature);
    
    // Check for duplicate temperatures
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      if (sortedPoints[i].temperature === sortedPoints[i + 1].temperature) {
        throw new Error('Fan curve cannot have duplicate temperature points');
      }
    }
    
    // Validate ranges
    for (const point of points) {
      if (point.temperature < 0 || point.temperature > 150) {
        throw new Error('Temperature must be between 0°C and 150°C');
      }
      if (point.fan_speed < 0 || point.fan_speed > 100) {
        throw new Error('Fan speed must be between 0% and 100%');
      }
    }
  }

  /**
   * Get fan profile statistics
   */
  public async getFanProfileStats(): Promise<FanProfileStats> {
    try {
      const totalProfiles = await this.db.get(
        'SELECT COUNT(*) as count FROM fan_profiles'
      );
      
      const globalProfiles = await this.db.get(
        'SELECT COUNT(*) as count FROM fan_profiles WHERE is_global = TRUE'
      );

      const systemProfiles = await this.db.get(
        'SELECT COUNT(*) as count FROM fan_profiles WHERE is_global = FALSE'
      );

      const activeAssignments = await this.db.get(
        'SELECT COUNT(*) as count FROM fan_profile_assignments WHERE is_active = TRUE'
      );
      
      const profilesByType = await this.db.all(
        'SELECT profile_type, COUNT(*) as count FROM fan_profiles GROUP BY profile_type'
      );
      
      const typeStats = {
        silent: 0,
        balanced: 0,
        performance: 0,
        custom: 0
      };
      
      for (const row of profilesByType) {
        if (row.profile_type in typeStats) {
          typeStats[row.profile_type as keyof typeof typeStats] = row.count;
        }
      }
      
      return {
        total_profiles: totalProfiles.count,
        global_profiles: globalProfiles.count,
        system_profiles: systemProfiles.count,
        active_assignments: activeAssignments.count,
        profiles_by_type: typeStats
      };

    } catch (error) {
      log.error('Error getting fan profile stats', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Get active fan profile assignments for a system
   */
  public async getSystemAssignments(systemId: number): Promise<any[]> {
    try {
      const assignments = await this.db.all(`
        SELECT
          fpa.id as assignment_id,
          fpa.fan_id,
          fpa.profile_id,
          fpa.sensor_id,
          fpa.sensor_identifier,
          fpa.is_active,
          f.fan_name,
          fp.profile_name,
          s.sensor_name
        FROM fan_profile_assignments fpa
        JOIN fans f ON fpa.fan_id = f.id
        JOIN fan_profiles fp ON fpa.profile_id = fp.id
        LEFT JOIN sensors s ON fpa.sensor_id = s.id
        WHERE f.system_id = $1 AND fpa.is_active = true
      `, [systemId]);

      // Process assignments to return the appropriate sensor_id
      // If sensor_identifier exists (and is not empty), return it as sensor_id (special identifier)
      // Otherwise, return the numeric sensor_id
      return assignments.map(assignment => ({
        ...assignment,
        sensor_id: (assignment.sensor_identifier && assignment.sensor_identifier.trim() !== '')
          ? assignment.sensor_identifier
          : assignment.sensor_id
      }));
    } catch (error) {
      log.error('Error getting system assignments', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Get default profiles from JSON file with their current status (exists in DB or not)
   */
  public async getDefaultProfiles(): Promise<Array<{
    profile_name: string;
    description?: string;
    profile_type: string;
    exists_in_db: boolean;
  }>> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Path to defaults file (in backend/src/config, copied to backend/config in Docker)
      const defaultsPath = path.resolve(__dirname, '../config/fan-profiles-defaults.json');
      
      if (!fs.existsSync(defaultsPath)) {
        log.warn(`Default profiles file not found at ${defaultsPath}`, 'FanProfileManager');
        return [];
      }

      const defaultsContent = fs.readFileSync(defaultsPath, 'utf8');
      const defaultsData = JSON.parse(defaultsContent);

      if (!defaultsData.profiles || !Array.isArray(defaultsData.profiles)) {
        return [];
      }

      // Get existing profile names from DB
      const existingProfiles = await this.db.all('SELECT profile_name FROM fan_profiles');
      const existingNames = new Set(existingProfiles.map((p: any) => p.profile_name));

      // Map defaults with exists status
      return defaultsData.profiles.map((profile: any) => ({
        profile_name: profile.profile_name,
        description: profile.description,
        profile_type: profile.profile_type || 'custom',
        exists_in_db: existingNames.has(profile.profile_name)
      }));

    } catch (error) {
      log.error('Error getting default profiles', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Load default profiles (all or selected)
   */
  public async loadDefaultProfiles(options: {
    profile_names?: string[];
    resolve_conflicts: 'skip' | 'rename' | 'overwrite';
  }): Promise<ImportResult> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Path to defaults file (in backend/src/config, copied to backend/config in Docker)
      const defaultsPath = path.resolve(__dirname, '../config/fan-profiles-defaults.json');
      
      if (!fs.existsSync(defaultsPath)) {
        throw new Error(`Default profiles file not found at ${defaultsPath}`);
      }

      const defaultsContent = fs.readFileSync(defaultsPath, 'utf8');
      const defaultsData = JSON.parse(defaultsContent);

      if (!defaultsData.profiles || !Array.isArray(defaultsData.profiles)) {
        throw new Error('Invalid default profiles format');
      }

      // Filter profiles if specific names requested
      let profilesToLoad = defaultsData.profiles;
      if (options.profile_names && options.profile_names.length > 0) {
        const requestedNames = new Set(options.profile_names);
        profilesToLoad = defaultsData.profiles.filter(
          (p: any) => requestedNames.has(p.profile_name)
        );
      }

      // Normalize curve points (handle string temperatures)
      const normalizedProfiles = profilesToLoad.map((profile: any) => ({
        ...profile,
        curve_points: profile.curve_points?.map((point: any) => ({
          temperature: typeof point.temperature === 'string' 
            ? parseFloat(point.temperature) 
            : point.temperature,
          fan_speed: point.fan_speed
        })) || []
      }));

      log.info(`📥 Loading ${normalizedProfiles.length} default fan profiles`, 'FanProfileManager');

      // Use existing import logic
      const result = await this.importFanProfiles({
        profiles: normalizedProfiles,
        resolve_conflicts: options.resolve_conflicts,
        make_global: true
      });

      return result;

    } catch (error) {
      log.error('Error loading default profiles', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Export fan profiles to JSON format
   */
  public async exportFanProfiles(options: ExportOptions = {}): Promise<FanProfileExport> {
    try {
      let profiles: FanProfile[];

      if (options.profile_ids && options.profile_ids.length > 0) {
        // Export specific profiles
        profiles = [];
        for (const profileId of options.profile_ids) {
          const profile = await this.getFanProfile(profileId);
          if (profile) {
            profiles.push(profile);
          }
        }
      } else {
        // Export all profiles based on options
        const includeGlobal = options.include_system_profiles !== false; // default true
        profiles = await this.getFanProfiles(undefined, includeGlobal);
      }

      // Convert to exportable format
      const exportableProfiles: ExportableFanProfile[] = profiles.map(profile => ({
        profile_name: profile.profile_name,
        description: profile.description,
        profile_type: profile.profile_type,
        curve_points: profile.curve_points?.map(point => ({
          temperature: point.temperature,
          fan_speed: point.fan_speed
        })) || []
      }));

      const exportData: FanProfileExport = {
        format: 'pankha-fan-profiles',
        version: '1.0',
        exported_at: new Date().toISOString(),
        exported_by: 'pankha-system',
        profiles: exportableProfiles
      };

      log.info(`📤 Exported ${exportableProfiles.length} fan profiles`, 'FanProfileManager');
      this.emit('profilesExported', { count: exportableProfiles.length });

      return exportData;

    } catch (error) {
      log.error('Error exporting fan profiles', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Import fan profiles from JSON format
   */
  public async importFanProfiles(request: ImportFanProfilesRequest): Promise<ImportResult> {
    try {
      const result: ImportResult = {
        success: true,
        imported_count: 0,
        skipped_count: 0,
        error_count: 0,
        profiles: []
      };

      log.info(`📥 Starting import of ${request.profiles.length} fan profiles`, 'FanProfileManager');

      for (const profileData of request.profiles) {
        try {
          // Check for existing profile with same name
          const existingProfile = await this.db.get(
            'SELECT id FROM fan_profiles WHERE profile_name = $1',
            [profileData.profile_name]
          );

          if (existingProfile) {
            if (request.resolve_conflicts === 'skip') {
              result.profiles.push({
                name: profileData.profile_name,
                status: 'skipped',
                message: 'Profile with same name already exists'
              });
              result.skipped_count++;
              continue;
            } else if (request.resolve_conflicts === 'rename') {
              // Generate unique name
              let uniqueName = profileData.profile_name;
              let counter = 1;
              while (await this.db.get('SELECT id FROM fan_profiles WHERE profile_name = $1', [uniqueName])) {
                uniqueName = `${profileData.profile_name} (${counter})`;
                counter++;
              }
              profileData.profile_name = uniqueName;
            } else if (request.resolve_conflicts === 'overwrite') {
              // Delete existing profile
              await this.deleteFanProfile(existingProfile.id);
            }
          }

          // Validate curve points
          if (!profileData.curve_points || profileData.curve_points.length < 2) {
            result.profiles.push({
              name: profileData.profile_name,
              status: 'error',
              message: 'Profile must have at least 2 curve points'
            });
            result.error_count++;
            continue;
          }

          // Create new profile
          const createRequest: CreateFanProfileRequest = {
            profile_name: profileData.profile_name,
            description: profileData.description,
            profile_type: profileData.profile_type || 'custom',
            is_global: request.make_global || false,
            system_id: request.make_global ? undefined : undefined,
            curve_points: profileData.curve_points
          };

          const createdProfile = await this.createFanProfile(createRequest);

          result.profiles.push({
            name: profileData.profile_name,
            status: 'imported',
            new_id: createdProfile.id
          });
          result.imported_count++;

        } catch (error) {
          log.error(`Error importing profile "${profileData.profile_name}"`, 'FanProfileManager', error);
          result.profiles.push({
            name: profileData.profile_name,
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error'
          });
          result.error_count++;
        }
      }

      result.success = result.error_count === 0;

      log.info(`📥 Import completed: ${result.imported_count} imported, ${result.skipped_count} skipped, ${result.error_count} errors`, 'FanProfileManager');
      this.emit('profilesImported', result);

      return result;

    } catch (error) {
      log.error('Error importing fan profiles', 'FanProfileManager', error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    // Clear any active calculation timers
    for (const timer of this.activeProfileCalculations.values()) {
      clearTimeout(timer);
    }
    this.activeProfileCalculations.clear();

    this.removeAllListeners();
    log.info('🧹 FanProfileManager cleaned up', 'FanProfileManager');
  }
}