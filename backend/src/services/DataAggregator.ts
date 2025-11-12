import { EventEmitter } from 'events';
import Database from '../database/database';
import { AgentDataPacket, SensorInfo, FanInfo } from '../types/agent';
import { AggregatedSystemData } from '../types/aggregatedData';
import { AgentManager } from './AgentManager';
import { log } from '../utils/logger';
// Removed AgentCommunication import to prevent circular dependency

// Data buffer for aggregation
interface DataPoint {
  temperature?: number;
  speed?: number;
  rpm?: number;
  timestamp: Date;
}

interface SystemDataBuffer {
  sensors: Map<number, DataPoint[]>;  // sensor_id -> data points
  fans: Map<number, DataPoint[]>;     // fan_id -> data points
  lastFlush: Date;
}

export class DataAggregator extends EventEmitter {
  private static instance: DataAggregator;
  private db: Database;
  private agentManager: AgentManager;
  private aggregatedData: Map<string, AggregatedSystemData> = new Map();
  private dataRetentionInterval: NodeJS.Timeout | null = null;
  private dataRetentionDays: number; // Configurable via DATA_RETENTION_DAYS env var

  // Data aggregation system - raw data to dashboard, aggregated averages to DB
  private dataBuffer: Map<number, SystemDataBuffer> = new Map();  // system_id -> buffer
  private aggregationInterval: NodeJS.Timeout | null = null;
  private aggregationIntervalMinutes: number; // Configurable via DATA_AGGREGATION_INTERVAL_MINUTES env var

  private constructor() {
    super();
    this.db = Database.getInstance();
    this.agentManager = AgentManager.getInstance();

    // Read configuration from environment variables with defaults
    this.dataRetentionDays = parseInt(process.env.DATA_RETENTION_DAYS || '30', 10);
    this.aggregationIntervalMinutes = parseInt(process.env.DATA_AGGREGATION_INTERVAL_MINUTES || '5', 10);

    log.info(`[DataAggregator] Configuration:
  - Retention: ${this.dataRetentionDays} days
  - Aggregation interval: ${this.aggregationIntervalMinutes} minutes
  - Raw data: Sent to dashboard in real-time
  - Stored data: ${this.aggregationIntervalMinutes}-minute averages only`, 'DataAggregator');

    this.setupEventListeners();
    this.startDataRetentionCleanup();
    this.startDataAggregation();
  }

  public static getInstance(): DataAggregator {
    if (!DataAggregator.instance) {
      DataAggregator.instance = new DataAggregator();
    }
    return DataAggregator.instance;
  }

  /**
   * Setup event listeners for agent data
   */
  private setupEventListeners(): void {
    // AgentCommunication import removed to prevent circular dependency
    // Data is now received via direct method call: updateSystemData()
    // this.agentCommunication.on('agentData', this.handleAgentData.bind(this));
    this.agentManager.on('agentOffline', this.handleAgentOffline.bind(this));
  }

  /**
   * Handle incoming agent data
   */
  private async handleAgentData(event: { agentId: string; data: AgentDataPacket }): Promise<void> {
    const { agentId, data } = event;
    
    try {
      // Get system info from database
      const system = await this.db.get(
        'SELECT id, name, status FROM systems WHERE agent_id = $1',
        [agentId]
      );

      if (!system) {
        log.warn(`Received data from unknown agent: ${agentId}`, 'DataAggregator');
        return;
      }

      // Buffer data points for aggregation (raw data still sent to dashboard)
      await this.bufferDataPoints(system.id, data);

      // Update sensors with current readings
      await this.updateSensorReadings(system.id, data.sensors);

      // Update fan speeds and RPMs
      await this.updateFanReadings(system.id, data.fans);

      // Create aggregated data structure
      const aggregatedData: AggregatedSystemData = {
        systemId: system.id,
        agentId: agentId,
        systemName: system.name,
        status: 'online',
        lastUpdate: new Date(data.timestamp),
        sensors: data.sensors.map(sensor => ({
          id: sensor.id,
          name: sensor.id, // We'll get the proper name from DB if needed
          label: sensor.id,
          type: 'unknown', // We'll get the proper type from DB if needed
          temperature: sensor.temperature,
          status: sensor.status || 'ok',
          maxTemp: sensor.max_temp,
          critTemp: sensor.crit_temp
        })),
        fans: data.fans.map(fan => ({
          id: fan.id,
          name: fan.id,
          label: fan.id,
          speed: fan.speed,
          rpm: fan.rpm,
          targetSpeed: fan.targetSpeed,
          status: fan.status
        })),
        systemHealth: data.systemHealth
      };

      // Enrich with database information
      await this.enrichAggregatedData(aggregatedData);

      // Store in memory for quick access
      this.aggregatedData.set(agentId, aggregatedData);

      // Emit aggregated data event
      this.emit('dataAggregated', aggregatedData);

      log.info(`[DataAggregator] Data aggregated for system: ${system.name} (${agentId})`, 'DataAggregator');

    } catch (error) {
      log.error(`Failed to aggregate data for agent`, 'DataAggregator', { agentId, error });
    }
  }

  /**
   * Handle agent going offline
   */
  private handleAgentOffline(event: { agentId: string }): void {
    const { agentId } = event;
    const data = this.aggregatedData.get(agentId);
    
    if (data) {
      data.status = 'offline';
      data.lastUpdate = new Date();
      
      // Clear temperature data when agent goes offline
      data.sensors = data.sensors.map(sensor => ({
        ...sensor,
        temperature: 0,
        status: 'ok' as const
      }));
      
      // Clear fan data when agent goes offline
      data.fans = data.fans.map(fan => ({
        ...fan,
        speed: 0,
        rpm: 0,
        targetSpeed: 0,
        status: 'ok' as const
      }));
      
      // Reset system health data
      data.systemHealth = {
        cpuUsage: 0,
        memoryUsage: 0,
        agentUptime: 0
      };
      
      this.aggregatedData.set(agentId, data);
      this.emit('systemOffline', data);
      log.info(`[DataAggregator] Cleared sensor and fan data for offline agent: ${agentId}`, 'DataAggregator');
    }
  }

  /**
   * Ensure sensors exist in database (create if missing)
   */
  private async ensureSensorsExist(systemId: number, sensors: AgentDataPacket['sensors']): Promise<void> {
    if (!sensors || sensors.length === 0) return;

    for (const sensor of sensors) {
      const existing = await this.db.get(
        'SELECT id FROM sensors WHERE system_id = $1 AND sensor_name = $2',
        [systemId, sensor.id]
      );

      if (!existing) {
        // Create new sensor record
        await this.db.run(
          `INSERT INTO sensors (
            system_id, sensor_name, sensor_label, sensor_type, sensor_chip,
            temp_max, temp_crit, is_available
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
          [
            systemId,
            sensor.id,
            sensor.id,
            sensor.type || 'unknown',
            'unknown',
            sensor.max_temp || null,
            sensor.crit_temp || null
          ]
        );
        log.info(`Created sensor record: ${sensor.id}`, 'DataAggregator');
      }
    }
  }

  /**
   * Ensure fans exist in database (create if missing)
   */
  private async ensureFansExist(systemId: number, fans: AgentDataPacket['fans']): Promise<void> {
    if (!fans || fans.length === 0) return;

    for (const fan of fans) {
      const existing = await this.db.get(
        'SELECT id FROM fans WHERE system_id = $1 AND fan_name = $2',
        [systemId, fan.id]
      );

      if (!existing) {
        // Create new fan record
        await this.db.run(
          `INSERT INTO fans (
            system_id, fan_name, fan_label, is_controllable
          ) VALUES ($1, $2, $3, true)`,
          [
            systemId,
            fan.id,
            fan.id
          ]
        );
        log.info(`Created fan record: ${fan.id}`, 'DataAggregator');
      }
    }
  }

  /**
   * Buffer data points for later aggregation (instead of immediate storage)
   * Dashboard gets raw data in real-time, only aggregated averages are stored to DB
   */
  private async bufferDataPoints(systemId: number, data: AgentDataPacket): Promise<void> {
    const timestamp = new Date(data.timestamp);

    // Initialize buffer for system if it doesn't exist
    if (!this.dataBuffer.has(systemId)) {
      this.dataBuffer.set(systemId, {
        sensors: new Map(),
        fans: new Map(),
        lastFlush: new Date()
      });
    }

    const buffer = this.dataBuffer.get(systemId)!;

    // Buffer sensor data points
    for (const sensor of data.sensors) {
      const sensorRecord = await this.db.get(
        'SELECT id FROM sensors WHERE system_id = $1 AND sensor_name = $2',
        [systemId, sensor.id]
      );

      if (sensorRecord) {
        if (!buffer.sensors.has(sensorRecord.id)) {
          buffer.sensors.set(sensorRecord.id, []);
        }

        buffer.sensors.get(sensorRecord.id)!.push({
          temperature: sensor.temperature,
          timestamp: timestamp
        });
      }
    }

    // Buffer fan data points
    for (const fan of data.fans) {
      const fanRecord = await this.db.get(
        'SELECT id FROM fans WHERE system_id = $1 AND fan_name = $2',
        [systemId, fan.id]
      );

      if (fanRecord) {
        if (!buffer.fans.has(fanRecord.id)) {
          buffer.fans.set(fanRecord.id, []);
        }

        buffer.fans.get(fanRecord.id)!.push({
          speed: fan.speed,
          rpm: fan.rpm,
          timestamp: timestamp
        });
      }
    }
  }

  /**
   * Start periodic data aggregation timer
   * Flushes buffered data points as averages to database
   */
  private startDataAggregation(): void {
    const intervalMs = this.aggregationIntervalMinutes * 60 * 1000;

    this.aggregationInterval = setInterval(() => {
      this.flushAggregatedData();
    }, intervalMs);

    log.info(`[DataAggregator] Started periodic aggregation: ${this.aggregationIntervalMinutes}-minute intervals`, 'DataAggregator');
  }

  /**
   * Flush buffered data points to database as aggregated averages
   * Called every N minutes (configurable via DATA_AGGREGATION_INTERVAL_MINUTES)
   */
  private async flushAggregatedData(): Promise<void> {
    try {
      const now = new Date();
      let totalPointsFlushed = 0;
      let totalAggregatesStored = 0;

      for (const [systemId, buffer] of this.dataBuffer.entries()) {
        // Calculate and store aggregated sensor data
        for (const [sensorId, dataPoints] of buffer.sensors.entries()) {
          if (dataPoints.length === 0) continue;

          // Calculate average temperature
          const avgTemp = dataPoints.reduce((sum, p) => sum + (p.temperature || 0), 0) / dataPoints.length;

          // Store aggregated average to database
          await this.db.run(
            'INSERT INTO monitoring_data (system_id, sensor_id, temperature, timestamp) VALUES ($1, $2, $3, $4)',
            [systemId, sensorId, avgTemp, now.toISOString()]
          );

          totalPointsFlushed += dataPoints.length;
          totalAggregatesStored++;
        }

        // Calculate and store aggregated fan data
        for (const [fanId, dataPoints] of buffer.fans.entries()) {
          if (dataPoints.length === 0) continue;

          // Calculate average speed and RPM (rounded to integers for database)
          const avgSpeed = Math.round(dataPoints.reduce((sum, p) => sum + (p.speed || 0), 0) / dataPoints.length);
          const avgRpm = Math.round(dataPoints.reduce((sum, p) => sum + (p.rpm || 0), 0) / dataPoints.length);

          // Store aggregated average to database
          await this.db.run(
            'INSERT INTO monitoring_data (system_id, fan_id, fan_speed, fan_rpm, timestamp) VALUES ($1, $2, $3, $4, $5)',
            [systemId, fanId, avgSpeed, avgRpm, now.toISOString()]
          );

          totalPointsFlushed += dataPoints.length;
          totalAggregatesStored++;
        }

        // Clear buffer after flushing
        buffer.sensors.clear();
        buffer.fans.clear();
        buffer.lastFlush = now;
      }

      if (totalAggregatesStored > 0) {
        log.info(`[DataAggregator] Flushed ${totalPointsFlushed} raw data points -> ${totalAggregatesStored} aggregated averages to DB`, 'DataAggregator');
      }

    } catch (error) {
      log.error('Error flushing aggregated data:', 'DataAggregator', error);
    }
  }

  /**
   * Update sensor readings in database
   */
  private async updateSensorReadings(systemId: number, sensors: AgentDataPacket['sensors']): Promise<void> {
    for (const sensor of sensors) {
      await this.db.run(
        'UPDATE sensors SET current_temp = $1, last_reading = CURRENT_TIMESTAMP WHERE system_id = $2 AND sensor_name = $3',
        [sensor.temperature, systemId, sensor.id]
      );
    }
  }

  /**
   * Update fan readings in database
   */
  private async updateFanReadings(systemId: number, fans: AgentDataPacket['fans']): Promise<void> {
    for (const fan of fans) {
      await this.db.run(
        'UPDATE fans SET current_speed = $1, current_rpm = $2, last_command = CURRENT_TIMESTAMP WHERE system_id = $3 AND fan_name = $4',
        [fan.speed, fan.rpm, systemId, fan.id]
      );
    }
  }

  /**
   * Enrich aggregated data with database information
   */
  private async enrichAggregatedData(data: AggregatedSystemData): Promise<void> {
    // Get hidden sensor groups for this system
    const hiddenGroups = await this.db.all(
      'SELECT group_name FROM sensor_group_visibility WHERE system_id = $1 AND is_hidden = true',
      [data.systemId]
    );
    const hiddenGroupNames = new Set(hiddenGroups.map(g => g.group_name));

    // Enrich sensor data
    for (const sensor of data.sensors) {
      const sensorInfo = await this.db.get(
        'SELECT id, sensor_label, sensor_type, temp_max, temp_crit, is_hidden FROM sensors WHERE system_id = $1 AND sensor_name = $2',
        [data.systemId, sensor.id]
      );

      if (sensorInfo) {
        sensor.dbId = sensorInfo.id; // Database record ID for fan_profile_assignments
        sensor.name = sensorInfo.sensor_label || sensor.id;
        sensor.label = sensorInfo.sensor_label || sensor.id;
        sensor.type = sensorInfo.sensor_type || 'unknown';
        sensor.maxTemp = sensorInfo.temp_max;
        sensor.critTemp = sensorInfo.temp_crit;

        // Check if individually hidden OR part of hidden group
        let isHidden = sensorInfo.is_hidden || false;

        if (!isHidden) {
          // Check if part of hidden group
          const chipMatch = sensor.id.match(/^([a-z0-9_]+?)_\d+$/i);
          const chipName = chipMatch ? chipMatch[1] : sensor.id.split('_')[0];
          isHidden = hiddenGroupNames.has(chipName);
        }

        sensor.isHidden = isHidden;
      }
    }

    // Enrich fan data
    for (const fan of data.fans) {
      const fanInfo = await this.db.get(
        'SELECT id, fan_label, target_speed FROM fans WHERE system_id = $1 AND fan_name = $2',
        [data.systemId, fan.id]
      );

      if (fanInfo) {
        fan.dbId = fanInfo.id; // Database record ID for fan_profile_assignments
        log.info(`[DataAggregator] Enriched fan ${fan.id} with dbId: ${fanInfo.id}`, 'DataAggregator');
        fan.name = fanInfo.fan_label || fan.id;
        fan.label = fanInfo.fan_label || fan.id;
        if (fanInfo.target_speed !== null) {
          fan.targetSpeed = fanInfo.target_speed;
        }
      } else {
        log.warn(`[DataAggregator] No fan info found for fan ${fan.id} in system ${data.systemId}`, 'DataAggregator');
      }
    }
  }

  /**
   * Get systems from database (for WebSocket fullState)
   */
  public async getAllSystems(): Promise<any[]> {
    const systems = await this.db.all(`
      SELECT
        s.*,
        COUNT(DISTINCT sen.id) as sensor_count,
        COUNT(DISTINCT f.id) as fan_count
      FROM systems s
      LEFT JOIN sensors sen ON s.id = sen.system_id
      LEFT JOIN fans f ON s.id = f.system_id
      GROUP BY s.id
      ORDER BY s.name
    `);
    return systems;
  }

  /**
   * Get aggregated data for all systems (real-time data only)
   */
  public getAllSystemsData(): AggregatedSystemData[] {
    return Array.from(this.aggregatedData.values());
  }

  /**
   * Get aggregated data for specific system (real-time data only)
   */
  public getSystemData(agentId: string): AggregatedSystemData | undefined {
    return this.aggregatedData.get(agentId);
  }

  /**
   * Update system data from agent data packet
   */
  public async updateSystemData(agentId: string, dataPacket: AgentDataPacket): Promise<void> {
    try {
      log.info(`[DataAggregator] Updating system data for ${agentId}`, 'DataAggregator');

      // Get system info from database
      const system = await this.db.get('SELECT * FROM systems WHERE agent_id = $1', [agentId]);
      if (!system) {
        log.warn(`System not found for agent ${agentId}`, 'DataAggregator');
        return;
      }

      // Process sensor data
      const sensors = dataPacket.sensors?.map(sensor => {
        const temp = sensor.temperature;
        const critTemp = sensor.crit_temp || 95;
        
        // Calculate status on server from raw temperature data
        let status: 'ok' | 'caution' | 'warning' | 'critical';
        if (temp >= critTemp) {
          status = 'critical';
        } else if (temp >= 70) {
          status = 'warning';
        } else if (temp >= 60) {
          status = 'caution';
        } else {
          status = 'ok';
        }
        
        return {
          id: sensor.id,
          name: sensor.id,
          label: sensor.id,
          type: sensor.type || 'unknown',
          temperature: temp,
          status: status,
          maxTemp: sensor.max_temp,
          critTemp: sensor.crit_temp
        };
      }) || [];

      // Process fan data
      const fans = dataPacket.fans?.map(fan => ({
        id: fan.id,
        name: fan.id,
        label: fan.id,
        speed: fan.speed,
        rpm: fan.rpm,
        targetSpeed: fan.targetSpeed,
        status: fan.status === 'error' ? 'error' as const : (fan.status === 'stopped' ? 'stopped' as const : 'ok' as const)
      })) || [];

      // Update aggregated data
      const aggregatedData: AggregatedSystemData = {
        systemId: system.id,
        agentId: agentId,
        systemName: system.name,
        status: 'online',
        lastUpdate: new Date(),
        sensors: sensors,
        fans: fans,
        systemHealth: {
          cpuUsage: dataPacket.systemHealth?.cpuUsage || 0,
          memoryUsage: dataPacket.systemHealth?.memoryUsage || 0,
          agentUptime: dataPacket.systemHealth?.agentUptime || 0
        },
        // Agent configuration from AgentManager
        // NOTE: These values are included so DeltaComputer can detect config changes
        // and send delta updates when user modifies settings via GUI
        current_update_interval: this.agentManager.getAgentUpdateInterval(agentId),
        filter_duplicate_sensors: this.agentManager.getAgentSensorDeduplication(agentId),
        duplicate_sensor_tolerance: this.agentManager.getAgentSensorTolerance(agentId),
        fan_step_percent: this.agentManager.getAgentFanStep(agentId),
        hysteresis_temp: this.agentManager.getAgentHysteresis(agentId),
        emergency_temp: this.agentManager.getAgentEmergencyTemp(agentId),
        log_level: this.agentManager.getAgentLogLevel(agentId)
      };

      // Enrich with database information (adds dbId, isHidden flag to sensors)
      await this.enrichAggregatedData(aggregatedData);

      this.aggregatedData.set(agentId, aggregatedData);
      log.info(`[DataAggregator] Updated aggregated data for ${agentId}: ${sensors.length} sensors, ${fans.length} fans`, 'DataAggregator');

      // Persist data to PostgreSQL
      try {
        // First ensure sensors and fans exist in database
        await this.ensureSensorsExist(system.id, dataPacket.sensors);
        await this.ensureFansExist(system.id, dataPacket.fans);

        // Buffer data points for aggregation (raw data still sent to dashboard)
        await this.bufferDataPoints(system.id, dataPacket);

        // Update current sensor readings
        await this.updateSensorReadings(system.id, dataPacket.sensors);

        // Update current fan readings
        await this.updateFanReadings(system.id, dataPacket.fans);

        log.info(`Persisted data to PostgreSQL for ${agentId}`, 'DataAggregator');
      } catch (dbError) {
        log.error(`Failed to persist data to PostgreSQL`, 'DataAggregator', { agentId, error: dbError });
      }

      // Emit event for real-time updates
      this.emit('dataAggregated', aggregatedData);

    } catch (error) {
      log.error(`Failed to update system data`, 'DataAggregator', { agentId, error });
    }
  }

  /**
   * Remove system from aggregated data cache
   */
  public removeSystemData(agentId: string): void {
    this.aggregatedData.delete(agentId);
    log.info(`[DataAggregator] Removed system data from cache: ${agentId}`, 'DataAggregator');
  }

  /**
   * Get historical data for a system
   */
  public async getHistoricalData(
    systemId: number, 
    startTime: Date, 
    endTime: Date,
    sensorIds?: number[],
    fanIds?: number[]
  ): Promise<any[]> {
    let sql = `
      SELECT 
        md.timestamp,
        md.temperature,
        md.fan_speed,
        md.fan_rpm,
        s.sensor_name,
        s.sensor_label,
        s.sensor_type,
        f.fan_name,
        f.fan_label
      FROM monitoring_data md
      LEFT JOIN sensors s ON md.sensor_id = s.id
      LEFT JOIN fans f ON md.fan_id = f.id
      WHERE md.system_id = $1
        AND md.timestamp BETWEEN $2 AND $3
    `;

    const params: any[] = [systemId, startTime.toISOString(), endTime.toISOString()];
    let paramIndex = 4;

    if (sensorIds && sensorIds.length > 0) {
      const placeholders = sensorIds.map(() => `$${paramIndex++}`).join(',');
      sql += ` AND (md.sensor_id IN (${placeholders}) OR md.sensor_id IS NULL)`;
      params.push(...sensorIds);
    }

    if (fanIds && fanIds.length > 0) {
      const placeholders = fanIds.map(() => `$${paramIndex++}`).join(',');
      sql += ` AND (md.fan_id IN (${placeholders}) OR md.fan_id IS NULL)`;
      params.push(...fanIds);
    }

    sql += ' ORDER BY md.timestamp ASC';

    return await this.db.all(sql, params);
  }

  /**
   * Get system statistics
   */
  public async getSystemStatistics(systemId: number, hours: number = 24): Promise<any> {
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const stats = await this.db.get(`
      SELECT 
        COUNT(*) as total_readings,
        AVG(temperature) as avg_temp,
        MIN(temperature) as min_temp,
        MAX(temperature) as max_temp,
        AVG(fan_speed) as avg_fan_speed,
        AVG(fan_rpm) as avg_fan_rpm
      FROM monitoring_data
      WHERE system_id = $1 AND timestamp >= $2
    `, [systemId, startTime.toISOString()]);

    return stats;
  }

  /**
   * Start data retention cleanup
   */
  private startDataRetentionCleanup(): void {
    // Run cleanup daily
    this.dataRetentionInterval = setInterval(() => {
      this.cleanupOldData();
    }, 24 * 60 * 60 * 1000); // 24 hours

    log.info('[DataAggregator] Data retention cleanup started', 'DataAggregator');
  }

  /**
   * Cleanup old monitoring data
   */
  private async cleanupOldData(): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - this.dataRetentionDays * 24 * 60 * 60 * 1000);
      
      const result = await this.db.run(
        'DELETE FROM monitoring_data WHERE timestamp < $1',
        [cutoffDate.toISOString()]
      );

      if (result.rowCount && result.rowCount > 0) {
        log.info(`[DataAggregator] Cleaned up ${result.rowCount} old monitoring records`, 'DataAggregator');
      }
    } catch (error) {
      log.error('Error cleaning up old data:', 'DataAggregator', error);
    }
  }

  /**
   * Get real-time system overview
   */
  public getSystemOverview(): {
    totalSystems: number;
    onlineSystems: number;
    offlineSystems: number;
    systemsWithErrors: number;
    totalSensors: number;
    totalFans: number;
    avgTemperature: number;
    highestTemperature: number;
  } {
    const systems = this.getAllSystemsData();
    
    let totalSensors = 0;
    let totalFans = 0;
    let tempSum = 0;
    let tempCount = 0;
    let highestTemp = 0;

    for (const system of systems) {
      totalSensors += system.sensors.length;
      totalFans += system.fans.length;
      
      for (const sensor of system.sensors) {
        tempSum += sensor.temperature;
        tempCount++;
        if (sensor.temperature > highestTemp) {
          highestTemp = sensor.temperature;
        }
      }
    }

    return {
      totalSystems: systems.length,
      onlineSystems: systems.filter(s => s.status === 'online').length,
      offlineSystems: systems.filter(s => s.status === 'offline').length,
      systemsWithErrors: systems.filter(s => s.status === 'error').length,
      totalSensors,
      totalFans,
      avgTemperature: tempCount > 0 ? tempSum / tempCount : 0,
      highestTemperature: highestTemp
    };
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    if (this.dataRetentionInterval) {
      clearInterval(this.dataRetentionInterval);
    }
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
    }
    this.removeAllListeners();
  }
}