import { Router, Request, Response } from 'express';
import { Database } from '../database/database';
import { FanProfileController } from '../services/FanProfileController';
import { log } from '../utils/logger';

const router = Router();
const db = Database.getInstance();

/**
 * POST /api/fan-configurations/sensor
 * Set the control sensor for a fan (independent of profile)
 */
router.post('/sensor', async (req: Request, res: Response) => {
  try {
    const { fan_id, sensor_id } = req.body;

    if (!fan_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: fan_id'
      });
    }

    // Determine if sensor_id is a special identifier or regular sensor ID
    let sensorDbId: number | null = null;
    let sensorIdentifier: string | null = null;

    if (sensor_id !== undefined && sensor_id !== null && sensor_id !== '') {
      if (typeof sensor_id === 'string') {
        // It's a special identifier like "__highest__" or "__group__<name>"
        sensorIdentifier = sensor_id;
      } else {
        // It's a regular sensor database ID
        sensorDbId = sensor_id;
      }
    }

    // Upsert fan configuration
    const result = await db.run(
      `INSERT INTO fan_configurations (fan_id, sensor_id, sensor_identifier, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (fan_id)
       DO UPDATE SET sensor_id = $2, sensor_identifier = $3, updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [fan_id, sensorDbId, sensorIdentifier]
    );

    log.info(` Fan configuration updated: Fan ${fan_id} -> Sensor ${sensorIdentifier || sensorDbId || 'none'}`, 'fanConfigurations');

    // Clear cached hysteresis/stepping state for this fan so the new sensor takes effect immediately
    // Look up the fan details to get agent_id and fan_name
    const fanDetails = await db.get(`
      SELECT f.fan_name, s.agent_id
      FROM fans f
      JOIN systems s ON f.system_id = s.id
      WHERE f.id = $1
    `, [fan_id]);
    
    if (fanDetails) {
      const fanProfileController = FanProfileController.getInstance();
      fanProfileController.clearFanState(fanDetails.agent_id, fanDetails.fan_name);
    }

    res.json({
      success: true,
      message: 'Fan sensor configuration updated',
      data: {
        fan_id,
        sensor_id: sensorIdentifier || sensorDbId
      }
    });

  } catch (error) {
    log.error('Error updating fan configuration:', 'fanConfigurations', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update fan configuration',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fan-configurations/:systemId
 * Get fan configurations for a system
 */
router.get('/:systemId', async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.systemId);

    if (isNaN(systemId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid system ID'
      });
    }

    const configs = await db.all(`
      SELECT
        fc.id,
        fc.fan_id,
        fc.sensor_id,
        fc.sensor_identifier,
        f.fan_name,
        s.sensor_name
      FROM fan_configurations fc
      JOIN fans f ON fc.fan_id = f.id
      LEFT JOIN sensors s ON fc.sensor_id = s.id
      WHERE f.system_id = $1
    `, [systemId]);

    // Process configs to return the appropriate sensor_id
    const processedConfigs = configs.map(config => ({
      ...config,
      sensor_id: config.sensor_identifier || config.sensor_id
    }));

    res.json({
      success: true,
      data: processedConfigs,
      count: processedConfigs.length
    });

  } catch (error) {
    log.error('Error fetching fan configurations:', 'fanConfigurations', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fan configurations',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
