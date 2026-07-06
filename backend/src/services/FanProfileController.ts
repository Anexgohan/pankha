import { EventEmitter } from 'events';
import Database from '../database/database';
import { DataAggregator } from './DataAggregator';
import { CommandDispatcher } from './CommandDispatcher';
import { AgentManager } from './AgentManager';
import { log } from '../utils/logger';
import { deriveChipName } from '../utils/sensorUtils';
import { CALIBRATION_VERSION } from '../config/calibration';

interface FanAssignment {
  assignment_id: number;
  fan_id: number;
  profile_id: number;
  sensor_id: number | null;
  sensor_identifier: string | null;
  system_id: number;
  agent_id: string;
  fan_name: string;
  zone_id: string | null;
  fan_min_speed: number;
  fan_max_speed: number;
  profile_name: string;
  sensor_name: string | null;
  // Calibration facts (LEFT JOIN fan_calibrations; null until calibrated)
  cal_status: string | null;
  cal_min_start: number | null;
  cal_min_stop: number | null;
  cal_version: number | null;
}

interface CurvePoint {
  temperature: number;
  fan_speed: number;
}

// Re-assert tolerance (% points of duty). Ignore gaps this small (pwm<->percent
// rounding + noise); real external-controller drags are far larger.
const REASSERT_TOLERANCE_PERCENT = 5;

// Stall watchdog: consecutive at-target ticks with rpm 0 before declaring a stall.
const STALL_DEBOUNCE_TICKS = 3;

// Median of a non-empty array (even length -> mean of the two middle values).
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fan Profile Controller
 *
 * Continuously monitors sensor temperatures and applies fan profile curves
 * to automatically control fan speeds based on assigned profiles.
 *
 * Based on the logic from /root/anex/proxmox/misc-scripts/fan-control/fan_control.py
 */
export class FanProfileController extends EventEmitter {
  private static instance: FanProfileController;
  private db: Database;
  private dataAggregator: DataAggregator;
  private commandDispatcher: CommandDispatcher;
  private agentManager: AgentManager;

  private updateInterval: number = 2000; // Default 2 seconds
  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private loopRunning: boolean = false; // prevents overlapping controlLoop() ticks
  private consecutiveErrors: number = 0;
  private maxConsecutiveErrors: number = 5;

  // Track sensor availability to only log state changes
  private sensorAvailabilityState: Map<string, boolean> = new Map();

  // Track emergency state to only log when entering/exiting
  private emergencyState: Map<string, boolean> = new Map();

  // Hysteresis and stepping state tracking
  private lastAppliedSpeeds: Map<string, number> = new Map();
  private lastSignificantTemp: Map<string, number> = new Map();
  private lastSpeedChangeTime: Map<string, number> = new Map();
  private lastTargetSpeeds: Map<string, number> = new Map(); // Track target speed for hysteresis

  // Zero-snap state (calibrated fans only): which side of the dead zone the
  // fan was last snapped to. Sticky band prevents start/stop flapping.
  private snapState: Map<string, 'stopped' | 'spinning'> = new Map();

  // Stall watchdog state (calibrated fans with a working tach only)
  private stallTicks: Map<string, number> = new Map();   // consecutive rpm-0 ticks at target
  private stalledFans: Set<string> = new Set();          // currently flagged as stalled
  private tachSeen: Set<string> = new Set();             // fanKey has reported rpm > 0 at least once

  // Fans locked by an active calibration run - skipped by the control loop.
  // Managed by CalibrationService via setFanCalibrating().
  private calibratingFans: Set<string> = new Set();

  // Virtual sensor defs for the current control tick (id -> {operation, member dbIds}).
  // Rebuilt fresh each tick from the DB, like the curve-points batch - no cache to invalidate.
  private virtualDefs: Map<number, { operation: 'max' | 'avg' | 'median'; memberDbIds: number[] }> = new Map();

  private constructor() {
    super();
    this.db = Database.getInstance();
    this.dataAggregator = DataAggregator.getInstance();
    this.commandDispatcher = CommandDispatcher.getInstance();
    this.agentManager = AgentManager.getInstance();

    // Clear all fan state when agent reconnects so control loop reinitializes cleanly.
    // This is the automatic equivalent of the user manually resetting the fan profile.
    this.agentManager.on('agentRegistered', (agentConfig: { agentId: string }) => {
      this.clearFanStateForAgent(agentConfig.agentId);
    });
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
   * Zero-snap for calibrated fans (dead-zone compensation).
   *
   * Fans cannot run below their measured min_start duty. Targets inside the
   * dead zone snap to the NEAREST of {0, min_start} around midpoint
   * (min_start / 2), with a sticky band equal to the agent's hysteresis value
   * (as duty points) to prevent start/stop flapping at the midpoint:
   *   - stopped fan starts only when target >= midpoint + band
   *   - spinning fan stops only when target <= midpoint - band
   * An explicit target of 0 is always honored. Uncalibrated / no_tach fans
   * pass through unchanged (today's behavior).
   */
  private applyZeroSnap(
    fanKey: string,
    agentId: string,
    commandTarget: string,
    target: number,
    calStatus: string | null,
    calMinStart: number | null
  ): number {
    if (calStatus !== 'done' || !calMinStart || calMinStart <= 0) {
      return target; // not calibrated (or no dead zone measured)
    }

    if (target === 0) {
      this.snapState.set(fanKey, 'stopped'); // explicit stop is a real request
      return 0;
    }
    if (target >= calMinStart) {
      this.snapState.set(fanKey, 'spinning'); // achievable duty, no snap needed
      return target;
    }

    // Dead zone: closest-match with sticky band
    const midpoint = calMinStart / 2;
    const band = this.agentManager.getAgentHysteresis(agentId); // duty points (design D5)

    let state = this.snapState.get(fanKey);
    if (state === undefined) {
      // Seed from reported RPM (ground truth); unknown -> 'stopped' so the
      // first decision can only err toward spinning (cooling-safe).
      const rpm = this.dataAggregator.getSystemData(agentId)?.fans
        ?.find(f => f.id === commandTarget || f.zone === commandTarget)?.rpm;
      state = rpm && rpm > 0 ? 'spinning' : 'stopped';
      this.snapState.set(fanKey, state);
    }

    if (state === 'stopped') {
      if (target >= midpoint + band) {
        this.snapState.set(fanKey, 'spinning');
        log.debug(`Zero-snap: fan ${commandTarget} target ${target}% in dead zone, snapping UP to ${calMinStart}%`, 'FanProfileController');
        return calMinStart;
      }
      return 0;
    } else {
      if (target <= midpoint - band) {
        this.snapState.set(fanKey, 'stopped');
        log.debug(`Zero-snap: fan ${commandTarget} target ${target}% in dead zone, snapping DOWN to 0%`, 'FanProfileController');
        return 0;
      }
      return calMinStart; // hold spinning at the floor
    }
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
          f.zone_id,
          f.min_speed as fan_min_speed,
          f.max_speed as fan_max_speed,
          fp.profile_name,
          sens.sensor_name,
          cal.status AS cal_status,
          cal.min_start AS cal_min_start,
          cal.min_stop AS cal_min_stop,
          cal.calibration_version AS cal_version
        FROM fan_profile_assignments fpa
        JOIN fans f ON fpa.fan_id = f.id
        JOIN fan_profiles fp ON fpa.profile_id = fp.id
        JOIN systems s ON f.system_id = s.id
        LEFT JOIN fan_configurations fc ON f.id = fc.fan_id
        LEFT JOIN sensors sens ON COALESCE(fc.sensor_id, fpa.sensor_id) = sens.id
        LEFT JOIN fan_calibrations cal ON f.id = cal.fan_id
        WHERE fpa.is_active = TRUE
          AND f.enabled = TRUE
          AND f.is_stale = FALSE
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
        // Handle "__highest__" - return highest temperature on the system (excluding hidden sensors)
        if (sensorIdentifier === '__highest__') {
          const visibleSensors = systemData.sensors.filter(s => !s.isHidden);
          const temperatures = visibleSensors.map(s => s.temperature);
          return temperatures.length > 0 ? Math.max(...temperatures) : null;
        }

        // Handle "__group__<name>" - return highest temperature in that group (excluding hidden sensors)
        if (sensorIdentifier.startsWith('__group__')) {
          const groupName = sensorIdentifier.replace('__group__', '');
          const groupSensors = systemData.sensors.filter(s => {
            // Skip hidden sensors
            if (s.isHidden) return false;

            const chipName = deriveChipName(s.id);
            return chipName === groupName;
          });

          if (groupSensors.length > 0) {
            const temperatures = groupSensors.map(s => s.temperature);
            return Math.max(...temperatures);
          }
          return null;
        }

        // Handle "__virtual__<id>" - max/avg of the virtual sensor's member sensors.
        // Members are matched by dbId and INCLUDED even if hidden (explicit user choice,
        // unlike __highest__/__group__). Defs are batch-loaded per tick into this.virtualDefs.
        if (sensorIdentifier.startsWith('__virtual__')) {
          const vid = parseInt(sensorIdentifier.slice('__virtual__'.length), 10);
          const def = this.virtualDefs.get(vid);
          if (!def || def.memberDbIds.length === 0) return null;
          const temps = systemData.sensors
            .filter(s => s.dbId != null && def.memberDbIds.includes(s.dbId))
            .map(s => s.temperature);
          if (temps.length === 0) return null;
          if (def.operation === 'avg') return temps.reduce((a, b) => a + b, 0) / temps.length;
          if (def.operation === 'median') return median(temps);
          return Math.max(...temps);
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
    targetSpeed: number,
    calStatus: string | null = null,
    calMinStart: number | null = null,
    calMinStop: number | null = null
  ): Promise<void> {
    const fanKey = `${agentId}:${fanName}`;

    // One telemetry lookup reused below (state seeding, reassert, stall watchdog)
    const reportedFan = this.dataAggregator.getSystemData(agentId)?.fans
      ?.find(f => f.id === fanName || f.zone === fanName);

    // Stall bookkeeping: any live tach reading clears stall state
    if (reportedFan?.rpm !== undefined && reportedFan.rpm > 0) {
      this.tachSeen.add(fanKey);
      this.stallTicks.delete(fanKey);
      if (this.stalledFans.delete(fanKey)) {
        log.info(`Fan ${fanName} on agent ${agentId} recovered from stall`, 'FanProfileController');
        this.emit('fanStallCleared', { agentId, fanId: fanName });
      }
    }

    // Get agent-specific settings
    const fanStep = this.agentManager.getAgentFanStep(agentId);
    const hysteresis = this.agentManager.getAgentHysteresis(agentId);
    const emergencyTemp = this.agentManager.getAgentEmergencyTemp(agentId);

    // EMERGENCY OVERRIDE: Skip all logic if critical temp
    if (currentTemp >= emergencyTemp) {
      const wasEmergency = this.emergencyState.get(fanKey);
      
      if (!wasEmergency) {
        log.warn(
          `🚨 EMERGENCY: Agent ${agentId} temp ${currentTemp.toFixed(1)}°C >= ${emergencyTemp}°C - ` +
          `Force Setting fan ${fanName} to 100%`,
          'FanProfileController'
        );
        this.emergencyState.set(fanKey, true);
      }
      
      await this.sendFanSpeedCommand(agentId, fanName, 100);
      this.lastAppliedSpeeds.set(fanKey, 100);
      this.lastSignificantTemp.set(fanKey, currentTemp);
      this.lastSpeedChangeTime.set(fanKey, Date.now());
      return;
    }

    // Exit emergency state if temp dropped below emergency threshold
    if (this.emergencyState.get(fanKey)) {
      log.info(`✅ EMERGENCY CLEARED: Agent ${agentId} temp ${currentTemp.toFixed(1)}°C < ${emergencyTemp}°C, resuming normal curve for fan ${fanName}`, 'FanProfileController');
      this.emergencyState.set(fanKey, false);
    }

    // Get current state. On first loop / after reconnect we have no internal
    // record, so seed from the agent's reported actual speed instead of 0 - a
    // diverged fan (e.g. left at 100% by failsafe) is then stepped back down.
    // A correct fan reports == target and the "already at target" branch below
    // short-circuits without disturbing it.
    const hasRecord = this.lastAppliedSpeeds.has(fanKey);
    let currentSpeed: number;
    if (hasRecord) {
      currentSpeed = this.lastAppliedSpeeds.get(fanKey)!;
    } else {
      // For OS agents, fanName is the per-fan id. For IPMI agents, fanName is
      // the zone_id; fans expose their parent zone via the `zone` field, and
      // every fan in a zone shares the same Tier-3 speed, so picking any one
      // gives the right value.
      currentSpeed = reportedFan?.speed ?? 0;
      this.lastAppliedSpeeds.set(fanKey, currentSpeed);
      this.lastSpeedChangeTime.set(fanKey, Date.now());
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
      // Calibrated fans: don't crawl the dead zone - jump 0 -> min_start directly
      if (currentSpeed === 0 && calStatus === 'done' && calMinStart && nextSpeed < calMinStart) {
        nextSpeed = Math.min(calMinStart, targetSpeed);
      }
    } else if (targetSpeed < currentSpeed) {
      // Need to decrease speed
      nextSpeed = Math.max(currentSpeed - fanStep, targetSpeed);
      // Calibrated fans: below min_stop the fan stalls anyway - jump to 0
      if (targetSpeed === 0 && calStatus === 'done' && calMinStop !== null && nextSpeed < calMinStop) {
        nextSpeed = 0;
      }
    } else {
      // STALL WATCHDOG (calibrated fans with a seen tach): at target, commanded
      // above min_stop, but the tach reads 0 - fan is physically stopped where
      // it should spin. Detection only: flag + emit, never adjust speed.
      if (
        calStatus === 'done' &&
        calMinStop !== null &&
        targetSpeed > calMinStop &&
        this.tachSeen.has(fanKey) &&
        reportedFan?.rpm === 0
      ) {
        const ticks = (this.stallTicks.get(fanKey) ?? 0) + 1;
        this.stallTicks.set(fanKey, ticks);
        if (ticks >= STALL_DEBOUNCE_TICKS && !this.stalledFans.has(fanKey)) {
          this.stalledFans.add(fanKey);
          log.warn(
            `Fan ${fanName} on agent ${agentId} STALLED: commanded ${targetSpeed}% but RPM is 0`,
            'FanProfileController'
          );
          this.emit('fanStalled', { agentId, fanId: fanName, commandedSpeed: targetSpeed });
        }
      }

      // At target: re-assert only if the reported ACTUAL speed diverged past
      // tolerance - catches an external controller (e.g. RPi kernel thermal
      // governor) moving the fan out from under us. See REASSERT_TOLERANCE_PERCENT.
      const reported = reportedFan?.speed;
      if (reported === undefined ||
          Math.abs(reported - targetSpeed) <= REASSERT_TOLERANCE_PERCENT) {
        return; // in sync (or no telemetry yet) - nothing to do
      }
      nextSpeed = targetSpeed; // diverged - re-send the held target (no re-step)
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
    // Never start a new tick while the previous one is still running - once a
    // tick exceeds the interval under load, overlapping loops would stack and
    // saturate the DB pool and the single event loop.
    if (this.loopRunning) {
      log.trace('Control loop still running, skipping tick', 'FanProfileController');
      return;
    }
    this.loopRunning = true;
    try {
      // Get all active fan profile assignments
      const assignments = await this.getActiveFanAssignments();

      if (assignments.length === 0) {
        // No active assignments, nothing to do
        return;
      }

      // Fetch curve points for every assigned profile in one query rather than
      // one query per assignment (the old N+1: ~one query per fan each tick).
      // Rebuilt fresh every tick, so there is no cache to invalidate.
      const profileIds = [...new Set(assignments.map(a => a.profile_id))];
      const curvesByProfile = new Map<number, CurvePoint[]>();
      try {
        const rows = await this.db.all(`
          SELECT profile_id, temperature, fan_speed
          FROM fan_curve_points
          WHERE profile_id = ANY($1)
          ORDER BY point_order ASC
        `, [profileIds]);
        for (const row of rows) {
          let points = curvesByProfile.get(row.profile_id);
          if (!points) {
            points = [];
            curvesByProfile.set(row.profile_id, points);
          }
          points.push({ temperature: row.temperature, fan_speed: row.fan_speed });
        }
      } catch (error) {
        // On failure leave the map empty: each assignment then hits the existing
        // "no curve points -> skip with warning" path and fans hold their last
        // speed, self-healing next tick. Deliberately NOT falling back to
        // per-assignment queries - that would refire the N+1 into an
        // already-stressed pool.
        log.error('Error batch-fetching curve points', 'FanProfileController', error);
      }

      // Batch-load virtual sensor definitions referenced this tick (one query),
      // mirroring the curve-points batch above. Rebuilt fresh each tick.
      this.virtualDefs.clear();
      const virtualIds = [...new Set(
        assignments
          .map(a => a.sensor_identifier)
          .filter((sid): sid is string => !!sid && sid.startsWith('__virtual__'))
          .map(sid => parseInt(sid.slice('__virtual__'.length), 10))
          .filter(n => !isNaN(n))
      )];
      if (virtualIds.length > 0) {
        try {
          const rows = await this.db.all(`
            SELECT vs.id AS virtual_sensor_id, vs.operation,
                   ARRAY_AGG(vm.sensor_id) AS member_ids
            FROM virtual_sensors vs
            JOIN virtual_sensor_members vm ON vm.virtual_sensor_id = vs.id
            WHERE vs.id = ANY($1)
            GROUP BY vs.id, vs.operation
          `, [virtualIds]);
          for (const row of rows) {
            this.virtualDefs.set(row.virtual_sensor_id, {
              operation: row.operation === 'avg' || row.operation === 'median' ? row.operation : 'max',
              memberDbIds: (row.member_ids || []).map((n: any) => Number(n)),
            });
          }
        } catch (error) {
          // Leave virtualDefs empty on failure: affected assignments hit the existing
          // "sensor unavailable -> skip" path and fans hold their last speed.
          log.error('Error batch-fetching virtual sensor definitions', 'FanProfileController', error);
        }
      }

      // Zone deduplication: when multiple fans share a zone_id, only process once per zone.
      // The zone is the atomic control unit for IPMI agents - sending setFanSpeed to the zone
      // sets all member fans at once.
      const processedZones = new Set<string>();

      // Process each assignment
      for (const assignment of assignments) {
        try {
          // Zone deduplication: skip if we already processed this zone for this agent
          const zoneKey = assignment.zone_id ? `${assignment.agent_id}:zone:${assignment.zone_id}` : null;
          if (zoneKey && processedZones.has(zoneKey)) {
            log.trace(`Zone ${assignment.zone_id} already processed for agent ${assignment.agent_id}, skipping fan ${assignment.fan_name}`, 'FanProfileController');
            continue;
          }

          // For zone-based fans, use zone_id as the command target; otherwise use fan_name
          const commandTarget = assignment.zone_id || assignment.fan_name;

          // Skip fans locked by an active calibration run
          if (this.calibratingFans.has(`${assignment.agent_id}:${commandTarget}`) ||
              this.calibratingFans.has(`${assignment.agent_id}:${assignment.fan_name}`)) {
            log.trace(`Fan ${commandTarget} on ${assignment.agent_id} is calibrating, skipping`, 'FanProfileController');
            continue;
          }

          // Check if fan is currently reported by the agent (immediate availability check)
          const systemData = this.dataAggregator.getSystemData(assignment.agent_id);
          const fanCurrentlyReported = systemData?.fans?.some(f => f.id === assignment.fan_name);
          if (!fanCurrentlyReported) {
            log.trace(`Fan ${assignment.fan_name} not in current data for agent ${assignment.agent_id}, skipping`, 'FanProfileController');
            continue;
          }

          // Consent-gated calibration trigger: an active assignment IS
          // the user's consent to control this fan. Emitted only for fans in
          // LIVE telemetry (guard above) - DB 'online' status is stale at boot
          // and triggering into a not-yet-connected agent poisons statuses.
          // Enqueue when calibration is missing, pending, or from an older
          // protocol version; 'failed' rows get ONE automatic retry per
          // protocol bump (version stamp), then manual-only.
          // Control continues below (pass-through) until the run locks the fan.
          const needsCalibration =
            assignment.cal_status === null ||
            assignment.cal_status === 'pending' ||
            (assignment.cal_status !== 'running' &&
              (assignment.cal_version ?? 0) < CALIBRATION_VERSION);
          if (needsCalibration) {
            this.emit('calibrationNeeded', {
              agentId: assignment.agent_id,
              fanDbId: assignment.fan_id,
              fanName: assignment.fan_name,
            });
          }

          // Get current sensor temperature
          const temperature = this.getSensorTemperature(
            assignment.agent_id,
            assignment.sensor_id,
            assignment.sensor_identifier
          );

          // Track sensor availability state to avoid log spam
          const stateKey = `${assignment.agent_id}:${assignment.sensor_name || assignment.sensor_identifier || assignment.sensor_id}:${commandTarget}`;
          const wasAvailable = this.sensorAvailabilityState.get(stateKey);

          if (temperature === null) {
            // Only log when sensor becomes unavailable (state change)
            if (wasAvailable !== false) {
              log.warn(
                `Sensor ${assignment.sensor_name || assignment.sensor_identifier || assignment.sensor_id} unavailable, ` +
                `skipping fan ${commandTarget}`,
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
              `resuming fan ${commandTarget}`,
              'FanProfileController'
            );
          }
          this.sensorAvailabilityState.set(stateKey, true);

          // Get fan profile curve points (from the per-tick batch fetched above)
          const curvePoints = curvesByProfile.get(assignment.profile_id) ?? [];

          if (curvePoints.length === 0) {
            log.warn(
              `No curve points for profile ${assignment.profile_name}, ` +
              `skipping fan ${commandTarget}`,
              'FanProfileController'
            );
            continue;
          }

          // Determine temperature to use for target calculation (hysteresis logic)
          const fanKey = `${assignment.agent_id}:${commandTarget}`;
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

          // Zero-snap dead-zone targets for calibrated fans (no-op otherwise)
          const snappedSpeed = this.applyZeroSnap(
            fanKey,
            assignment.agent_id,
            commandTarget,
            constrainedSpeed,
            assignment.cal_status,
            assignment.cal_min_start
          );

          // Apply fan control with stepping (hysteresis already handled above)
          // Use commandTarget (zone_id for IPMI, fan_name for OS agents)
          await this.applyFanControl(
            assignment.agent_id,
            commandTarget,
            temperature,
            snappedSpeed,
            assignment.cal_status,
            assignment.cal_min_start,
            assignment.cal_min_stop
          );

          // Mark zone as processed so we don't send duplicate commands
          if (zoneKey) {
            processedZones.add(zoneKey);
          }

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
    } finally {
      // Always release the guard, even on throw, so a failed tick can never
      // freeze fan control permanently.
      this.loopRunning = false;
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

  /**
   * Clear cached hysteresis/stepping state for a fan when assignment changes
   * This forces recalculation of the TARGET speed on the next control loop iteration
   * Note: We preserve lastAppliedSpeeds so stepping continues smoothly from current position
   */
  public clearFanState(agentId: string, fanName: string): void {
    // Only clear target calculation state - NOT the current speed state
    // This ensures stepping continues from current position toward new target
    // Intentionally NOT clearing:
    // - lastAppliedSpeeds (current fan speed - needed for smooth stepping)
    // - lastSpeedChangeTime (timing info - harmless to keep)
    this.clearTargetState(agentId, fanName);
    log.info(`Cleared target state for fan ${fanName} on agent ${agentId} (current speed preserved)`, 'FanProfileController');
  }

  /** Shared target-state clearing (no logging - callers log their own intent). */
  private clearTargetState(agentId: string, fanName: string): void {
    const fanKey = `${agentId}:${fanName}`;
    this.lastSignificantTemp.delete(fanKey);
    this.lastTargetSpeeds.delete(fanKey);
    this.sensorAvailabilityState.delete(fanKey);
    this.emergencyState.delete(fanKey);
    this.clearSnapAndStallState(fanKey, agentId, fanName);
  }

  /**
   * Clear ALL fan state for a specific agent (used on reconnection).
   * Unlike clearFanState() which preserves lastAppliedSpeeds for smooth stepping,
   * this clears everything - after reconnection the fan is likely at failsafe speed
   * and the controller must reinitialize from scratch.
   */
  private clearFanStateForAgent(agentId: string): void {
    const prefix = `${agentId}:`;
    let cleared = 0;

    for (const key of this.lastAppliedSpeeds.keys()) {
      if (key.startsWith(prefix)) {
        this.lastAppliedSpeeds.delete(key);
        this.lastSignificantTemp.delete(key);
        this.lastTargetSpeeds.delete(key);
        this.lastSpeedChangeTime.delete(key);
        this.emergencyState.delete(key);
        this.sensorAvailabilityState.delete(key);
        this.clearSnapAndStallState(key, agentId, key.slice(prefix.length));
        cleared++;
      }
    }

    if (cleared > 0) {
      log.info(`Cleared all fan state for reconnected agent ${agentId} (${cleared} fans reset)`, 'FanProfileController');
    }
  }

  /**
   * Drop zero-snap + stall watchdog state for one fan. Snap state reseeds from
   * reported RPM on the next tick; a lingering stall flag is cleared honestly
   * (with event) so the frontend never shows a stale stall.
   */
  private clearSnapAndStallState(fanKey: string, agentId: string, fanName: string): void {
    this.snapState.delete(fanKey);
    this.stallTicks.delete(fanKey);
    this.tachSeen.delete(fanKey);
    if (this.stalledFans.delete(fanKey)) {
      this.emit('fanStallCleared', { agentId, fanId: fanName });
    }
  }

  /**
   * Currently stalled fans (fanKey = "agentId:fanName"). For fullState
   * enrichment when the frontend consumes stall events.
   */
  public getStalledFans(): string[] {
    return [...this.stalledFans];
  }

  /**
   * Lock/unlock a fan for calibration. Locked fans are skipped by
   * the control loop; CalibrationService owns them for the duration.
   */
  public setFanCalibrating(agentId: string, fanName: string, calibrating: boolean): void {
    const fanKey = `${agentId}:${fanName}`;
    if (calibrating) this.calibratingFans.add(fanKey);
    else this.calibratingFans.delete(fanKey);
  }

  /**
   * Full per-fan reset (including current-speed record) for the handoff after
   * calibration: the next tick reseeds from the agent's reported speed.
   * Debug-level on purpose - fleet-wide calibration waves call this per fan.
   */
  public resetFanControlState(agentId: string, fanName: string): void {
    const fanKey = `${agentId}:${fanName}`;
    this.lastAppliedSpeeds.delete(fanKey);
    this.lastSpeedChangeTime.delete(fanKey);
    this.clearTargetState(agentId, fanName);
    log.debug(`Reset control state for fan ${fanName} on agent ${agentId} (reseeds from reported speed)`, 'FanProfileController');
  }
}
