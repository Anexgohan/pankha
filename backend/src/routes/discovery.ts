import { Router, Request, Response } from 'express';
import Database from '../database/database';
import { AgentManager } from '../services/AgentManager';
import { CommandDispatcher } from '../services/CommandDispatcher';
import { log } from '../utils/logger';

const router = Router();
const db = Database.getInstance();
const agentManager = AgentManager.getInstance();
const commandDispatcher = CommandDispatcher.getInstance();

// POST /api/discovery/scan - Scan for new systems
router.post('/scan', async (req: Request, res: Response) => {
  try {
    const { 
      ip_range = '192.168.1.0/24',
      port_range = '8080-8090',
      timeout = 5000 
    } = req.body;

    // This would typically perform network scanning to find agents
    // For now, return a mock response
    const discoveredSystems = [
      {
        ip_address: '192.168.1.100',
        api_endpoint: 'http://192.168.1.100:8080',
        websocket_endpoint: 'ws://192.168.1.100:8081',
        agent_id: 'linux-agent-001',
        agent_version: '1.0.0',
        name: 'Gaming PC',
        capabilities: {
          sensors: [
            {
              id: 'cpu_temp',
              name: 'Tctl',
              label: 'CPU Temperature',
              chip: 'k10temp-pci-00c3',
              type: 'cpu',
              currentTemp: 45.5,
              maxTemp: 90,
              critTemp: 95,
              hwmonPath: '/sys/class/hwmon/hwmon1',
              tempInputPath: '/sys/class/hwmon/hwmon1/temp1_input',
              isAvailable: true
            }
          ],
          fans: [
            {
              id: 'cpu_fan',
              name: 'fan1',
              label: 'CPU Fan',
              pwmPath: '/sys/class/hwmon/hwmon1/pwm1',
              rpmPath: '/sys/class/hwmon/hwmon1/fan1_input',
              currentRpm: 1200,
              isControllable: true,
              minSpeed: 20,
              maxSpeed: 100
            }
          ]
        }
      }
    ];

    res.json({
      scan_parameters: {
        ip_range,
        port_range,
        timeout
      },
      discovered_systems: discoveredSystems,
      scan_completed_at: new Date().toISOString()
    });

  } catch (error) {
    log.error('Error scanning for systems:', 'discovery', error);
    res.status(500).json({ error: 'Failed to scan for systems' });
  }
});

// GET /api/discovery/hardware - Get detected hardware info
router.get('/hardware', async (req: Request, res: Response) => {
  try {
    const { agent_id } = req.query;

    if (!agent_id) {
      return res.status(400).json({ error: 'agent_id parameter is required' });
    }

    // Get hardware info from agent
    try {
      const result = await commandDispatcher.rescanSensors(agent_id as string);
      
      res.json({
        agent_id,
        hardware_info: result,
        scanned_at: new Date().toISOString()
      });
      
    } catch (commandError) {
      // If agent command fails, return cached data from database
      const system = await db.get('SELECT capabilities FROM systems WHERE agent_id = $1', [agent_id]);
      
      if (!system) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const capabilities = system.capabilities || null;
      
      res.json({
        agent_id,
        hardware_info: capabilities,
        scanned_at: null,
        note: 'Returned cached data due to agent communication error'
      });
    }

  } catch (error) {
    log.error('Error getting hardware info:', 'discovery', error);
    res.status(500).json({ error: 'Failed to get hardware info' });
  }
});

// POST /api/discovery/test-fan - Test fan control safely
router.post('/test-fan', async (req: Request, res: Response) => {
  try {
    const { 
      agent_id, 
      fan_id, 
      test_speed = 50,
      test_duration = 5000,
      restore_speed 
    } = req.body;

    if (!agent_id || !fan_id) {
      return res.status(400).json({ error: 'agent_id and fan_id are required' });
    }

    // Validate test parameters
    if (test_speed < 0 || test_speed > 100) {
      return res.status(400).json({ error: 'test_speed must be between 0 and 100' });
    }

    if (test_duration < 1000 || test_duration > 30000) {
      return res.status(400).json({ error: 'test_duration must be between 1000 and 30000 ms' });
    }

    // Get current fan speed before test
    const system = await db.get('SELECT id FROM systems WHERE agent_id = $1', [agent_id]);
    if (!system) {
      return res.status(404).json({ error: 'System not found' });
    }

    const fan = await db.get(
      'SELECT current_speed FROM fans WHERE system_id = $1 AND fan_name = $2',
      [system.id, fan_id]
    );

    const originalSpeed = fan?.current_speed || restore_speed || 30; // Default to 30% if unknown

    try {
      // Set test speed
      await commandDispatcher.setFanSpeed(agent_id, fan_id, test_speed, 'high');
      
      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, test_duration));
      
      // Restore original speed
      await commandDispatcher.setFanSpeed(agent_id, fan_id, originalSpeed, 'high');

      res.json({
        test_completed: true,
        agent_id,
        fan_id,
        test_speed,
        test_duration,
        original_speed: originalSpeed,
        message: 'Fan test completed successfully'
      });

    } catch (commandError) {
      // Try to restore original speed even if test failed
      try {
        await commandDispatcher.setFanSpeed(agent_id, fan_id, originalSpeed, 'emergency');
      } catch (restoreError) {
        log.error('Failed to restore fan speed after test failure:', 'discovery', restoreError);
      }

      throw commandError;
    }

  } catch (error) {
    log.error('Error testing fan:', 'discovery', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to test fan',
      test_completed: false
    });
  }
});

// GET /api/systems/:id/sensors/scan - Rescan sensors on specific system
router.get('/systems/:id/sensors/scan', async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);

    const system = await db.get('SELECT agent_id FROM systems WHERE id = $1', [systemId]);
    if (!system) {
      return res.status(404).json({ error: 'System not found' });
    }

    const result = await commandDispatcher.rescanSensors(system.agent_id);
    
    res.json({
      system_id: systemId,
      agent_id: system.agent_id,
      scan_result: result,
      scanned_at: new Date().toISOString()
    });

  } catch (error) {
    log.error('Error rescanning sensors:', 'discovery', error);
    res.status(500).json({ error: 'Failed to rescan sensors' });
  }
});

// PUT /api/systems/:id/sensors/:sensorId - Configure sensor settings
router.put('/systems/:id/sensors/:sensorId', async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const sensorId = parseInt(req.params.sensorId);
    const {
      sensor_label,
      temp_max,
      temp_crit,
      is_primary,
      user_selected
    } = req.body;

    const sensor = await db.get(
      'SELECT * FROM sensors WHERE id = $1 AND system_id = $2',
      [sensorId, systemId]
    );

    if (!sensor) {
      return res.status(404).json({ error: 'Sensor not found' });
    }

    await db.run(`
      UPDATE sensors SET
        sensor_label = COALESCE($1, sensor_label),
        temp_max = COALESCE($2, temp_max),
        temp_crit = COALESCE($3, temp_crit),
        is_primary = COALESCE($4, is_primary),
        user_selected = COALESCE($5, user_selected)
      WHERE id = $6
    `, [
      sensor_label,
      temp_max,
      temp_crit,
      is_primary,
      user_selected,
      sensorId
    ]);

    // If setting as primary, unset other primary sensors of same type
    if (is_primary) {
      await db.run(`
        UPDATE sensors SET is_primary = false
        WHERE system_id = $1 AND sensor_type = $2 AND id != $3
      `, [systemId, sensor.sensor_type, sensorId]);
    }

    const updatedSensor = await db.get('SELECT * FROM sensors WHERE id = $1', [sensorId]);
    
    res.json(updatedSensor);

  } catch (error) {
    log.error('Error updating sensor configuration:', 'discovery', error);
    res.status(500).json({ error: 'Failed to update sensor configuration' });
  }
});

// POST /api/systems/:id/sensor-mapping - Save sensor-to-fan mappings
router.post('/systems/:id/sensor-mapping', async (req: Request, res: Response) => {
  try {
    const systemId = parseInt(req.params.id);
    const { mappings } = req.body;

    if (!Array.isArray(mappings)) {
      return res.status(400).json({ error: 'mappings must be an array' });
    }

    const system = await db.get('SELECT agent_id FROM systems WHERE id = $1', [systemId]);
    if (!system) {
      return res.status(404).json({ error: 'System not found' });
    }

    // Validate and update each mapping
    const updatedMappings = [];

    for (const mapping of mappings) {
      const { fan_id, primary_sensor_id, secondary_sensor_id, sensor_logic } = mapping;

      // Get fan record
      const fan = await db.get(
        'SELECT id FROM fans WHERE system_id = $1 AND fan_name = $2',
        [systemId, fan_id]
      );

      if (!fan) {
        return res.status(400).json({ error: `Fan ${fan_id} not found` });
      }

      // Validate sensor IDs
      if (primary_sensor_id) {
        const primarySensor = await db.get(
          'SELECT id FROM sensors WHERE id = $1 AND system_id = $2',
          [primary_sensor_id, systemId]
        );
        if (!primarySensor) {
          return res.status(400).json({ error: `Primary sensor ${primary_sensor_id} not found` });
        }
      }

      if (secondary_sensor_id) {
        const secondarySensor = await db.get(
          'SELECT id FROM sensors WHERE id = $1 AND system_id = $2',
          [secondary_sensor_id, systemId]
        );
        if (!secondarySensor) {
          return res.status(400).json({ error: `Secondary sensor ${secondary_sensor_id} not found` });
        }
      }

      // Update fan mapping
      await db.run(`
        UPDATE fans SET
          primary_sensor_id = $1,
          secondary_sensor_id = $2,
          sensor_logic = $3
        WHERE id = $4
      `, [
        primary_sensor_id || null,
        secondary_sensor_id || null,
        sensor_logic || 'max',
        fan.id
      ]);

      updatedMappings.push({
        fan_id,
        primary_sensor_id,
        secondary_sensor_id,
        sensor_logic: sensor_logic || 'max'
      });
    }

    // Convert mappings to the format expected by commandDispatcher
    const agentMappings = updatedMappings.map(mapping => ({
      fanId: mapping.fan_id,
      primarySensorId: mapping.primary_sensor_id,
      secondarySensorId: mapping.secondary_sensor_id,
      logic: mapping.sensor_logic as 'max' | 'avg' | 'primary_only'
    }));

    // Send updated mappings to agent
    try {
      await commandDispatcher.updateSensorMapping(system.agent_id, agentMappings);
    } catch (commandError) {
      log.warn('Failed to send mapping update to agent:', 'discovery', commandError);
      // Continue with response even if agent update fails
    }

    res.json({
      system_id: systemId,
      agent_id: system.agent_id,
      updated_mappings: updatedMappings,
      updated_at: new Date().toISOString()
    });

  } catch (error) {
    log.error('Error updating sensor mappings:', 'discovery', error);
    res.status(500).json({ error: 'Failed to update sensor mappings' });
  }
});

export default router;