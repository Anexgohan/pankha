import Database from '../database/database';
import { DataAggregator } from './DataAggregator';
import { CommandDispatcher } from './CommandDispatcher';
import { AgentManager } from './AgentManager';
import { log } from '../utils/logger';

interface FanAssignment {
  assignment_id: number;
  fan_id: number;
  profile_id: number;
  sensor_id: number | null;
  sensor_identifier: string | null;
  system_id: number;
  agent_id: string;
  fan_name: string;
  fan_min_speed: number;
  fan_max_speed: number;
  profile_name: string;
  sensor_name: string | null;
}

interface CurvePoint {
  temperature: number;
  fan_speed: number;
}

/**
 * Fan Profile Controller
 *
 * Continuously monitors sensor temperatures and applies fan profile curves
 * to automatically control fan speeds based on assigned profiles.
 *
 * Based on the logic from /root/anex/proxmox/misc-scripts/fan-control/fan_control.py
 */
export class FanProfileController {
  private static instance: FanProfileController;
  private db: Database;
  private dataAggregator: DataAggregator;
  private commandDispatcher: CommandDispatcher;
  private agentManager: AgentManager;

  private updateInterval: number = 2000; // Default 2 seconds
  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private consecutiveErrors: number = 0;
  private maxConsecutiveErrors: number = 5;

  // Track sensor availability to only log state changes
  private sensorAvailabilityState: Map<string, boolean> = new Map();

  // Hysteresis and stepping state tracking
  private lastAppliedSpeeds: Map<string, number> = new Map();
  private lastSignificantTemp: Map<string, number> = new Map();
  private lastSpeedChangeTime: Map<string, number> = new Map();
  private lastTargetSpeeds: Map<string, number> = new Map(); // Track target speed for hysteresis

  private constructor() {
    this.db = Database.getInstance();
    this.dataAggregator = DataAggregator.getInstance();
    this.commandDispatcher = CommandDispatcher.getInstance();
    this.agentManager = AgentManager.getInstance();
  }

  public static getInstance(): FanProfileController {
    if (!FanProfileController.instance) {
      FanProfileController.instance = new FanProfileController();
    }
    return FanProfileController.instance;
  }

  /**
   * Calculate fan speed from temperature using curve interpolation
   * Algorithm adapted from old fan_control.py:get_fan_speed()
   */
  private calculateFanSpeed(temperature: number, curvePoints: CurvePoint[]): number {
    if (curvePoints.length === 0) {
      log.warn('No curve points provided, defaulting to 50%', 'FanProfileController');
      return 50;
    }

    // Sort points by temperature (ascending)
    const sorted = [...curvePoints].sort((a, b) => a.temperature - b.temperature);

    // Edge case: temperature at or below lowest point
    if (temperature <= sorted[0].temperature) {
      return sorted[0].fan_speed;
    }

    // Edge case: temperature at or above highest point
    if (temperature >= sorted[sorted.length - 1].temperature) {
      return sorted[sorted.length - 1].fan_speed;
    }

    // Find the two points to interpolate between
    for (let i = 0; i < sorted.length - 1; i++) {
      const lower = sorted[i];
      const upper = sorted[i + 1];

      if (temperature >= lower.temperature && temperature < upper.temperature) {
        // Linear interpolation
        const tempRange = upper.temperature - lower.temperature;
        const speedRange = upper.fan_speed - lower.fan_speed;
        const tempOffset = temperature - lower.temperature;

        const interpolatedSpeed = lower.fan_speed + (tempOffset / tempRange) * speedRange;
        return Math.round(interpolatedSpeed);
      }
    }

    // Fallback (should never reach here)
    return sorted[0].fan_speed;
  }

  /**
   * Apply min/max speed constraints
   */
  private applySpeedConstraints(speed: number, minSpeed: number, maxSpeed: number): number {
    return Math.max(minSpeed, Math.min(speed, maxSpeed));
  }

  /**
   * Get all active fan profile assignments with related data
   */
  private async getActiveFanAssignments(): Promise<FanAssignment[]> {
    try {
      const assignments = await this.db.all(`
        SELECT
          fpa.id as assignment_id,
          fpa.fan_id,
          fpa.profile_id,
          -- Prioritize sensor from fan_configurations, fallback to fan_profile_assignments
          COALESCE(fc.sensor_id, fpa.sensor_id) as sensor_id,
          COALESCE(fc.sensor_identifier, fpa.sensor_identifier) as sensor_identifier,
          f.system_id,
          s.agent_id,
          f.fan_name,
          f.min_speed as fan_min_speed,
          f.max_speed as fan_max_speed,
          fp.profile_name,
          sens.sensor_name
        FROM fan_profile_assignments fpa
        JOIN fans f ON fpa.fan_id = f.id
        JOIN fan_profiles fp ON fpa.profile_id = fp.id
        JOIN systems s ON f.system_id = s.id
        LEFT JOIN fan_configurations fc ON f.id = fc.fan_id
        LEFT JOIN sensors sens ON COALESCE(fc.sensor_id, fpa.sensor_id) = sens.id
        WHERE fpa.is_active = TRUE
          AND f.enabled = TRUE
          AND f.is_controllable = TRUE
          AND s.status = 'online'
      `);

      return assignments;
    } catch (error) {
      log.error('Error fetching active fan assignments', 'FanProfileController', error);
      return [];
    }
  }

  /**
   * Get current temperature from sensor or special identifier
   */
  private getSensorTemperature(
    agentId: string,
    sensorId: number | null,
    sensorIdentifier: string | null
  ): number | null {
    try {
      const systemData = this.dataAggregator.getSystemData(agentId);
      if (!systemData || !systemData.sensors || systemData.sensors.length === 0) {
        return null;
      }

      // Handle special identifiers
      if (sensorIdentifier && sensorIdentifier.trim() !== '') {
        // Handle "__highest__" - return highest temperature on the system
        if (sensorIdentifier === '__highest__') {
          const temperatures = systemData.sensors.map(s => s.temperature);
          return temperatures.length > 0 ? Math.max(...temperatures) : null;
        }

        // Handle "__group__<name>" - return highest temperature in that group
        if (sensorIdentifier.startsWith('__group__')) {
          const groupName = sensorIdentifier.replace('__group__', '');
          const groupSensors = systemData.sensors.filter(s => {
            // Extract chip name from sensor ID (e.g., "k10temp_1" -> "k10temp")
            const chipMatch = s.id.match(/^([a-z0-9_]+?)_\d+$/i);
            const chipName = chipMatch ? chipMatch[1] : s.id.split('_')[0];
            return chipName === groupName;
          });

          if (groupSensors.length > 0) {
            const temperatures = groupSensors.map(s => s.temperature);
            return Math.max(...temperatures);
          }
          return null;
        }
      }

      // Handle regular sensor ID (numeric database ID)
      if (sensorId) {
        const sensor = systemData.sensors.find(s => s.dbId === sensorId);
        return sensor?.temperature || null;
      }

      return null;
    } catch (error) {
      log.error('Error getting sensor temperature', 'FanProfileController', error);
      return null;
    }
  }

  /**
   * Get fan profile curve points
   */
  private async getProfileCurvePoints(profileId: number): Promise<CurvePoint[]> {
    try {
      const points = await this.db.all(`
        SELECT temperature, fan_speed
        FROM fan_curve_points
        WHERE profile_id = $1
        ORDER BY point_order ASC
      `, [profileId]);

      return points;
    } catch (error) {
      log.error(`Error fetching curve points for profile ${profileId}`, 'FanProfileController', error);
      return [];
    }
  }

  /**
   * Send fan speed command to agent
   */
  private async sendFanSpeedCommand(
    agentId: string,
    fanName: string,
    speed: number
  ): Promise<void> {
    try {
      await this.commandDispatcher.setFanSpeed(agentId, fanName, speed, 'normal');
    } catch (error) {
      log.error(`Error sending fan speed command to ${agentId}/${fanName}`, 'FanProfileController', error);
      throw error;
    }
  }

  /**
   * Apply fan control with hysteresis and stepping
   *
   * This method implements:
   * 1. Emergency override - immediately go to 100% if temperature exceeds emergency threshold
   * 2. Hysteresis - only react if temperature changed significantly
   * 3. Fan stepping - change speed incrementally, not instantly
   */
  private async applyFanControl(
    agentId: string,
    fanName: string,
    currentTemp: number,
    targetSpeed: number
  ): Promise<void> {
    const fanKey = `${agentId}:${fanName}`;

    // Get agent-specific settings
    const fanStep = this.agentManager.getAgentFanStep(agentId);
    const hysteresis = this.agentManager.getAgentHysteresis(agentId);
    const emergencyTemp = this.agentManager.getAgentEmergencyTemp(agentId);

    // EMERGENCY OVERRIDE: Skip all logic if critical temp
    if (currentTemp >= emergencyTemp) {
      log.warn(
        `🚨 EMERGENCY: Agent ${agentId} temp ${currentTemp.toFixed(1)}°C >= ${emergencyTemp}°C - ` +
        `Setting fan ${fanName} to 100%`,
        'FanProfileController'
      );
      await this.sendFanSpeedCommand(agentId, fanName, 100);
      this.lastAppliedSpeeds.set(fanKey, 100);
      this.lastSignificantTemp.set(fanKey, currentTemp);
      this.lastSpeedChangeTime.set(fanKey, Date.now());
      return;
    }

    // Get current state
    const currentSpeed = this.lastAppliedSpeeds.get(fanKey) || 0;
    const lastTemp = this.lastSignificantTemp.get(fanKey);

    // Initialize if first run
    if (currentSpeed === 0 && lastTemp === undefined) {
      this.lastAppliedSpeeds.set(fanKey, targetSpeed);
      this.lastSpeedChangeTime.set(fanKey, Date.now());
      await this.sendFanSpeedCommand(agentId, fanName, targetSpeed);
      log.debug(
        `Fan ${fanName} initialized: temp=${currentTemp.toFixed(1)}°C, speed=${targetSpeed}%`,
        'FanProfileController'
      );
      return;
    }

    // Note: Hysteresis is now handled in control loop before calling this method

    // FAN STEP: Calculate next speed (incremental change)
    let nextSpeed: number;

    if (fanStep >= 100) {
      // Disable stepping - instant change
      nextSpeed = targetSpeed;
    } else if (targetSpeed > currentSpeed) {
      // Need to increase speed
      nextSpeed = Math.min(currentSpeed + fanStep, targetSpeed);
    } else if (targetSpeed < currentSpeed) {
      // Need to decrease speed
      nextSpeed = Math.max(currentSpeed - fanStep, targetSpeed);
    } else {
      // Already at target
      return;
    }

    // Apply the speed change
    await this.sendFanSpeedCommand(agentId, fanName, nextSpeed);

    // Update tracking state
    this.lastAppliedSpeeds.set(fanKey, nextSpeed);
    this.lastSpeedChangeTime.set(fanKey, Date.now());

    // Log the action (debug level to avoid spam)
    const direction = nextSpeed > currentSpeed ? '↑' : nextSpeed < currentSpeed ? '↓' : '=';
    log.debug(
      `Fan ${fanName}: temp=${currentTemp.toFixed(1)}°C, ${currentSpeed}% ${direction} ${nextSpeed}% ` +
      `(target=${targetSpeed}%, step=${fanStep}%, hyst=${hysteresis}°C)`,
      'FanProfileController'
    );
  }

  /**
   * Main control loop - runs every updateInterval milliseconds
   */
  private async controlLoop(): Promise<void> {
    try {
      // Get all active fan profile assignments
      const assignments = await this.getActiveFanAssignments();

      if (assignments.length === 0) {
        // No active assignments, nothing to do
        return;
      }

      // Process each assignment
      for (const assignment of assignments) {
        try {
          // Get current sensor temperature
          const temperature = this.getSensorTemperature(
            assignment.agent_id,
            assignment.sensor_id,
            assignment.sensor_identifier
          );

          // Track sensor availability state to avoid log spam
          const stateKey = `${assignment.agent_id}:${assignment.sensor_name || assignment.sensor_identifier || assignment.sensor_id}:${assignment.fan_name}`;
          const wasAvailable = this.sensorAvailabilityState.get(stateKey);

          if (temperature === null) {
            // Only log when sensor becomes unavailable (state change)
            if (wasAvailable !== false) {
              log.warn(
                `Sensor ${assignment.sensor_name || assignment.sensor_identifier || assignment.sensor_id} unavailable, ` +
                `skipping fan ${assignment.fan_name}`,
                'FanProfileController'
              );
              this.sensorAvailabilityState.set(stateKey, false);
            }
            continue;
          }

          // Only log when sensor becomes available again (state change)
          if (wasAvailable === false) {
            log.info(
              `Sensor ${assignment.sensor_name || assignment.sensor_identifier || assignment.sensor_id} available, ` +
              `resuming fan ${assignment.fan_name}`,
              'FanProfileController'
            );
          }
          this.sensorAvailabilityState.set(stateKey, true);

          // Get fan profile curve points
          const curvePoints = await this.getProfileCurvePoints(assignment.profile_id);

          if (curvePoints.length === 0) {
            log.warn(
              `No curve points for profile ${assignment.profile_name}, ` +
              `skipping fan ${assignment.fan_name}`,
              'FanProfileController'
            );
            continue;
          }

          // Determine temperature to use for target calculation (hysteresis logic)
          const fanKey = `${assignment.agent_id}:${assignment.fan_name}`;
          const hysteresis = this.agentManager.getAgentHysteresis(assignment.agent_id);
          const lastSignificantTemp = this.lastSignificantTemp.get(fanKey);
          const lastTargetSpeed = this.lastTargetSpeeds.get(fanKey);

          let tempForTarget: number;
          let targetSpeed: number;

          // Check if we should recalculate target based on hysteresis
          if (lastSignificantTemp !== undefined && hysteresis > 0) {
            const tempDiff = Math.abs(temperature - lastSignificantTemp);

            if (tempDiff < hysteresis && lastTargetSpeed !== undefined) {
              // Within hysteresis zone - use last target
              targetSpeed = lastTargetSpeed;
              tempForTarget = lastSignificantTemp;
            } else {
              // Crossed hysteresis threshold - recalculate target
              tempForTarget = temperature;
              targetSpeed = this.calculateFanSpeed(temperature, curvePoints);
              this.lastSignificantTemp.set(fanKey, temperature);
              this.lastTargetSpeeds.set(fanKey, targetSpeed);
            }
          } else {
            // First run or hysteresis disabled - always calculate
            tempForTarget = temperature;
            targetSpeed = this.calculateFanSpeed(temperature, curvePoints);
            this.lastSignificantTemp.set(fanKey, temperature);
            this.lastTargetSpeeds.set(fanKey, targetSpeed);
          }

          // Apply min/max constraints from fan configuration
          const constrainedSpeed = this.applySpeedConstraints(
            targetSpeed,
            assignment.fan_min_speed,
            assignment.fan_max_speed
          );

          // Apply fan control with stepping (hysteresis already handled above)
          await this.applyFanControl(
            assignment.agent_id,
            assignment.fan_name,
            temperature,
            constrainedSpeed
          );

        } catch (error) {
          log.error(`Error processing fan assignment ${assignment.assignment_id}`, 'FanProfileController', error);
          // Continue with next assignment
        }
      }

      // Reset error counter on successful loop
      this.consecutiveErrors = 0;

    } catch (error) {
      log.error('Fan profile controller loop error', 'FanProfileController', error);
      this.consecutiveErrors++;

      // Safety: If too many consecutive errors, stop the controller
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        log.error(
          `Fan controller stopped after ${this.maxConsecutiveErrors} consecutive errors`,
          'FanProfileController'
        );
        this.stop();
      }
    }
  }

  /**
   * Load controller interval from database
   */
  private async loadControllerInterval(): Promise<number> {
    try {
      const setting = await this.db.get(
        'SELECT setting_value FROM backend_settings WHERE setting_key = $1',
        ['controller_update_interval']
      );

      if (setting && setting.setting_value) {
        const interval = parseInt(setting.setting_value, 10);
        log.info(`Loaded controller interval from database: ${interval}ms`, 'FanProfileController');
        return interval;
      }
    } catch (error) {
      log.error('Error loading controller interval from database:', 'FanProfileController', error);
    }

    // Default fallback
    log.info('Using default controller interval: 2000ms', 'FanProfileController');
    return 2000;
  }

  /**
   * Save controller interval to database
   */
  private async saveControllerInterval(intervalMs: number): Promise<void> {
    try {
      await this.db.run(
        `INSERT INTO backend_settings (setting_key, setting_value, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP`,
        ['controller_update_interval', intervalMs.toString(), 'Fan Profile Controller update interval in milliseconds']
      );
      log.info(`Saved controller interval to database: ${intervalMs}ms`, 'FanProfileController');
    } catch (error) {
      log.error('Error saving controller interval to database:', 'FanProfileController', error);
    }
  }

  /**
   * Start the controller with specified update rate
   */
  public async start(updateIntervalMs?: number): Promise<void> {
    if (this.isRunning) {
      log.warn('Fan profile controller already running', 'FanProfileController');
      return;
    }

    // Load from database if no interval specified
    const intervalToUse = updateIntervalMs !== undefined
      ? updateIntervalMs
      : await this.loadControllerInterval();

    this.updateInterval = intervalToUse;
    this.isRunning = true;
    this.consecutiveErrors = 0;

    log.info(`Starting fan profile controller (update rate: ${intervalToUse}ms)`, 'FanProfileController');

    // Run immediately, then repeat
    this.controlLoop();
    this.intervalTimer = setInterval(
      () => this.controlLoop(),
      this.updateInterval
    );
  }

  /**
   * Stop the controller
   */
  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isRunning = false;
    log.info('Fan profile controller stopped', 'FanProfileController');
  }

  /**
   * Update the control loop frequency
   */
  public async setUpdateInterval(intervalMs: number): Promise<void> {
    if (intervalMs < 500 || intervalMs > 60000) {
      throw new Error('Update interval must be between 500ms and 60000ms');
    }

    log.info(`Updating fan controller interval: ${this.updateInterval}ms -> ${intervalMs}ms`, 'FanProfileController');
    this.updateInterval = intervalMs;

    // Save to database
    await this.saveControllerInterval(intervalMs);

    if (this.isRunning) {
      // Restart with new interval
      this.stop();
      this.start(intervalMs);
    }
  }

  /**
   * Get controller status
   */
  public getStatus(): { isRunning: boolean; updateInterval: number; consecutiveErrors: number } {
    return {
      isRunning: this.isRunning,
      updateInterval: this.updateInterval,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}
