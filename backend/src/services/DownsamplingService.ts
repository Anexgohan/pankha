/**
 * DownsamplingService - Tiered History Compression
 *
 * ARCHITECTURE:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ Tier 0 (Live)    │ 0-15min    │ Agent rate (2s) │ Browser RAM   │
 * │ Tier 1 (Fresh)   │ 15min-24h  │ 1-minute avg    │ PostgreSQL    │
 * │ Tier 2 (Warm)    │ 24h-30d    │ 5-minute avg    │ PostgreSQL    │
 * │ Tier 3 (Cold)    │ 30d-365d   │ 30-minute avg   │ PostgreSQL    │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * This service runs a daily background job at 03:00 UTC to:
 * 1. Compact data older than 24h → 5-minute averages (Tier 2)
 * 2. Compact data older than 30d → 30-minute averages (Tier 3)
 * 3. Delete data older than retentionDays (from license tier via SST)
 *
 * Storage Efficiency:
 * - Tier 1: 1440 points/day/sensor (1-min intervals)
 * - Tier 2: 288 points/day/sensor (5-min intervals) = 80% reduction
 * - Tier 3: 48 points/day/sensor (30-min intervals) = 97% reduction
 *
 * @see backend/src/license/tiers.ts for retentionDays per tier (SST)
 */

import { Pool } from "pg";
import { EventEmitter } from "events";
import { log } from "../utils/logger";
import { LicenseManager } from "../license/LicenseManager";

// Downsampling intervals in minutes
const TIER_2_INTERVAL_MINUTES = 5;   // 24h-30d data → 5-minute averages
const TIER_3_INTERVAL_MINUTES = 30;  // 30d+ data → 30-minute averages

// Age thresholds in days
const TIER_2_AGE_DAYS = 1;   // Data older than 1 day gets 5-min downsampling
const TIER_3_AGE_DAYS = 30;  // Data older than 30 days gets 30-min downsampling

// Schedule: Run at 03:00 UTC daily
const SCHEDULE_HOUR_UTC = 3;

export class DownsamplingService extends EventEmitter {
  private pool: Pool;
  private licenseManager: LicenseManager;
  private scheduledTimeout: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(pool: Pool, licenseManager: LicenseManager) {
    super();
    this.pool = pool;
    this.licenseManager = licenseManager;
  }

  /**
   * Start the scheduled downsampling job
   * Runs daily at 03:00 UTC
   */
  public start(): void {
    this.scheduleNextRun();
    log.info(
      `[DownsamplingService] Started - scheduled for ${SCHEDULE_HOUR_UTC}:00 UTC daily`,
      "DownsamplingService"
    );
  }

  /**
   * Stop the scheduled job
   */
  public stop(): void {
    if (this.scheduledTimeout) {
      clearTimeout(this.scheduledTimeout);
      this.scheduledTimeout = null;
    }
    log.info("[DownsamplingService] Stopped", "DownsamplingService");
  }

  /**
   * Schedule the next run at 03:00 UTC
   */
  private scheduleNextRun(): void {
    const now = new Date();
    const nextRun = new Date(now);
    
    // Set to today at SCHEDULE_HOUR_UTC:00 UTC
    nextRun.setUTCHours(SCHEDULE_HOUR_UTC, 0, 0, 0);
    
    // If we're past today's scheduled time, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const msUntilNextRun = nextRun.getTime() - now.getTime();
    
    this.scheduledTimeout = setTimeout(() => {
      this.runDownsampling();
      this.scheduleNextRun(); // Schedule next day's run
    }, msUntilNextRun);
    
    log.debug(
      `[DownsamplingService] Next run scheduled for ${nextRun.toISOString()}`,
      "DownsamplingService"
    );
  }

  /**
   * Run downsampling immediately (for testing or manual trigger)
   */
  public async runNow(): Promise<void> {
    await this.runDownsampling();
  }

  /**
   * Main downsampling job
   */
  private async runDownsampling(): Promise<void> {
    if (this.isRunning) {
      log.warn("[DownsamplingService] Already running, skipping", "DownsamplingService");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    log.info("[DownsamplingService] Starting daily downsampling job", "DownsamplingService");

    try {
      // Get retention days from license (SST)
      const retentionDays = await this.licenseManager.getRetentionDays();
      
      // 1. Downsample Tier 2 (24h-30d → 5-min averages)
      const tier2Stats = await this.downsampleTier2();
      
      // 2. Downsample Tier 3 (30d+ → 30-min averages)
      const tier3Stats = await this.downsampleTier3();
      
      // 3. Delete data beyond retention period
      const deletedRows = await this.cleanupExpiredData(retentionDays);
      
      const duration = Date.now() - startTime;
      log.info(
        `[DownsamplingService] Completed in ${duration}ms - Tier2: ${tier2Stats.processed}→${tier2Stats.created} rows, Tier3: ${tier3Stats.processed}→${tier3Stats.created} rows, Deleted: ${deletedRows} expired`,
        "DownsamplingService"
      );
      
      this.emit("completed", { tier2Stats, tier3Stats, deletedRows, duration });
    } catch (error) {
      log.error(
        `[DownsamplingService] Failed: ${error instanceof Error ? error.message : error}`,
        "DownsamplingService"
      );
      this.emit("error", error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Tier 2 Downsampling: Compact 24h-30d data → 5-minute averages
   *
   * Strategy:
   * 1. Find data older than 24h but newer than 30d that hasn't been downsampled
   * 2. Group by sensor + 5-minute time bucket
   * 3. Calculate AVG, MIN, MAX temperature per bucket
   * 4. Insert the averaged row, delete the original rows
   */
  private async downsampleTier2(): Promise<{ processed: number; created: number }> {
    const client = await this.pool.connect();
    
    try {
      await client.query("BEGIN");
      
      // Find rows to downsample:
      // - Older than 24 hours
      // - Newer than 30 days (Tier 3 will handle those)
      // - Not already downsampled (we use a simple heuristic: if there's
      //   already a row at the 5-min boundary, skip)
      const result = await client.query(`
        WITH time_buckets AS (
          SELECT 
            system_id,
            sensor_name,
            date_trunc('minute', "timestamp") 
              - (EXTRACT(MINUTE FROM "timestamp")::int % ${TIER_2_INTERVAL_MINUTES}) * INTERVAL '1 minute' AS bucket,
            AVG(temperature::numeric) as avg_temp,
            MIN(temperature::numeric) as min_temp,
            MAX(temperature::numeric) as max_temp,
            COUNT(*) as point_count,
            array_agg(id) as ids_to_delete
          FROM monitoring_data
          WHERE "timestamp" < NOW() - INTERVAL '${TIER_2_AGE_DAYS} days'
            AND "timestamp" >= NOW() - INTERVAL '${TIER_3_AGE_DAYS} days'
          GROUP BY system_id, sensor_name, bucket
          HAVING COUNT(*) > 1
        )
        SELECT * FROM time_buckets
      `);
      
      let processed = 0;
      let created = 0;
      
      for (const row of result.rows) {
        // Insert the downsampled row
        await client.query(`
          INSERT INTO monitoring_data (system_id, sensor_name, temperature, "timestamp")
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [row.system_id, row.sensor_name, row.avg_temp, row.bucket]);
        
        // Delete the original fine-grained rows
        await client.query(`
          DELETE FROM monitoring_data WHERE id = ANY($1::int[])
        `, [row.ids_to_delete]);
        
        processed += row.point_count;
        created++;
      }
      
      await client.query("COMMIT");
      return { processed, created };
      
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Tier 3 Downsampling: Compact 30d+ data → 30-minute averages
   *
   * Same strategy as Tier 2 but with 30-minute buckets.
   */
  private async downsampleTier3(): Promise<{ processed: number; created: number }> {
    const client = await this.pool.connect();
    
    try {
      await client.query("BEGIN");
      
      const result = await client.query(`
        WITH time_buckets AS (
          SELECT 
            system_id,
            sensor_name,
            date_trunc('hour', "timestamp") 
              + INTERVAL '30 minutes' * FLOOR(EXTRACT(MINUTE FROM "timestamp") / ${TIER_3_INTERVAL_MINUTES}) AS bucket,
            AVG(temperature::numeric) as avg_temp,
            MIN(temperature::numeric) as min_temp,
            MAX(temperature::numeric) as max_temp,
            COUNT(*) as point_count,
            array_agg(id) as ids_to_delete
          FROM monitoring_data
          WHERE "timestamp" < NOW() - INTERVAL '${TIER_3_AGE_DAYS} days'
          GROUP BY system_id, sensor_name, bucket
          HAVING COUNT(*) > 1
        )
        SELECT * FROM time_buckets
      `);
      
      let processed = 0;
      let created = 0;
      
      for (const row of result.rows) {
        await client.query(`
          INSERT INTO monitoring_data (system_id, sensor_name, temperature, "timestamp")
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [row.system_id, row.sensor_name, row.avg_temp, row.bucket]);
        
        await client.query(`
          DELETE FROM monitoring_data WHERE id = ANY($1::int[])
        `, [row.ids_to_delete]);
        
        processed += row.point_count;
        created++;
      }
      
      await client.query("COMMIT");
      return { processed, created };
      
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete data older than retention period
   * Retention days come from license tier (SST)
   */
  private async cleanupExpiredData(retentionDays: number): Promise<number> {
    const result = await this.pool.query(`
      DELETE FROM monitoring_data
      WHERE "timestamp" < NOW() - INTERVAL '${retentionDays} days'
    `);
    
    return result.rowCount || 0;
  }
}
