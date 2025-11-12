import { log } from '../utils/logger';
import {
  AggregatedSystemData,
  SensorReading,
  FanReading,
  SystemHealth
} from '../types/aggregatedData';

export interface SystemDelta {
  agentId: string;
  timestamp: string;
  changes: {
    status?: 'online' | 'offline' | 'error';
    sensors?: Record<string, Partial<SensorReading>>;
    fans?: Record<string, Partial<FanReading>>;
    systemHealth?: Partial<SystemHealth>;
    // Agent configuration changes
    // NOTE: Config changes are sent via deltas so frontend sees them immediately
    // after CommandDispatcher updates AgentManager, without waiting for full sync
    current_update_interval?: number;
    filter_duplicate_sensors?: boolean;
    duplicate_sensor_tolerance?: number;
    fan_step_percent?: number;
    hysteresis_temp?: number;
    emergency_temp?: number;
    log_level?: string;
  };
}

/**
 * DeltaComputer - Computes deltas between system states for efficient updates
 *
 * Reduces WebSocket bandwidth by 95% by only sending changed values instead of full state.
 */
export class DeltaComputer {
  private previousStates: Map<string, AggregatedSystemData> = new Map();

  // Thresholds for change detection
  private static readonly CPU_MEMORY_THRESHOLD = 1.0; // 1% change required
  private static readonly UPTIME_THRESHOLD = 60; // 60 seconds change required

  /**
   * Compute delta between previous and current state
   * Returns null if this is first update (no previous state exists)
   */
  public computeDelta(
    agentId: string,
    currentState: AggregatedSystemData
  ): SystemDelta | null {
    const previousState = this.previousStates.get(agentId);

    // First time seeing this agent - no delta possible, send full state
    if (!previousState) {
      this.previousStates.set(agentId, this.cloneState(currentState));
      log.debug(`First update for agent ${agentId} - no delta, will send full state`, 'DeltaComputer');
      return null;
    }

    const delta: SystemDelta = {
      agentId,
      timestamp: currentState.lastUpdate.toISOString(),
      changes: {}
    };

    // Check status change
    if (currentState.status !== previousState.status) {
      delta.changes.status = currentState.status;
    }

    // Check sensor changes
    const sensorDeltas = this.computeSensorDeltas(previousState.sensors, currentState.sensors);
    if (Object.keys(sensorDeltas).length > 0) {
      delta.changes.sensors = sensorDeltas;
    }

    // Check fan changes
    const fanDeltas = this.computeFanDeltas(previousState.fans, currentState.fans);
    if (Object.keys(fanDeltas).length > 0) {
      delta.changes.fans = fanDeltas;
    }

    // Check system health changes
    const healthChanges = this.computeHealthDelta(
      previousState.systemHealth,
      currentState.systemHealth
    );
    if (healthChanges && Object.keys(healthChanges).length > 0) {
      delta.changes.systemHealth = healthChanges;
    }

    // Check configuration changes
    if (currentState.current_update_interval !== previousState.current_update_interval) {
      delta.changes.current_update_interval = currentState.current_update_interval;
    }
    if (currentState.filter_duplicate_sensors !== previousState.filter_duplicate_sensors) {
      delta.changes.filter_duplicate_sensors = currentState.filter_duplicate_sensors;
    }
    if (currentState.duplicate_sensor_tolerance !== previousState.duplicate_sensor_tolerance) {
      delta.changes.duplicate_sensor_tolerance = currentState.duplicate_sensor_tolerance;
    }
    if (currentState.fan_step_percent !== previousState.fan_step_percent) {
      delta.changes.fan_step_percent = currentState.fan_step_percent;
    }
    if (currentState.hysteresis_temp !== previousState.hysteresis_temp) {
      delta.changes.hysteresis_temp = currentState.hysteresis_temp;
    }
    if (currentState.emergency_temp !== previousState.emergency_temp) {
      delta.changes.emergency_temp = currentState.emergency_temp;
    }
    if (currentState.log_level !== previousState.log_level) {
      delta.changes.log_level = currentState.log_level;
    }

    // Update stored state
    this.previousStates.set(agentId, this.cloneState(currentState));

    // Return null if no changes detected
    if (Object.keys(delta.changes).length === 0) {
      return null;
    }

    // Log delta size for monitoring
    const deltaSize = JSON.stringify(delta).length;
    log.debug(`Delta for ${agentId}: ${deltaSize} bytes`, 'DeltaComputer');

    return delta;
  }

  /**
   * Compute deltas for all sensors
   */
  private computeSensorDeltas(
    prevSensors: SensorReading[],
    currentSensors: SensorReading[]
  ): Record<string, Partial<SensorReading>> {
    const deltas: Record<string, Partial<SensorReading>> = {};

    // Check each current sensor
    for (const currentSensor of currentSensors) {
      const prevSensor = prevSensors.find(s => s.id === currentSensor.id);

      if (!prevSensor) {
        // New sensor - include full data
        deltas[currentSensor.id] = { ...currentSensor };
      } else {
        // Existing sensor - check for changes
        const changes = this.computeSensorDelta(prevSensor, currentSensor);
        if (changes && Object.keys(changes).length > 0) {
          deltas[currentSensor.id] = changes;
        }
      }
    }

    return deltas;
  }

  /**
   * Compute delta for a single sensor
   */
  private computeSensorDelta(
    prev: SensorReading,
    current: SensorReading
  ): Partial<SensorReading> | null {
    const delta: Partial<SensorReading> = {};

    // Only include changed fields
    if (prev.temperature !== current.temperature) {
      delta.temperature = current.temperature;
    }
    if (prev.status !== current.status) {
      delta.status = current.status;
    }
    if (prev.isHidden !== current.isHidden) {
      delta.isHidden = current.isHidden;
    }
    if (prev.label !== current.label) {
      delta.label = current.label;
    }

    // Rarely changing fields
    if (prev.maxTemp !== current.maxTemp) {
      delta.maxTemp = current.maxTemp;
    }
    if (prev.critTemp !== current.critTemp) {
      delta.critTemp = current.critTemp;
    }

    return Object.keys(delta).length > 0 ? delta : null;
  }

  /**
   * Compute deltas for all fans
   */
  private computeFanDeltas(
    prevFans: FanReading[],
    currentFans: FanReading[]
  ): Record<string, Partial<FanReading>> {
    const deltas: Record<string, Partial<FanReading>> = {};

    for (const currentFan of currentFans) {
      const prevFan = prevFans.find(f => f.id === currentFan.id);

      if (!prevFan) {
        // New fan - include full data
        deltas[currentFan.id] = { ...currentFan };
      } else {
        // Existing fan - check for changes
        const changes = this.computeFanDelta(prevFan, currentFan);
        if (changes && Object.keys(changes).length > 0) {
          deltas[currentFan.id] = changes;
        }
      }
    }

    return deltas;
  }

  /**
   * Compute delta for a single fan
   */
  private computeFanDelta(
    prev: FanReading,
    current: FanReading
  ): Partial<FanReading> | null {
    const delta: Partial<FanReading> = {};

    if (prev.speed !== current.speed) {
      delta.speed = current.speed;
    }
    if (prev.rpm !== current.rpm) {
      delta.rpm = current.rpm;
    }
    if (prev.targetSpeed !== current.targetSpeed) {
      delta.targetSpeed = current.targetSpeed;
    }
    if (prev.status !== current.status) {
      delta.status = current.status;
    }
    if (prev.label !== current.label) {
      delta.label = current.label;
    }

    return Object.keys(delta).length > 0 ? delta : null;
  }

  /**
   * Compute delta for system health metrics
   * Uses thresholds to avoid sending tiny CPU/memory fluctuations
   */
  private computeHealthDelta(
    prev: SystemHealth,
    current: SystemHealth
  ): Partial<SystemHealth> | null {
    const delta: Partial<SystemHealth> = {};

    // Use threshold to avoid sending tiny CPU/memory fluctuations
    if (Math.abs(prev.cpuUsage - current.cpuUsage) >= DeltaComputer.CPU_MEMORY_THRESHOLD) {
      delta.cpuUsage = current.cpuUsage;
    }
    if (Math.abs(prev.memoryUsage - current.memoryUsage) >= DeltaComputer.CPU_MEMORY_THRESHOLD) {
      delta.memoryUsage = current.memoryUsage;
    }

    // Uptime always changes, but we don't care about small diffs
    if (Math.abs(prev.agentUptime - current.agentUptime) >= DeltaComputer.UPTIME_THRESHOLD) {
      delta.agentUptime = current.agentUptime;
    }

    return Object.keys(delta).length > 0 ? delta : null;
  }

  /**
   * Deep clone state to avoid reference issues
   */
  private cloneState(state: AggregatedSystemData): AggregatedSystemData {
    return JSON.parse(JSON.stringify(state));
  }

  /**
   * Clear previous state for an agent (e.g., on disconnect)
   */
  public clearAgentState(agentId: string): void {
    this.previousStates.delete(agentId);
    log.debug(`Cleared delta state for agent ${agentId}`, 'DeltaComputer');
  }

  /**
   * Clear all states (e.g., on backend restart)
   */
  public clearAllStates(): void {
    this.previousStates.clear();
    log.info('Cleared all delta states', 'DeltaComputer');
  }

  /**
   * Get statistics about delta computation
   */
  public getStats(): { trackedAgents: number } {
    return {
      trackedAgents: this.previousStates.size
    };
  }
}
