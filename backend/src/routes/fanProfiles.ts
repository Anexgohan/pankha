import { Router, Request, Response } from 'express';
import { FanProfileManager } from '../services/FanProfileManager';
import { FanProfileController } from '../services/FanProfileController';
import Database from '../database/database';
import {
  CreateFanProfileRequest,
  UpdateFanProfileRequest,
  FanProfileAssignmentRequest,
  ImportFanProfilesRequest,
  ExportOptions
} from '../types/fanProfiles';
import { log } from '../utils/logger';

const router = Router();
const fanProfileManager = FanProfileManager.getInstance();

/**
 * GET /api/fan-profiles
 * Get all fan profiles, optionally filtered by system
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const systemId = req.query.system_id ? parseInt(req.query.system_id as string) : undefined;
    const includeGlobal = req.query.include_global !== 'false';
    
    const profiles = await fanProfileManager.getFanProfiles(systemId, includeGlobal);
    
    res.json({
      success: true,
      data: profiles,
      count: profiles.length
    });
    
  } catch (error) {
    log.error('Error fetching fan profiles:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fan profiles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fan-profiles/stats
 * Get fan profile statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await fanProfileManager.getFanProfileStats();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    log.error('Error fetching fan profile stats:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fan profile statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fan-profiles/export
 * Export fan profiles to JSON format
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const options: ExportOptions = {};

    // Parse query parameters
    if (req.query.profile_ids) {
      const profileIds = (req.query.profile_ids as string).split(',').map(id => parseInt(id.trim()));
      if (profileIds.some(isNaN)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid profile IDs in query parameter'
        });
      }
      options.profile_ids = profileIds;
    }

    if (req.query.include_system_profiles !== undefined) {
      options.include_system_profiles = req.query.include_system_profiles === 'true';
    }

    const exportData = await fanProfileManager.exportFanProfiles(options);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="fan-profiles-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(exportData);

  } catch (error) {
    log.error('Error exporting fan profiles:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export fan profiles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/fan-profiles/import
 * Import fan profiles from JSON format
 */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const importRequest: ImportFanProfilesRequest = req.body;

    // Validate request structure
    if (!importRequest.profiles || !Array.isArray(importRequest.profiles)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: profiles array is required'
      });
    }

    if (!importRequest.resolve_conflicts || !['skip', 'rename', 'overwrite'].includes(importRequest.resolve_conflicts)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid resolve_conflicts value. Must be: skip, rename, or overwrite'
      });
    }

    const result = await fanProfileManager.importFanProfiles(importRequest);

    res.json({
      success: result.success,
      data: result,
      message: `Import completed: ${result.imported_count} imported, ${result.skipped_count} skipped, ${result.error_count} errors`
    });

  } catch (error) {
    log.error('Error importing fan profiles:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import fan profiles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fan-profiles/defaults
 * Get available default fan profiles with their current status (exists in DB or not)
 */
router.get('/defaults', async (req: Request, res: Response) => {
  try {
    const defaults = await fanProfileManager.getDefaultProfiles();
    
    res.json({
      success: true,
      data: defaults,
      count: defaults.length
    });

  } catch (error) {
    log.error('Error fetching default profiles:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch default profiles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/fan-profiles/load-defaults
 * Load default fan profiles (all or selected)
 */
router.post('/load-defaults', async (req: Request, res: Response) => {
  try {
    const { profile_names, resolve_conflicts = 'skip' } = req.body;

    if (!['skip', 'rename', 'overwrite'].includes(resolve_conflicts)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid resolve_conflicts value. Must be: skip, rename, or overwrite'
      });
    }

    const result = await fanProfileManager.loadDefaultProfiles({
      profile_names,
      resolve_conflicts
    });

    res.json({
      success: result.success,
      data: result,
      message: `Default profiles loaded: ${result.imported_count} imported, ${result.skipped_count} skipped, ${result.error_count} errors`
    });

  } catch (error) {
    log.error('Error loading default profiles:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load default profiles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fan-profiles/:id
 * Get a specific fan profile by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const profileId = parseInt(req.params.id);
    
    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid profile ID'
      });
    }
    
    const profile = await fanProfileManager.getFanProfile(profileId);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Fan profile not found'
      });
    }
    
    res.json({
      success: true,
      data: profile
    });
    
  } catch (error) {
    log.error('Error fetching fan profile:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fan profile',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/fan-profiles
 * Create a new fan profile
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const request: CreateFanProfileRequest = req.body;
    
    // Validate required fields
    if (!request.profile_name || !request.curve_points || request.curve_points.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: profile_name and curve_points'
      });
    }
    
    const profile = await fanProfileManager.createFanProfile(request);
    
    res.status(201).json({
      success: true,
      data: profile,
      message: 'Fan profile created successfully'
    });
    
  } catch (error) {
    log.error('Error creating fan profile:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create fan profile',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/fan-profiles/:id
 * Update an existing fan profile
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const profileId = parseInt(req.params.id);
    const request: UpdateFanProfileRequest = req.body;
    
    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid profile ID'
      });
    }
    
    const profile = await fanProfileManager.updateFanProfile(profileId, request);
    
    res.json({
      success: true,
      data: profile,
      message: 'Fan profile updated successfully'
    });
    
  } catch (error) {
    log.error('Error updating fan profile:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update fan profile',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/fan-profiles/:id
 * Delete a fan profile
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const profileId = parseInt(req.params.id);
    
    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid profile ID'
      });
    }
    
    await fanProfileManager.deleteFanProfile(profileId);
    
    res.json({
      success: true,
      message: 'Fan profile deleted successfully'
    });
    
  } catch (error) {
    log.error('Error deleting fan profile:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete fan profile',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/fan-profiles/assign
 * Assign a profile to a fan
 */
router.post('/assign', async (req: Request, res: Response) => {
  try {
    const request: FanProfileAssignmentRequest = req.body;
    
    // Validate required fields
    if (!request.fan_id || !request.profile_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: fan_id and profile_id'
      });
    }
    
    const assignment = await fanProfileManager.assignProfileToFan(request);
    
    // Clear cached hysteresis/stepping state for this fan so the new profile takes effect immediately
    // Look up the fan details to get agent_id and fan_name
    const db = Database.getInstance();
    const fanDetails = await db.get(`
      SELECT f.fan_name, s.agent_id
      FROM fans f
      JOIN systems s ON f.system_id = s.id
      WHERE f.id = $1
    `, [request.fan_id]);
    
    if (fanDetails) {
      const fanProfileController = FanProfileController.getInstance();
      fanProfileController.clearFanState(fanDetails.agent_id, fanDetails.fan_name);
    }
    
    res.json({
      success: true,
      data: assignment,
      message: 'Profile assigned to fan successfully'
    });
    
  } catch (error) {
    log.error('Error assigning profile to fan:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to assign profile to fan',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/fan-profiles/calculate-speed
 * Calculate fan speed for given temperature and fan
 */
router.post('/calculate-speed', async (req: Request, res: Response) => {
  try {
    const { fan_id, temperature } = req.body;
    
    if (!fan_id || temperature === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: fan_id and temperature'
      });
    }
    
    const result = await fanProfileManager.calculateFanSpeed(fan_id, temperature);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'No profile assigned to this fan or no curve defined'
      });
    }
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    log.error('Error calculating fan speed:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate fan speed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fan-profiles/assignments/:systemId
 * Get active fan profile assignments for a system
 */
router.get('/assignments/:systemId', async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.systemId);

    if (isNaN(systemId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid system ID'
      });
    }

    const assignments = await fanProfileManager.getSystemAssignments(systemId);

    res.json({
      success: true,
      data: assignments,
      count: assignments.length
    });

  } catch (error) {
    log.error('Error fetching fan assignments:', 'fanProfiles', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fan assignments',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;