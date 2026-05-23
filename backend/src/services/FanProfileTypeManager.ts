import Database from '../database/database';
import { log } from '../utils/logger';
import type { FanProfileType } from '../types/fanProfiles';

/**
 * FanProfileTypeManager
 *
 * Owns the `fan_profile_types` lookup table - the set of values that can be
 * stored in `fan_profiles.profile_type`. System types (silent / balanced /
 * optimal / performance / custom) are seeded from schema.sql with
 * `is_system=true` and cannot be deleted through the API. User types live in
 * the same table with `is_system=false` and can be removed when no profile
 * still references them (D1 semantics).
 */
export class FanProfileTypeManager {
  private static instance: FanProfileTypeManager;
  private db: Database;

  private constructor() {
    this.db = Database.getInstance();
  }

  public static getInstance(): FanProfileTypeManager {
    if (!FanProfileTypeManager.instance) {
      FanProfileTypeManager.instance = new FanProfileTypeManager();
    }
    return FanProfileTypeManager.instance;
  }

  /**
   * Return all profile types with their is_system flag and a count of profiles
   * currently referencing them. The count is used by the UI to surface the
   * "N profiles still use this" message when blocking a delete.
   */
  public async getAll(): Promise<FanProfileType[]> {
    const sql = `
      SELECT
        t.name,
        t.is_system,
        t.color,
        t.created_at,
        COALESCE(p.in_use_count, 0) AS in_use_count
      FROM fan_profile_types t
      LEFT JOIN (
        SELECT profile_type, COUNT(*)::int AS in_use_count
        FROM fan_profiles
        GROUP BY profile_type
      ) p ON p.profile_type = t.name
      ORDER BY t.is_system DESC, t.name
    `;
    const rows = await this.db.all(sql);
    return rows.map((r: any) => ({
      name: r.name,
      is_system: r.is_system,
      color: r.color || null,
      in_use_count: Number(r.in_use_count) || 0,
      created_at: r.created_at
    }));
  }

  /**
   * Add a user-defined profile type. Name is normalised to lowercase and
   * stripped of whitespace before insert so dropdown values stay consistent.
   * Color (when omitted) defaults to neutral grey so the badge still renders.
   *
   * Returns `null` if the name collides with an existing row (system or user).
   */
  public async create(rawName: string, rawColor?: string): Promise<FanProfileType | null> {
    const name = this.normalise(rawName);
    if (!name) {
      throw new Error('Profile type name cannot be empty');
    }
    if (name.length > 50) {
      throw new Error('Profile type name cannot exceed 50 characters');
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
      throw new Error(
        'Profile type name must start with a letter or digit and contain only lowercase letters, digits, hyphens or underscores'
      );
    }

    const color = this.normaliseColor(rawColor);

    const existing = await this.db.get(
      'SELECT name FROM fan_profile_types WHERE name = $1',
      [name]
    );
    if (existing) {
      return null;
    }

    await this.db.run(
      'INSERT INTO fan_profile_types (name, is_system, color) VALUES ($1, false, $2)',
      [name, color]
    );
    log.info(`Created fan profile type: ${name} (${color})`, 'FanProfileTypeManager');

    const list = await this.getAll();
    return list.find(t => t.name === name) || null;
  }

  /**
   * Delete a user-defined profile type. Blocks deletion when:
   *  - the type is `is_system=true` (system types are immutable)
   *  - any fan_profiles row still references it (D1: block-on-in-use)
   *
   * Returns a discriminated result the route can translate to an HTTP status.
   */
  public async delete(rawName: string): Promise<
    | { ok: true }
    | { ok: false; reason: 'not_found' | 'is_system' | 'in_use'; in_use_count?: number }
  > {
    const name = this.normalise(rawName);

    const row = await this.db.get(
      'SELECT name, is_system FROM fan_profile_types WHERE name = $1',
      [name]
    );
    if (!row) {
      return { ok: false, reason: 'not_found' };
    }
    if (row.is_system) {
      return { ok: false, reason: 'is_system' };
    }

    const usage = await this.db.get(
      'SELECT COUNT(*)::int AS c FROM fan_profiles WHERE profile_type = $1',
      [name]
    );
    const inUseCount = Number(usage?.c) || 0;
    if (inUseCount > 0) {
      return { ok: false, reason: 'in_use', in_use_count: inUseCount };
    }

    await this.db.run('DELETE FROM fan_profile_types WHERE name = $1', [name]);
    log.info(`Deleted fan profile type: ${name}`, 'FanProfileTypeManager');
    return { ok: true };
  }

  /**
   * Recolor an existing profile type (system or user). Recoloring is purely
   * cosmetic, so the `is_system` lock that blocks deletion does not apply
   * here - the user is allowed to retune the badge palette to taste. Returns
   * `null` if the row doesn't exist; otherwise returns the updated row so the
   * caller can reflect the new color immediately without a second round-trip.
   */
  public async updateColor(rawName: string, rawColor: string): Promise<FanProfileType | null> {
    const name = this.normalise(rawName);
    const color = this.normaliseColor(rawColor);

    const existing = await this.db.get(
      'SELECT name FROM fan_profile_types WHERE name = $1',
      [name]
    );
    if (!existing) {
      return null;
    }

    await this.db.run(
      'UPDATE fan_profile_types SET color = $1 WHERE name = $2',
      [color, name]
    );
    log.info(`Updated fan profile type color: ${name} -> ${color}`, 'FanProfileTypeManager');

    const list = await this.getAll();
    return list.find(t => t.name === name) || null;
  }

  private normalise(name: string): string {
    return (name || '').trim().toLowerCase();
  }

  // Accepts #RGB or #RRGGBB; expands shorthand; rejects anything else by
  // returning a safe fallback so a bad color never blocks creation.
  private normaliseColor(raw?: string): string {
    if (!raw) return '#9E9E9E';
    const s = raw.trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(s)) return s;
    if (/^#[0-9A-F]{3}$/.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    }
    return '#9E9E9E';
  }
}

export default FanProfileTypeManager;
