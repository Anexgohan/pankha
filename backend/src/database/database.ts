import { Pool, PoolClient, QueryResult } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../utils/logger';

export class Database {
  private pool: Pool;
  private static instance: Database;

  private constructor() {
    // Support for local development: if POSTGRES_HOST is set, construct DATABASE_URL
    // This allows `npm run dev` to override just the hostname (localhost vs pankha-postgres)
    let databaseUrl = process.env.DATABASE_URL;

    if (process.env.POSTGRES_HOST) {
      // Local dev mode: construct URL from individual vars
      const host = process.env.POSTGRES_HOST;
      const port = process.env.POSTGRES_PORT || '5432';
      const user = process.env.POSTGRES_USER || 'pankha_user';
      const password = process.env.POSTGRES_PASSWORD || 'pankha_password';
      const db = process.env.POSTGRES_DB || 'db_pankha';
      databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${db}`;
      log.info(`Using constructed DATABASE_URL with host: ${host}`, 'Database');
    }

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL environment variable is required for PostgreSQL connection'
      );
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      log.error('Unexpected error on idle PostgreSQL client', 'Database', err);
    });

    log.info('Connected to PostgreSQL database', 'Database');
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async initialize(): Promise<void> {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    try {
      await this.pool.query(schema);
      log.info('Database schema initialized successfully', 'Database');

      // Load default profiles on first run
      await this.loadDefaultProfiles();
    } catch (error: any) {
      log.error('Error initializing database schema', 'Database', error);
      throw error;
    }
  }

  /**
   * Load default fan profiles from JSON file if no profiles exist
   * Only runs on first installation or if all profiles have been deleted
   */
  private async loadDefaultProfiles(): Promise<void> {
    try {
      // Check if any profiles exist
      const result = await this.pool.query(
        'SELECT COUNT(*) as count FROM fan_profiles'
      );
      const profileCount = parseInt(result.rows[0].count, 10);

      if (profileCount > 0) {
        log.debug(
          `${profileCount} fan profiles already exist, skipping default load`,
          'Database'
        );
        return;
      }

      // Read default profiles from JSON file
      // Path to defaults file (in backend/src/config, copied to backend/config in Docker)
      const defaultsPath = path.resolve(
        __dirname,
        '../config/fan-profiles-defaults.json'
      );

      if (!fs.existsSync(defaultsPath)) {
        log.warn(
          `Default profiles file not found at ${defaultsPath}`,
          'Database'
        );
        return;
      }

      const defaultsContent = fs.readFileSync(defaultsPath, 'utf8');
      const defaultsData = JSON.parse(defaultsContent);

      if (!defaultsData.profiles || !Array.isArray(defaultsData.profiles)) {
        log.warn('Invalid default profiles format', 'Database');
        return;
      }

      log.info(
        `Loading ${defaultsData.profiles.length} default fan profiles...`,
        'Database'
      );

      for (const profile of defaultsData.profiles) {
        // Insert profile
        const profileResult = await this.pool.query(
          `INSERT INTO fan_profiles (profile_name, description, profile_type, is_global, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            profile.profile_name,
            profile.description || null,
            profile.profile_type || 'custom',
            true, // is_global
            'system',
          ]
        );

        const profileId = profileResult.rows[0].id;

        // Insert curve points
        if (profile.curve_points && Array.isArray(profile.curve_points)) {
          for (let i = 0; i < profile.curve_points.length; i++) {
            const point = profile.curve_points[i];
            // Handle temperature as string or number
            const temp =
              typeof point.temperature === 'string'
                ? parseFloat(point.temperature)
                : point.temperature;

            await this.pool.query(
              'INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES ($1, $2, $3, $4)',
              [profileId, temp, point.fan_speed, i + 1]
            );
          }
        }

        log.info(
          `  ✓ Loaded default profile: ${profile.profile_name}`,
          'Database'
        );
      }

      log.success(
        `Successfully loaded ${defaultsData.profiles.length} default fan profiles`,
        'Database'
      );
    } catch (error) {
      log.error('Error loading default fan profiles', 'Database', error);
      // Don't throw - this is not critical for startup
    }
  }

  // Run a query (INSERT, UPDATE, DELETE)
  public async run(sql: string, params: any[] = []): Promise<QueryResult> {
    try {
      const result = await this.pool.query(sql, params);
      return result;
    } catch (error) {
      throw error;
    }
  }

  // Get a single row
  public async get(sql: string, params: any[] = []): Promise<any> {
    try {
      const result = await this.pool.query(sql, params);
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }

  // Get all rows
  public async all(sql: string, params: any[] = []): Promise<any[]> {
    try {
      const result = await this.pool.query(sql, params);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  // Close the pool
  public async close(): Promise<void> {
    try {
      await this.pool.end();
      log.info('Database connection pool closed', 'Database');
    } catch (error) {
      throw error;
    }
  }

  // Transaction support
  public async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Helper method to get the pool for complex operations
  public getPool(): Pool {
    return this.pool;
  }
}

export default Database;
