import { Pool, PoolClient, QueryResult } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../utils/logger';

export class Database {
  private pool: Pool;
  private static instance: Database;

  private constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL connection');
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
    } catch (error: any) {
      log.error('Error initializing database schema', 'Database', error);
      throw error;
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
  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
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
